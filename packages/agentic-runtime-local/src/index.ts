import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises"
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
  RuntimeRunArgs,
  RuntimeStatusArgs,
} from "@tnezdev/agentic/runtime"

const RUNTIME_NAME = "local"
const PACKAGE_NAME = "@tnezdev/agentic-runtime-local"
const STATE_VERSION = 1
const RUNTIME_DIR = join(".agentic", "runtime", RUNTIME_NAME)
const TARGETS_DIR = "targets"
const STATE_FILE = "runtime.json"

type LocalRuntimeState = {
  version: typeof STATE_VERSION
  runtime: typeof RUNTIME_NAME
  package_name: typeof PACKAGE_NAME
  targets_dir: typeof TARGETS_DIR
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
}

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

async function prepareLocalRun(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
): Promise<LocalRunContext> {
  const target = await resolveRunTarget(ctx, args)
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
  const path = statePath(ctx)
  await mkdir(targetDir, { recursive: true })

  const existing = await readState(ctx)
  const created = existing === undefined
  if (created) {
    const state: LocalRuntimeState = {
      version: STATE_VERSION,
      runtime: RUNTIME_NAME,
      package_name: PACKAGE_NAME,
      targets_dir: TARGETS_DIR,
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
    },
  }
}

async function runLocalRuntime(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
): Promise<RuntimeCommandResult> {
  const run = await prepareLocalRun(ctx, args)

  return {
    summary: `Prepared local Agentic run for ${run.graph.id} and wrote artifact ${run.artifact_id}.`,
    data: {
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
  return {
    summary: initialized
      ? "Local Agentic runtime glue is initialized."
      : "Local runtime package is installed; run `agentic runtime init local` to create local glue.",
    data: {
      initialized,
      state_path: workspaceRelative(ctx, statePath(ctx)),
      targets_dir: workspaceRelative(ctx, targetsDir(ctx)),
      targets_dir_exists: await dirExists(targetsDir(ctx)),
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
