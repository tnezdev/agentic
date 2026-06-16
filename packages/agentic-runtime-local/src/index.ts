import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import {
  FilesystemArtifactAdapter,
  FilesystemPersonaAdapter,
  FilesystemTaskAdapter,
  FilesystemWorkflowAdapter,
  loadSkill,
} from "@tnezdev/agentic"
import type {
  GraphDef,
  PersonaFile,
  PersonaRef,
  Skill,
  Task,
  TaskQuery,
} from "@tnezdev/agentic"
import type {
  AgenticRuntimePackage,
  RuntimeCommandResult,
  RuntimeContext,
  RuntimeInitArgs,
  RuntimeInvocation,
  RuntimeRunArgs,
  RuntimeStatusArgs,
} from "@tnezdev/agentic/runtime"

const RUNTIME_NAME = "local"
const PACKAGE_NAME = "@tnezdev/agentic-runtime-local"
const STATE_VERSION = 1
const RUNTIME_DIR = join(".agentic", "runtime", RUNTIME_NAME)
const TARGETS_DIR = "targets"
const INVOCATIONS_DIR = "invocations"
const STATE_FILE = "runtime.json"
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RANDOM_LEN = 16

type LocalRuntimeState = {
  version: typeof STATE_VERSION
  runtime: typeof RUNTIME_NAME
  package_name: typeof PACKAGE_NAME
  targets_dir: typeof TARGETS_DIR
  invocations_dir: typeof INVOCATIONS_DIR
}

type LocalRunTarget = {
  workspace_root: string
  workspace_label: string
  workflow_id?: string | undefined
}

type LocalRunContext = {
  target: LocalRunTarget
  graph: GraphDef
  persona?: PersonaFile | undefined
  skills: Skill[]
  task?: Task | undefined
  workflow_run_id: string
  artifact_id: string
  invocation_id: string
}

function encodeTime(now: number, len: number): string {
  let out = ""
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % 32
    out = ULID_ALPHABET[mod]! + out
    now = (now - mod) / 32
  }
  return out
}

function randomChars(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ""
  for (let i = 0; i < len; i++) {
    out += ULID_ALPHABET[bytes[i]! % 32]
  }
  return out
}

function incrementBase32(s: string): string {
  const chars = s.split("")
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ULID_ALPHABET.indexOf(chars[i]!)
    if (idx < 31) {
      chars[i] = ULID_ALPHABET[idx + 1]!
      return chars.join("")
    }
    chars[i] = "0"
  }
  return randomChars(chars.length)
}

function createUlidFactory(): () => string {
  let lastTime = 0
  let lastRandom = ""
  return function ulid(): string {
    const now = Date.now()
    if (now === lastTime) {
      lastRandom = incrementBase32(lastRandom)
    } else {
      lastTime = now
      lastRandom = randomChars(RANDOM_LEN)
    }
    return encodeTime(now, TIME_LEN) + lastRandom
  }
}

const createInvocationId = createUlidFactory()

function runtimeDirFor(workspaceRoot: string): string {
  return join(workspaceRoot, RUNTIME_DIR)
}

function runtimeDir(ctx: RuntimeContext): string {
  return runtimeDirFor(ctx.workspace_root)
}

function targetsDirFor(workspaceRoot: string): string {
  return join(runtimeDirFor(workspaceRoot), TARGETS_DIR)
}

function targetsDir(ctx: RuntimeContext): string {
  return targetsDirFor(ctx.workspace_root)
}

function invocationsDirFor(workspaceRoot: string): string {
  return join(runtimeDirFor(workspaceRoot), INVOCATIONS_DIR)
}

function invocationsDir(ctx: RuntimeContext): string {
  return invocationsDirFor(ctx.workspace_root)
}

function invocationPathFor(workspaceRoot: string, invocationId: string): string {
  return join(invocationsDirFor(workspaceRoot), `${invocationId}.json`)
}

function statePathFor(workspaceRoot: string): string {
  return join(runtimeDirFor(workspaceRoot), STATE_FILE)
}

function statePath(ctx: RuntimeContext): string {
  return statePathFor(ctx.workspace_root)
}

function workspaceRelative(ctx: RuntimeContext, path: string): string {
  return relative(ctx.workspace_root, path) || "."
}

function pathRelative(root: string, path: string): string {
  return relative(root, path) || "."
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function hasAgenticWorkspace(path: string): Promise<boolean> {
  return (await dirExists(join(path, ".agentic"))) || (await dirExists(join(path, ".spores")))
}

function resolveFromWorkspace(ctx: RuntimeContext, path: string): string {
  return resolve(ctx.workspace_root, path)
}

function stringFlag(
  flags: RuntimeRunArgs["flags"],
  name: string,
): string | undefined {
  const value = flags[name]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

async function resolveRunTarget(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
): Promise<LocalRunTarget> {
  const workspaceFlag = stringFlag(args.flags, "workspace")
  const workflowFlag = stringFlag(args.flags, "workflow")

  if (workspaceFlag !== undefined) {
    const workspaceRoot = resolveFromWorkspace(ctx, workspaceFlag)
    return {
      workspace_root: workspaceRoot,
      workspace_label: workspaceFlag,
      workflow_id: workflowFlag ?? args.target ?? args.args[0],
    }
  }

  if (args.target !== undefined) {
    const candidate = resolveFromWorkspace(ctx, args.target)
    if ((await dirExists(candidate)) && (await hasAgenticWorkspace(candidate))) {
      return {
        workspace_root: candidate,
        workspace_label: args.target,
        workflow_id: workflowFlag ?? args.args[0],
      }
    }
  }

  return {
    workspace_root: ctx.workspace_root,
    workspace_label: ".",
    workflow_id: workflowFlag ?? args.target ?? args.args[0],
  }
}

function taskQueryWithoutStatus(
  query: TaskQuery | undefined,
): Omit<TaskQuery, "status"> | undefined {
  if (query === undefined) return undefined

  const filtered: Omit<TaskQuery, "status"> = {}
  if (query.tags !== undefined) filtered.tags = query.tags
  if (query.parent_id !== undefined) filtered.parent_id = query.parent_id

  return Object.keys(filtered).length > 0 ? filtered : undefined
}

function selectPersona(
  refs: PersonaRef[],
  workflowId: string | undefined,
): PersonaRef | undefined {
  if (workflowId !== undefined) {
    const workflowMatch = refs.find((ref) => ref.workflow === workflowId)
    if (workflowMatch !== undefined) return workflowMatch
  }
  if (refs.length === 1) return refs[0]
  return refs.find((ref) => ref.workflow !== undefined) ?? refs[0]
}

async function loadSelectedPersona(
  workspaceRoot: string,
  workflowId: string | undefined,
): Promise<PersonaFile | undefined> {
  const personas = new FilesystemPersonaAdapter(workspaceRoot)
  const selected = selectPersona(await personas.listPersonas(), workflowId)
  if (selected === undefined) return undefined

  const persona = await personas.loadPersona(selected.name)
  if (persona === undefined) {
    throw new Error(`Persona "${selected.name}" could not be loaded.`)
  }
  return persona
}

function firstEntryNode(graph: GraphDef): string | undefined {
  const destinations = new Set(graph.edges.map((edge) => edge.to))
  return graph.nodes.find((node) => !destinations.has(node.id))?.id ?? graph.nodes[0]?.id
}

async function resolveWorkflow(
  workflows: FilesystemWorkflowAdapter,
  workflowId: string | undefined,
  persona: PersonaFile | undefined,
  workspaceRoot: string,
): Promise<GraphDef> {
  const resolvedWorkflowId = workflowId ?? persona?.workflow
  if (resolvedWorkflowId !== undefined) {
    const graph = await workflows.loadGraph(resolvedWorkflowId)
    if (graph === undefined) {
      throw new Error(
        `Workflow target "${resolvedWorkflowId}" was not found in ${workspaceRoot}.`,
      )
    }
    return graph
  }

  const graphs = await workflows.listGraphs()
  if (graphs.length === 1) return graphs[0]!
  const available = graphs.map((graph) => graph.id).sort().join(", ") || "none"
  throw new Error(
    `No workflow target was provided. Available workflows in ${workspaceRoot}: ${available}.`,
  )
}

async function loadPersonaSkills(
  workspaceRoot: string,
  persona: PersonaFile | undefined,
): Promise<Skill[]> {
  const skills: Skill[] = []
  for (const name of persona?.skills ?? []) {
    const skill = await loadSkill(name, workspaceRoot)
    if (skill === undefined) {
      throw new Error(`Skill "${name}" referenced by persona "${persona?.name}" was not found.`)
    }
    skills.push(skill)
  }
  return skills
}

async function createRunPacketArtifact(
  ctx: RuntimeContext,
  run: LocalRunContext,
): Promise<void> {
  const artifacts = new FilesystemArtifactAdapter(run.target.workspace_root)
  const body = renderRunPacket(ctx, run)
  const tags = new Set<string>([
    "runtime",
    "local",
    `invocation:${run.invocation_id}`,
    `workflow:${run.graph.id}`,
  ])

  for (const tag of run.persona?.memory_tags ?? []) tags.add(tag)
  for (const tag of run.task?.tags ?? []) tags.add(tag)
  if (run.persona !== undefined) tags.add(`persona:${run.persona.name}`)

  const artifact = await artifacts.create({
    type: "local-runtime-run",
    title: `Local runtime run: ${run.graph.name}`,
    body,
    tags: [...tags],
  })
  run.artifact_id = artifact.id
  await artifacts.write(artifact.id, {
    body: renderRunPacket(ctx, run),
    mode: "replace",
  })
  const finalized = await artifacts.finalize(artifact.id)
  run.artifact_id = finalized.id
}

function renderRunPacket(ctx: RuntimeContext, run: LocalRunContext): string {
  const baseDirArg = shellQuote(run.target.workspace_root)
  const skillList = run.skills.length === 0
    ? "- None loaded."
    : run.skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
  const taskSummary = run.task === undefined
    ? "No ready task matched the selected persona/task filter."
    : `${run.task.id}: ${run.task.description}`
  const personaSummary = run.persona === undefined
    ? "No persona selected."
    : `${run.persona.name}: ${run.persona.description}`

  return `# Local Runtime Run: ${run.graph.name}

## Summary

The local runtime prepared an Agentic workspace run and left this durable packet for inspection.
This is not a model transcript and does not claim the workflow's research work is complete.

## Workspace

- Workspace: ${run.target.workspace_label}
- Workspace path: ${run.target.workspace_root}
- Runtime package: ${ctx.runtime_package}

## Target

- Workflow: ${run.graph.id} (${run.graph.name})
- Workflow version: ${run.graph.version}
- Runtime invocation id: ${run.invocation_id}
- Runtime invocation path: ${pathRelative(
    run.target.workspace_root,
    invocationPathFor(run.target.workspace_root, run.invocation_id),
  )}
- Workflow run id: ${run.workflow_run_id}
- Artifact id: ${run.artifact_id}

## Persona

${personaSummary}

## Skills

${skillList}

## Task

${taskSummary}

## Next Inspection Commands


\`\`\`bash
agentic workflow status ${run.workflow_run_id} --base-dir ${baseDirArg}
agentic artifact read ${run.artifact_id} --base-dir ${baseDirArg}
agentic artifact inspect ${run.artifact_id} --base-dir ${baseDirArg}
\`\`\`
`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function invocationTarget(args: RuntimeRunArgs, target: LocalRunTarget): string | undefined {
  return args.target ?? target.workflow_id ?? target.workspace_label
}

async function writeInvocation(
  workspaceRoot: string,
  invocation: RuntimeInvocation,
): Promise<RuntimeInvocation> {
  await mkdir(invocationsDirFor(workspaceRoot), { recursive: true })
  await writeFile(
    invocationPathFor(workspaceRoot, invocation.id),
    `${JSON.stringify(invocation, null, 2)}\n`,
    "utf-8",
  )
  return invocation
}

async function createInvocation(
  args: RuntimeRunArgs,
  target: LocalRunTarget,
): Promise<RuntimeInvocation> {
  return writeInvocation(target.workspace_root, {
    id: createInvocationId(),
    runtime: RUNTIME_NAME,
    runtime_package: PACKAGE_NAME,
    target: invocationTarget(args, target),
    workspace_root: target.workspace_root,
    status: "running",
    started_at: new Date().toISOString(),
    artifact_ids: [],
  })
}

async function completeInvocation(
  invocation: RuntimeInvocation,
  run: LocalRunContext,
): Promise<RuntimeInvocation> {
  return writeInvocation(run.target.workspace_root, {
    ...invocation,
    status: "completed",
    ended_at: new Date().toISOString(),
    workflow_run_id: run.workflow_run_id,
    artifact_ids: [run.artifact_id],
  })
}

async function failInvocation(
  invocation: RuntimeInvocation,
  err: unknown,
): Promise<RuntimeInvocation> {
  const message = err instanceof Error ? err.message : String(err)
  return writeInvocation(invocation.workspace_root, {
    ...invocation,
    status: "failed",
    ended_at: new Date().toISOString(),
    error: message,
  })
}

async function listInvocations(workspaceRoot: string): Promise<RuntimeInvocation[]> {
  let entries: string[]
  try {
    entries = await readdir(invocationsDirFor(workspaceRoot))
  } catch {
    return []
  }

  const invocations: RuntimeInvocation[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    try {
      invocations.push(
        JSON.parse(
          await readFile(join(invocationsDirFor(workspaceRoot), entry), "utf-8"),
        ) as RuntimeInvocation,
      )
    } catch {
      // Ignore malformed records so status remains usable for repair.
    }
  }
  return invocations.sort((a, b) => b.started_at.localeCompare(a.started_at))
}

async function prepareLocalRun(
  ctx: RuntimeContext,
  target: LocalRunTarget,
  invocation: RuntimeInvocation,
): Promise<LocalRunContext> {
  if (!(await hasAgenticWorkspace(target.workspace_root))) {
    throw new Error(`No Agentic workspace found at ${target.workspace_root}.`)
  }
  if (!(await pathExists(statePathFor(target.workspace_root)))) {
    throw new Error(
      `Local runtime is not initialized for ${target.workspace_root}. Run \`agentic runtime init local --base-dir ${target.workspace_label}\` first.`,
    )
  }

  const persona = await loadSelectedPersona(target.workspace_root, target.workflow_id)
  const workflows = new FilesystemWorkflowAdapter(target.workspace_root)
  const graph = await resolveWorkflow(workflows, target.workflow_id, persona, target.workspace_root)
  const skills = await loadPersonaSkills(target.workspace_root, persona)
  const taskAdapter = new FilesystemTaskAdapter(target.workspace_root)
  const task = await taskAdapter.nextReadyTask(taskQueryWithoutStatus(persona?.task_filter))
  const workflowRun = await workflows.createRun(
    graph.id,
    `local runtime run: ${graph.id}`,
  )

  const run: LocalRunContext = {
    target,
    graph,
    persona,
    skills,
    task: task ?? undefined,
    workflow_run_id: workflowRun.run_id,
    artifact_id: "pending",
    invocation_id: invocation.id,
  }
  await createRunPacketArtifact(ctx, run)

  const entryNode = firstEntryNode(graph)
  if (entryNode !== undefined) {
    await workflows.appendTransition(workflowRun.run_id, {
      node_id: entryNode,
      pass: 1,
      from_status: "pending",
      to_status: "in_progress",
      identity: "local-runtime",
      timestamp: new Date().toISOString(),
      reason: "Local runtime prepared this workflow target for harness execution.",
      metadata: {
        runtime: RUNTIME_NAME,
        invocation_id: invocation.id,
        artifact_id: run.artifact_id,
      },
    })
  }

  return run
}

async function readState(ctx: RuntimeContext): Promise<LocalRuntimeState | undefined> {
  try {
    return JSON.parse(await readFile(statePath(ctx), "utf-8")) as LocalRuntimeState
  } catch {
    return undefined
  }
}

async function initLocalRuntime(
  ctx: RuntimeContext,
  _args: RuntimeInitArgs,
): Promise<RuntimeCommandResult> {
  const dir = runtimeDir(ctx)
  const targetDir = targetsDir(ctx)
  const invocationDir = invocationsDir(ctx)
  const path = statePath(ctx)
  await mkdir(targetDir, { recursive: true })
  await mkdir(invocationDir, { recursive: true })

  const existing = await readState(ctx)
  const created = existing === undefined
  if (created) {
    const state: LocalRuntimeState = {
      version: STATE_VERSION,
      runtime: RUNTIME_NAME,
      package_name: PACKAGE_NAME,
      targets_dir: TARGETS_DIR,
      invocations_dir: INVOCATIONS_DIR,
    }
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8")
  }

  return {
    summary: created
      ? "Initialized local Agentic runtime glue."
      : "Local Agentic runtime glue is already initialized.",
    data: {
      initialized: true,
      created,
      config_dir: workspaceRelative(ctx, dir),
      state_path: workspaceRelative(ctx, path),
      targets_dir: workspaceRelative(ctx, targetDir),
      invocations_dir: workspaceRelative(ctx, invocationDir),
    },
  }
}

async function runLocalRuntime(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
): Promise<RuntimeCommandResult> {
  const target = await resolveRunTarget(ctx, args)
  if (!(await hasAgenticWorkspace(target.workspace_root))) {
    throw new Error(`No Agentic workspace found at ${target.workspace_root}.`)
  }
  if (!(await pathExists(statePathFor(target.workspace_root)))) {
    throw new Error(
      `Local runtime is not initialized for ${target.workspace_root}. Run \`agentic runtime init local --base-dir ${target.workspace_label}\` first.`,
    )
  }

  const invocation = await createInvocation(args, target)
  let run: LocalRunContext

  try {
    run = await prepareLocalRun(ctx, target, invocation)
    await completeInvocation(invocation, run)
  } catch (err) {
    await failInvocation(invocation, err)
    throw err
  }

  return {
    summary: `Prepared local Agentic run for ${run.graph.id} and wrote artifact ${run.artifact_id}.`,
    data: {
      invocation_id: invocation.id,
      invocation_path: pathRelative(
        ctx.workspace_root,
        invocationPathFor(run.target.workspace_root, invocation.id),
      ),
      target: args.target ?? run.graph.id,
      args: args.args,
      workspace: pathRelative(ctx.workspace_root, run.target.workspace_root),
      initialized: true,
      workflow_id: run.graph.id,
      workflow_run_id: run.workflow_run_id,
      artifact_id: run.artifact_id,
      persona: run.persona?.name ?? null,
      skills: run.skills.map((skill) => skill.name),
      task: run.task === undefined ? null : {
        id: run.task.id,
        description: run.task.description,
      },
    },
  }
}

async function statusLocalRuntime(
  ctx: RuntimeContext,
  _args: RuntimeStatusArgs,
): Promise<RuntimeCommandResult> {
  const initialized = await pathExists(statePath(ctx))
  const invocations = await listInvocations(ctx.workspace_root)
  const lastInvocation = invocations[0]
  return {
    summary: initialized
      ? "Local Agentic runtime glue is initialized."
      : "Local runtime package is installed; run `agentic runtime init local` to create local glue.",
    data: {
      initialized,
      state_path: workspaceRelative(ctx, statePath(ctx)),
      targets_dir: workspaceRelative(ctx, targetsDir(ctx)),
      targets_dir_exists: await dirExists(targetsDir(ctx)),
      invocations_dir: workspaceRelative(ctx, invocationsDir(ctx)),
      invocation_count: invocations.length,
      last_invocation: lastInvocation === undefined ? null : {
        id: lastInvocation.id,
        target: lastInvocation.target,
        status: lastInvocation.status,
        started_at: lastInvocation.started_at,
        ended_at: lastInvocation.ended_at,
        workflow_run_id: lastInvocation.workflow_run_id,
        artifact_ids: lastInvocation.artifact_ids,
      },
    },
  }
}

export const runtime: AgenticRuntimePackage = {
  kind: "agentic-runtime",
  api_version: 1,
  name: RUNTIME_NAME,
  package_name: PACKAGE_NAME,
  description: "Run Agentic workspaces on the local machine.",
  capabilities: ["init", "run", "status"],
  commands: {
    init: initLocalRuntime,
    run: runLocalRuntime,
    status: statusLocalRuntime,
  },
}

export default runtime
