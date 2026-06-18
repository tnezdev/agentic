import { spawn } from "node:child_process"
import { access, appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  AGENTIC_BUNDLE_MANIFEST_FILENAMES,
  activatePersona,
  FilesystemArtifactAdapter,
  FilesystemPersonaAdapter,
  FilesystemTaskAdapter,
  FilesystemWorkflowAdapter,
  computeActionDigest,
  createApprovalRequest,
  evaluateActionPolicy,
  loadAgenticBundle,
  loadSkill,
  resolveActionProposal,
} from "@tnezdev/agentic"
import type {
  ActionCapabilityDeclaration,
  ActionDataBoundaryPolicy,
  ActionDeclaration,
  ActionDecision,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionGatewayPort,
  ActionIntegrationDeclaration,
  ActionProposalTemplate,
  ActionProposal,
  ActionRecord,
  ActionStatus,
  AgenticPorts,
  ArtifactPort,
  ArtifactAdapter,
  ArtifactMetadata,
  ArtifactRecord,
  ApprovalDecisionRecord,
  ApprovalRequest,
  CheckActionStatusRequest,
  CheckActionStatusResult,
  GraphDef,
  HookDeclaration,
  JsonObject,
  JsonValue,
  LoadedAgenticBundle,
  LoadedAgenticBundleData,
  Persona,
  PersonaFile,
  PersonaRef,
  ReadArtifactRequest,
  ReadArtifactResult,
  ResolvedActionProposal,
  RequestActionRequest,
  RequestActionResult,
  ScheduleDeclaration,
  Skill,
  SurfaceDeclaration,
  Task,
  TaskQuery,
  WriteDraftArtifactRequest,
  WriteDraftArtifactResult,
} from "@tnezdev/agentic"
import type {
  AgenticRuntimePackage,
  RuntimeCommandResult,
  RuntimeContext,
  RuntimeApprovalDecisionArgs,
  RuntimeInitArgs,
  RuntimeInvocation,
  RuntimeInvocationHarnessRef,
  RuntimeRunArgs,
  RuntimeStatusArgs,
} from "@tnezdev/agentic/runtime"

const RUNTIME_NAME = "local"
const PACKAGE_NAME = "@tnezdev/agentic-runtime-local"
const STATE_VERSION = 1
const RUNTIME_DIR = join(".agentic", "runtime", RUNTIME_NAME)
const TARGETS_DIR = "targets"
const INVOCATIONS_DIR = "invocations"
const PI_SESSIONS_DIR = "pi-sessions"
const STATE_FILE = "runtime.json"
const APPROVAL_DECISIONS_DIR = "approval-decisions"
const APPROVAL_DECISIONS_LOG = "approval-decisions.jsonl"
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RANDOM_LEN = 16
const OUTPUT_CAPTURE_LIMIT = 20_000
const DEFAULT_UI_HOST = "127.0.0.1"
const DEFAULT_UI_PORT = 8787
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|credential|password|secret|token)/i

type LocalHarness = "none" | "pi"
type LocalContextMode = "workflow" | "artifacts" | "bundle"

type LocalRuntimeTargetArgs = {
  target?: string | undefined
  args: string[]
  flags: RuntimeRunArgs["flags"]
}

export type LocalAdminConsoleOptions = {
  target?: string | undefined
  args?: string[] | undefined
  flags?: RuntimeRunArgs["flags"] | undefined
  csrfToken?: string | undefined
}

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

export type LocalAdminPrincipal = {
  id: string
  kind: string
  roles: string[]
  description?: string | undefined
}

export type LocalAdminApproval = {
  action: ActionRecord
  approval_request_artifact: LocalBundleArtifactRecord
  approval_request: ApprovalRequest
  input_artifacts: LocalBundleArtifactRecord[]
  decision?: ApprovalDecisionRecord | undefined
}

export type LocalAdminConsoleState = {
  workspace: {
    root: string
    label: string
  }
  bundle: {
    name: string
    version: string
    schema_version: string
    manifest_path: string
  }
  run: {
    id: string
    dir: string
    summary_path: string
    latest_path: string
    status: string
    summary_markdown?: string | undefined
  }
  latest: LocalBundleRunLatest
  actions: ActionRecord[]
  artifacts: LocalBundleArtifactRecord[]
  approval_decisions: ApprovalDecisionRecord[]
  approvals: LocalAdminApproval[]
  human_principals: LocalAdminPrincipal[]
}

type LocalRunContext = {
  context_mode: LocalContextMode
  target: LocalRunTarget
  bundle?: LoadedAgenticBundle | undefined
  bundle_run_id?: string | undefined
  bundle_run_dir?: string | undefined
  bundle_summary_path?: string | undefined
  bundle_latest_path?: string | undefined
  bundle_latest?: LocalBundleRunLatest | undefined
  graph?: GraphDef | undefined
  persona?: PersonaFile | undefined
  activated_persona?: Persona | undefined
  skills: Skill[]
  input_artifacts: LocalInputArtifact[]
  task?: Task | undefined
  workflow_run_id?: string | undefined
  artifact_id: string
  invocation_id: string
  harness_ref?: RuntimeInvocationHarnessRef | undefined
}

type LocalInputArtifact = {
  id: string
  type: string
  title: string
  version: number
  finalized: boolean
  tags: string[]
  body: string
}

type PiHarnessResult = {
  provider: "pi"
  mode: "print" | "interactive"
  session_id: string
  session_dir: string
  system_prompt_path: string
  user_prompt_path: string
  exit_code: number
  stdout: string
  stderr: string
}

export type LocalActionGatewayArtifact = {
  id: string
  type: string
}

export type LocalActionGatewayDeclarations = {
  principals: readonly string[]
  actions: readonly ActionDeclaration[]
  capabilities?: readonly ActionCapabilityDeclaration[] | undefined
  integrations?: readonly ActionIntegrationDeclaration[] | undefined
  data_boundary?: ActionDataBoundaryPolicy | undefined
}

export function createLocalActionGatewayDeclarations(bundle: LoadedAgenticBundle): LocalActionGatewayDeclarations {
  const declarations: LocalActionGatewayDeclarations = {
    principals: bundle.manifest.principals.map((principal) => principal.id),
    actions: bundle.actions.map((entry) => entry.data as unknown as ActionDeclaration),
    capabilities: bundle.capabilities.map((entry) => entry.data as unknown as ActionCapabilityDeclaration),
    integrations: bundle.integrations.map((entry) => entry.data as unknown as ActionIntegrationDeclaration),
  }
  const dataBoundary = bundle.policies.find((entry) => entry.id === "data-boundary")?.data
  if (dataBoundary !== undefined) {
    declarations.data_boundary = dataBoundary as unknown as ActionDataBoundaryPolicy
  }
  return declarations
}

export type LocalApprovalRequestArtifactInput = {
  id: string
  type: "approval-request"
  title: string
  status: "pending"
  data_class: string
  tags: string[]
  body: ApprovalRequest
  derived_from: string[]
  created_by_action_id: string
}

export type LocalActionGatewayStore<TArtifact extends LocalActionGatewayArtifact> = {
  nextId(prefix: string): string
  recordAction(input: Omit<ActionRecord, "created_at" | "completed_at">): Promise<ActionRecord>
  readAction?(actionId: string): Promise<ActionRecord | undefined>
  writeApprovalRequest(input: LocalApprovalRequestArtifactInput): Promise<TArtifact>
  readApprovalRequest?(actionId: string): Promise<ApprovalRequest | undefined>
}

export type LocalBundleArtifactRecord = LocalActionGatewayArtifact & {
  title: string
  status: string
  version: number
  finalized: boolean
  data_class: string
  tags: string[]
  body: JsonObject
  source?: JsonObject | undefined
  derived_from?: string[] | undefined
  created_by_action_id: string
  created_at: string
}

export type LocalBundleArtifactInput = Omit<
  LocalBundleArtifactRecord,
  "version" | "finalized" | "created_at"
> & {
  finalized?: boolean | undefined
}

export type LocalBundleRunLatest = {
  run_id: string
} & Record<string, unknown>

export class LocalBundleRunStore {
  readonly runDir: string
  readonly artifactDir: string
  readonly actionDir: string
  readonly actionLogPath: string
  readonly approvalDecisionDir: string
  readonly approvalDecisionLogPath: string
  readonly summaryPath: string
  readonly latestPath: string
  readonly actions: ActionRecord[] = []
  readonly artifacts: LocalBundleArtifactRecord[] = []
  readonly approvalDecisions: ApprovalDecisionRecord[] = []
  #sequence = 0

  constructor(readonly stateDir: string, readonly runId: string) {
    this.runDir = join(stateDir, "runs", runId)
    this.artifactDir = join(this.runDir, "artifacts")
    this.actionDir = join(this.runDir, "actions")
    this.actionLogPath = join(this.runDir, "actions.jsonl")
    this.approvalDecisionDir = join(this.runDir, APPROVAL_DECISIONS_DIR)
    this.approvalDecisionLogPath = join(this.runDir, APPROVAL_DECISIONS_LOG)
    this.summaryPath = join(this.runDir, "summary.md")
    this.latestPath = join(stateDir, "latest.json")
  }

  async init(): Promise<void> {
    await mkdir(this.artifactDir, { recursive: true })
    await mkdir(this.actionDir, { recursive: true })
    await mkdir(this.approvalDecisionDir, { recursive: true })
    await writeFile(this.actionLogPath, "", "utf-8")
    await writeFile(this.approvalDecisionLogPath, "", "utf-8")
  }

  nextId(prefix: string): string {
    this.#sequence += 1
    return `${prefix}_${String(this.#sequence).padStart(4, "0")}`
  }

  async writeArtifact(input: LocalBundleArtifactInput): Promise<LocalBundleArtifactRecord> {
    const artifact: LocalBundleArtifactRecord = {
      ...input,
      version: 1,
      finalized: input.finalized ?? true,
      created_at: new Date().toISOString(),
    }
    this.rememberArtifact(artifact)
    await writeJson(join(this.artifactDir, `${artifact.id}.json`), artifact)
    return artifact
  }

  async readArtifact(input: ReadArtifactRequest): Promise<ReadArtifactResult<LocalBundleArtifactRecord>> {
    const artifact = await this.requireArtifact(input.artifact_id)
    if (input.version !== undefined && input.version !== artifact.version) {
      throw new Error(`Artifact ${input.artifact_id} version ${input.version} not found`)
    }
    return { artifact, body: artifact.body }
  }

  async writeDraftArtifact(
    input: WriteDraftArtifactRequest,
  ): Promise<WriteDraftArtifactResult<LocalBundleArtifactRecord>> {
    if (input.artifact_id !== undefined) {
      const existing = await this.requireArtifact(input.artifact_id)
      if (existing.finalized) throw new Error(`Artifact ${input.artifact_id} is finalized and cannot be written`)
      const mode = input.mode ?? "iterate"
      if (mode !== "iterate" && mode !== "replace") {
        throw new Error('writeDraftArtifact mode must be "iterate" or "replace".')
      }
      existing.body = jsonObjectValue(input.body)
      if (mode === "iterate") existing.version += 1
      await writeJson(join(this.artifactDir, `${existing.id}.json`), existing)
      return { artifact: existing }
    }

    const type = requiredPortString(input.type, "type")
    const title = requiredPortString(input.title, "title")
    const body = jsonObjectValue(input.body)
    const draft: LocalBundleArtifactInput = {
      id: this.nextId(bundleArtifactIdPrefix(type)),
      type,
      title,
      status: "draft",
      data_class: stringJsonValue(body.data_class) ?? "unknown",
      tags: input.tags ?? [],
      body,
      created_by_action_id: "port:writeDraftArtifact",
      finalized: false,
    }
    if (input.derived_from !== undefined) draft.derived_from = [input.derived_from]
    return { artifact: await this.writeArtifact(draft) }
  }

  async recordAction(input: Omit<ActionRecord, "created_at" | "completed_at">): Promise<ActionRecord> {
    const timestamp = new Date().toISOString()
    const action: ActionRecord = {
      ...input,
      created_at: timestamp,
      completed_at: timestamp,
    }
    this.rememberAction(action)
    await writeJson(join(this.actionDir, `${action.id}.json`), action)
    await appendFile(this.actionLogPath, `${JSON.stringify(action)}\n`, "utf-8")
    return action
  }

  async readAction(actionId: string): Promise<ActionRecord | undefined> {
    const existing = this.actions.find((entry) => entry.id === actionId)
    if (existing !== undefined) return existing
    try {
      const action = JSON.parse(await readFile(join(this.actionDir, `${actionId}.json`), "utf-8")) as ActionRecord
      this.rememberAction(action)
      return action
    } catch {
      return undefined
    }
  }

  async loadActions(): Promise<ActionRecord[]> {
    let entries: string[]
    try {
      entries = await readdir(this.actionDir)
    } catch {
      return this.actions
    }
    for (const entry of entries.filter((item) => item.endsWith(".json"))) {
      await this.readAction(entry.replace(/\.json$/, ""))
    }
    return this.actions.sort((a, b) => {
      return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    })
  }

  async loadArtifacts(): Promise<LocalBundleArtifactRecord[]> {
    let entries: string[]
    try {
      entries = await readdir(this.artifactDir)
    } catch {
      return this.artifacts
    }
    for (const entry of entries.filter((item) => item.endsWith(".json"))) {
      try {
        const artifact = JSON.parse(
          await readFile(join(this.artifactDir, entry), "utf-8"),
        ) as LocalBundleArtifactRecord
        this.rememberArtifact(artifact)
      } catch {
        // Ignore malformed generated records so later repair remains possible.
      }
    }
    return this.artifacts.sort((a, b) => {
      return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    })
  }

  async readApprovalRequestArtifact(actionId: string): Promise<LocalBundleArtifactRecord | undefined> {
    const artifacts = await this.loadArtifacts()
    return artifacts.find((artifact) => {
      return artifact.type === "approval-request" && stringJsonValue(artifact.body.action_id) === actionId
    })
  }

  async nextApprovalDecisionId(): Promise<string> {
    await this.loadApprovalDecisions()
    let index = this.approvalDecisions.length + 1
    while (true) {
      const id = `approval_decision_${String(index).padStart(4, "0")}`
      if (!(await pathExists(join(this.approvalDecisionDir, `${id}.json`)))) return id
      index += 1
    }
  }

  async recordApprovalDecision(
    input: Omit<ApprovalDecisionRecord, "decided_at">,
  ): Promise<ApprovalDecisionRecord> {
    const decision: ApprovalDecisionRecord = {
      ...input,
      decided_at: new Date().toISOString(),
    }
    this.rememberApprovalDecision(decision)
    await mkdir(this.approvalDecisionDir, { recursive: true })
    await writeJson(join(this.approvalDecisionDir, `${decision.id}.json`), decision)
    await appendFile(this.approvalDecisionLogPath, `${JSON.stringify(decision)}\n`, "utf-8")
    return decision
  }

  async readApprovalDecisionByAction(actionId: string): Promise<ApprovalDecisionRecord | undefined> {
    const decisions = await this.loadApprovalDecisions()
    return [...decisions].reverse().find((decision) => decision.action_id === actionId)
  }

  async loadApprovalDecisions(): Promise<ApprovalDecisionRecord[]> {
    let entries: string[]
    try {
      entries = await readdir(this.approvalDecisionDir)
    } catch {
      return this.approvalDecisions
    }
    for (const entry of entries.filter((item) => item.endsWith(".json"))) {
      try {
        const decision = JSON.parse(
          await readFile(join(this.approvalDecisionDir, entry), "utf-8"),
        ) as ApprovalDecisionRecord
        this.rememberApprovalDecision(decision)
      } catch {
        // Ignore malformed generated records so status remains usable for repair.
      }
    }
    return this.approvalDecisions.sort((a, b) => {
      return a.decided_at.localeCompare(b.decided_at) || a.id.localeCompare(b.id)
    })
  }

  async writeSummary(markdown: string, latest: LocalBundleRunLatest): Promise<void> {
    await writeFile(this.summaryPath, markdown, "utf-8")
    await writeJson(this.latestPath, latest)
  }

  private rememberAction(action: ActionRecord): void {
    const index = this.actions.findIndex((entry) => entry.id === action.id)
    if (index === -1) {
      this.actions.push(action)
    } else {
      this.actions[index] = action
    }
  }

  private rememberArtifact(artifact: LocalBundleArtifactRecord): void {
    const index = this.artifacts.findIndex((entry) => entry.id === artifact.id)
    if (index === -1) {
      this.artifacts.push(artifact)
    } else {
      this.artifacts[index] = artifact
    }
  }

  private rememberApprovalDecision(decision: ApprovalDecisionRecord): void {
    const index = this.approvalDecisions.findIndex((entry) => entry.id === decision.id)
    if (index === -1) {
      this.approvalDecisions.push(decision)
    } else {
      this.approvalDecisions[index] = decision
    }
  }

  private async requireArtifact(artifactId: string): Promise<LocalBundleArtifactRecord> {
    const existing = this.artifacts.find((entry) => entry.id === artifactId)
    if (existing !== undefined) return existing
    try {
      const artifact = JSON.parse(
        await readFile(join(this.artifactDir, `${artifactId}.json`), "utf-8"),
      ) as LocalBundleArtifactRecord
      this.rememberArtifact(artifact)
      return artifact
    } catch {
      throw new Error(`Artifact not found: ${artifactId}`)
    }
  }
}

export function createLocalBundleRunId(date = new Date()): string {
  return `run-${date.toISOString().replace(/[:.]/g, "-")}`
}

export type LocalActionExecutionResult<TArtifact extends LocalActionGatewayArtifact> = ActionExecutionResult & {
  artifacts?: TArtifact[] | undefined
}

export type LocalActionHandler<TArtifact extends LocalActionGatewayArtifact> = (
  context: ActionExecutionContext,
) => Promise<LocalActionExecutionResult<TArtifact>>

export type LocalActionGatewayResult<TArtifact extends LocalActionGatewayArtifact> = {
  action: ActionRecord
  artifacts: TArtifact[]
  approval_request_artifact?: TArtifact | undefined
}

export type LocalActionGatewayOptions = {
  approvalExpiresAt?: () => string
}

export type LocalArtifactPort<TReadArtifact = ArtifactMetadata, TWriteArtifact = ArtifactRecord> =
  ArtifactPort<TReadArtifact, TWriteArtifact>

export type LocalAgenticPortsOptions<TArtifact extends LocalActionGatewayArtifact> = {
  handlers?: Partial<Record<string, LocalActionHandler<TArtifact>>> | undefined
}

export function createFilesystemArtifactPort(
  artifacts: ArtifactAdapter,
): LocalArtifactPort<ArtifactMetadata, ArtifactRecord> {
  return {
    async readArtifact(input) {
      const artifact = await artifacts.inspect(input.artifact_id)
      return {
        artifact,
        body: await artifacts.read(input.artifact_id, { version: input.version }),
      }
    },
    async writeDraftArtifact(input) {
      const body = artifactPortBodyToString(input.body)
      if (input.artifact_id !== undefined) {
        const mode = input.mode ?? "iterate"
        if (mode !== "iterate" && mode !== "replace") {
          throw new Error('writeDraftArtifact mode must be "iterate" or "replace".')
        }
        return {
          artifact: await artifacts.write(input.artifact_id, { body, mode }),
        }
      }

      const type = requiredPortString(input.type, "type")
      const title = requiredPortString(input.title, "title")
      const createInput: {
        type: string
        title: string
        body: string
        tags?: string[] | undefined
        derived_from?: string | undefined
      } = { type, title, body }
      if (input.tags !== undefined) createInput.tags = input.tags
      if (input.derived_from !== undefined) createInput.derived_from = input.derived_from
      return {
        artifact: await artifacts.create(createInput),
      }
    },
  }
}

export class LocalAgenticPorts<
  TActionArtifact extends LocalActionGatewayArtifact,
  TReadArtifact = ArtifactMetadata,
  TWriteArtifact = ArtifactRecord,
> implements AgenticPorts<TReadArtifact, TWriteArtifact> {
  constructor(
    readonly gateway: LocalActionGateway<TActionArtifact>,
    readonly artifacts: LocalArtifactPort<TReadArtifact, TWriteArtifact>,
    readonly options: LocalAgenticPortsOptions<TActionArtifact> = {},
  ) {}

  async readArtifact(input: ReadArtifactRequest): Promise<ReadArtifactResult<TReadArtifact>> {
    return this.artifacts.readArtifact(input)
  }

  async writeDraftArtifact(
    input: WriteDraftArtifactRequest,
  ): Promise<WriteDraftArtifactResult<TWriteArtifact>> {
    return this.artifacts.writeDraftArtifact(input)
  }

  async requestAction(input: RequestActionRequest): Promise<RequestActionResult> {
    return this.gateway.requestAction(input, this.options.handlers?.[input.type])
  }

  async checkActionStatus(input: CheckActionStatusRequest): Promise<CheckActionStatusResult> {
    return this.gateway.checkActionStatus(input)
  }
}

export type LocalBundlePorts = LocalAgenticPorts<
  LocalBundleArtifactRecord,
  LocalBundleArtifactRecord,
  LocalBundleArtifactRecord
>

export type LocalBundlePortsOptions = LocalAgenticPortsOptions<LocalBundleArtifactRecord> & {
  approvalRequestTags?: string[] | undefined
}

function createLocalBundleActionGateway(
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  approvalRequestTags: string[] = [],
): LocalActionGateway<LocalBundleArtifactRecord> {
  return new LocalActionGateway<LocalBundleArtifactRecord>(
    createLocalActionGatewayDeclarations(bundle),
    {
      nextId: (prefix) => store.nextId(prefix),
      recordAction: (input) => store.recordAction(input),
      readAction: (actionId) => store.readAction(actionId),
      writeApprovalRequest: (input) => store.writeArtifact({
        id: input.id,
        type: input.type,
        title: input.title,
        status: input.status,
        data_class: input.data_class,
        tags: [...approvalRequestTags, ...input.tags],
        body: input.body as unknown as JsonObject,
        derived_from: input.derived_from,
        created_by_action_id: input.created_by_action_id,
      }),
    },
  )
}

export type LocalBundleHandlerFactoryContext = {
  bundle: LoadedAgenticBundle
  store: LocalBundleRunStore
  deploy: LoadedAgenticBundleData
  handler_module_path: string
}

export type LocalBundleActionHandlerFactory = (
  context: LocalBundleHandlerFactoryContext,
) => LocalActionHandler<LocalBundleArtifactRecord> | Promise<LocalActionHandler<LocalBundleArtifactRecord>>

export type LocalBundleProposalPayloadFactoryContext = LocalBundleHandlerFactoryContext & {
  trigger: "hook"
  trigger_id: string
  proposed_action: string
  input_artifacts: LocalBundleArtifactRecord[]
}

export type LocalBundleProposalPayloadFactory = (
  context: LocalBundleProposalPayloadFactoryContext,
) => JsonObject | Promise<JsonObject>

export type LocalBundleRuntimeBindings = {
  handlers: Partial<Record<string, LocalActionHandler<LocalBundleArtifactRecord>>>
  proposalPayloads: Partial<Record<string, LocalBundleProposalPayloadFactory>>
  deploy?: LoadedAgenticBundleData | undefined
  handlerModulePath?: string | undefined
}

export type LoadLocalBundleHandlersOptions = {
  deployId?: string | undefined
  workspaceRoot?: string | undefined
}

type LocalBundleHandlerSpec = {
  module: string
  actions: Record<string, string>
  proposalPayloads: Record<string, string>
}

export function createLocalBundlePorts(
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  options: LocalBundlePortsOptions = {},
): LocalBundlePorts {
  const { approvalRequestTags = [], ...portsOptions } = options
  const gateway = createLocalBundleActionGateway(bundle, store, approvalRequestTags)
  return new LocalAgenticPorts(
    gateway,
    {
      readArtifact: (input) => store.readArtifact(input),
      writeDraftArtifact: (input) => store.writeDraftArtifact(input),
    },
    portsOptions,
  )
}

export async function loadLocalBundleHandlers(
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  options: LoadLocalBundleHandlersOptions = {},
): Promise<Partial<Record<string, LocalActionHandler<LocalBundleArtifactRecord>>>> {
  return (await loadLocalBundleRuntimeBindings(bundle, store, options)).handlers
}

export async function loadLocalBundleRuntimeBindings(
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  options: LoadLocalBundleHandlersOptions = {},
): Promise<LocalBundleRuntimeBindings> {
  const deploy = selectLocalBundleHandlerDeploy(bundle, options.deployId)
  if (deploy === undefined) return { handlers: {}, proposalPayloads: {} }

  const spec = localBundleHandlerSpec(deploy)
  if (spec === undefined) return { handlers: {}, proposalPayloads: {} }

  const modulePath = resolveLocalBundleHandlerModulePath(bundle, spec.module, options.workspaceRoot)
  let moduleExports: Record<string, unknown>
  try {
    moduleExports = await import(pathToFileURL(modulePath).href) as Record<string, unknown>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to load local bundle handler module ${modulePath}: ${message}`)
  }

  const context: LocalBundleHandlerFactoryContext = {
    bundle,
    store,
    deploy,
    handler_module_path: modulePath,
  }
  const handlers: Partial<Record<string, LocalActionHandler<LocalBundleArtifactRecord>>> = {}
  for (const [actionType, exportName] of Object.entries(spec.actions)) {
    const factory = moduleExports[exportName]
    if (typeof factory !== "function") {
      throw new Error(`Local bundle handler ${actionType} references missing export ${exportName}.`)
    }
    const handler = await (factory as LocalBundleActionHandlerFactory)(context)
    if (typeof handler !== "function") {
      throw new Error(`Local bundle handler export ${exportName} did not return a handler function.`)
    }
    handlers[actionType] = handler
  }

  const proposalPayloads: Partial<Record<string, LocalBundleProposalPayloadFactory>> = {}
  for (const [triggerId, exportName] of Object.entries(spec.proposalPayloads)) {
    const factory = moduleExports[exportName]
    if (typeof factory !== "function") {
      throw new Error(`Local bundle proposal payload ${triggerId} references missing export ${exportName}.`)
    }
    proposalPayloads[triggerId] = factory as LocalBundleProposalPayloadFactory
  }

  return { handlers, proposalPayloads, deploy, handlerModulePath: modulePath }
}

function selectLocalBundleHandlerDeploy(
  bundle: LoadedAgenticBundle,
  deployId: string | undefined,
): LoadedAgenticBundleData | undefined {
  if (deployId !== undefined) {
    const deploy = bundle.deploy.find((entry) => entry.id === deployId)
    if (deploy === undefined) throw new Error(`Missing local bundle deploy target: ${deployId}`)
    return deploy
  }
  return bundle.deploy.find((entry) => localBundleHandlersConfig(entry.data) !== undefined)
}

function localBundleHandlerSpec(deploy: LoadedAgenticBundleData): LocalBundleHandlerSpec | undefined {
  const handlers = localBundleHandlersConfig(deploy.data)
  if (handlers === undefined) return undefined

  const moduleRef = nonEmptyConfigString(handlers.module)
  if (moduleRef === undefined) {
    throw new Error(`deploy ${deploy.id} runtime.local.handlers.module must be a non-empty string.`)
  }
  const actions = stringRecordConfig(handlers.actions, `deploy ${deploy.id} runtime.local.handlers.actions`)
  const proposalPayloads = stringRecordConfig(
    handlers.proposal_payloads,
    `deploy ${deploy.id} runtime.local.handlers.proposal_payloads`,
  )
  if (Object.keys(actions).length === 0 && Object.keys(proposalPayloads).length === 0) {
    throw new Error(`deploy ${deploy.id} runtime.local.handlers must declare at least one handler or payload factory.`)
  }
  return { module: moduleRef, actions, proposalPayloads }
}

function localBundleHandlersConfig(deploy: JsonObject): JsonObject | undefined {
  const runtime = jsonObjectConfig(deploy.runtime)
  const local = jsonObjectConfig(runtime?.local)
  return jsonObjectConfig(local?.handlers)
}

function resolveLocalBundleHandlerModulePath(
  bundle: LoadedAgenticBundle,
  moduleRef: string,
  workspaceRoot: string | undefined,
): string {
  if (isAbsolute(moduleRef) || moduleRef.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(moduleRef)) {
    throw new Error(`Local bundle handler module ${moduleRef} must be a relative path.`)
  }
  const modulePath = resolve(bundle.root, moduleRef)
  const boundaryRoot = resolve(workspaceRoot ?? bundle.root)
  if (!pathIsInside(boundaryRoot, modulePath)) {
    throw new Error(`Local bundle handler module ${moduleRef} must stay inside workspace root ${boundaryRoot}.`)
  }
  return modulePath
}

function pathIsInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function jsonObjectConfig(value: JsonValue | undefined): JsonObject | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value
  return undefined
}

function nonEmptyConfigString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function stringRecordConfig(value: JsonValue | undefined, field: string): Record<string, string> {
  if (value === undefined) return {}
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object mapping action types to handler exports.`)
  }

  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(`${field}.${key} must be a non-empty string.`)
    }
    record[key] = entry
  }
  return record
}

export type LocalBundleActionRequestOptions = {
  principal?: string | undefined
  data_class?: string | undefined
  input_artifact_ids?: string[] | undefined
  payload?: JsonObject | undefined
}

export async function requestLocalBundleSurfaceAction(
  ports: Pick<ActionGatewayPort, "requestAction">,
  surface: SurfaceDeclaration,
  options: LocalBundleActionRequestOptions = {},
): Promise<RequestActionResult> {
  return ports.requestAction(createLocalBundleActionRequest(surface.proposes, options, {
    context: "surface",
    contextId: surface.id,
    defaultPrincipal: surface.principal,
  }))
}

export async function requestLocalBundleScheduleAction(
  ports: Pick<ActionGatewayPort, "requestAction">,
  schedule: ScheduleDeclaration,
  options: LocalBundleActionRequestOptions = {},
): Promise<RequestActionResult> {
  return ports.requestAction(createLocalBundleActionRequest(schedule.proposes, options, {
    context: "schedule",
    contextId: schedule.id,
  }))
}

export async function requestLocalBundleHookAction(
  ports: Pick<ActionGatewayPort, "requestAction">,
  hook: HookDeclaration,
  options: LocalBundleActionRequestOptions = {},
): Promise<RequestActionResult> {
  return ports.requestAction(createLocalBundleActionRequest(hook.proposes, options, {
    context: "hook",
    contextId: hook.id,
  }))
}

function createLocalBundleActionRequest(
  template: ActionProposalTemplate,
  options: LocalBundleActionRequestOptions,
  source: {
    context: "surface" | "schedule" | "hook"
    contextId: string
    defaultPrincipal?: string | undefined
  },
): RequestActionRequest {
  const principal = template.principal ?? options.principal ?? source.defaultPrincipal
  if (principal === undefined) {
    throw new Error(`${source.context} ${source.contextId} action proposal requires a principal.`)
  }
  const dataClass = template.data_class ?? options.data_class
  if (dataClass === undefined) {
    throw new Error(`${source.context} ${source.contextId} action proposal requires data_class.`)
  }

  const request: RequestActionRequest = {
    type: template.action,
    principal,
    data_class: dataClass,
    [source.context]: source.contextId,
  }
  if (template.capability !== undefined) request.capability = template.capability
  const inputArtifactIds = template.input_artifact_ids ?? options.input_artifact_ids
  if (inputArtifactIds !== undefined) request.input_artifact_ids = inputArtifactIds
  const payload = template.payload ?? options.payload
  if (payload !== undefined) request.payload = payload
  return request
}

type LocalBundleTriggerExecutionResult = {
  latest: LocalBundleRunLatest
  summary: string
}

async function executeLocalBundleTriggers(
  target: LocalRunTarget,
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  invocation: RuntimeInvocation,
  options: LoadLocalBundleHandlersOptions,
): Promise<LocalBundleTriggerExecutionResult> {
  if (bundle.surfaces.length === 0 && bundle.schedules.length === 0 && bundle.hooks.length === 0) {
    const latest = preparedBundleLatest(target, bundle, store, invocation)
    return { latest, summary: renderBundlePreparedSummary(target, bundle, store, invocation) }
  }

  const bindings = await loadLocalBundleRuntimeBindings(bundle, store, options)
  const ports = createLocalBundlePorts(bundle, store, { handlers: bindings.handlers })
  const surfaces = bundle.surfaces.map((entry) => entry.data as unknown as SurfaceDeclaration)
  const schedules = bundle.schedules.map((entry) => entry.data as unknown as ScheduleDeclaration)
  const hooks = bundle.hooks.map((entry) => entry.data as unknown as HookDeclaration)

  for (const surface of surfaces) {
    await requestLocalBundleSurfaceAction(ports, surface, {
      payload: surfacePayload(surface),
    })
  }

  for (const schedule of schedules) {
    const selected = selectScheduleArtifacts(store, schedule)
    if (selected.length === 0) continue
    const inputArtifactIds = selected.map((artifact) => artifact.id)
    const dataClass = schedule.proposes.data_class ?? selected[0]!.data_class
    await ports.requestAction({
      type: "schedule.tick",
      principal: schedule.principal,
      data_class: dataClass,
      schedule: schedule.id,
      input_artifact_ids: inputArtifactIds,
      payload: {
        cron: schedule.cron,
        selected_artifacts: inputArtifactIds,
      },
    })
    await requestLocalBundleScheduleAction(ports, schedule, {
      data_class: dataClass,
      input_artifact_ids: inputArtifactIds,
    })
  }

  for (const hook of hooks) {
    const matches = selectHookArtifacts(store, hook)
    for (const artifact of matches) {
      const inputArtifacts = relatedHookArtifacts(store, artifact)
      const inputArtifactIds = inputArtifacts.map((entry) => entry.id)
      const dataClass = hook.proposes.data_class ?? artifact.data_class
      await ports.requestAction({
        type: "hook.run",
        principal: "service:agentic-runtime",
        data_class: dataClass,
        hook: hook.id,
        input_artifact_ids: [artifact.id],
        payload: {
          trigger: hook.on as unknown as JsonObject,
          proposed_action: hook.proposes.action,
        },
      })
      const payload = await localBundleProposalPayload(bindings, {
        bundle,
        store,
        trigger: "hook",
        trigger_id: hook.id,
        proposed_action: hook.proposes.action,
        input_artifacts: inputArtifacts,
      }) ?? hook.proposes.payload
      await requestLocalBundleHookAction(ports, hook, {
        data_class: dataClass,
        input_artifact_ids: inputArtifactIds,
        payload,
      })
    }
  }

  const latest = completedBundleLatest(target, bundle, store, invocation)
  return { latest, summary: renderBundleCompletedSummary(target, bundle, store, latest) }
}

function surfacePayload(surface: SurfaceDeclaration): JsonObject | undefined {
  const payload: JsonObject = { ...(surface.proposes.payload ?? {}) }
  if (surface.route !== undefined && payload.route === undefined) payload.route = surface.route
  if (surface.fixture !== undefined && payload.fixture === undefined) payload.fixture = surface.fixture
  return Object.keys(payload).length > 0 ? payload : undefined
}

function selectScheduleArtifacts(
  store: LocalBundleRunStore,
  schedule: ScheduleDeclaration,
): LocalBundleArtifactRecord[] {
  const selector = schedule.selects
  if (selector === undefined) return [...store.artifacts]
  return store.artifacts.filter((artifact) => {
    if (artifact.type !== selector.artifact) return false
    if (selector.status !== undefined && artifact.status !== selector.status) return false
    return (selector.tags ?? []).every((tag) => artifact.tags.includes(tag))
  })
}

function selectHookArtifacts(
  store: LocalBundleRunStore,
  hook: HookDeclaration,
): LocalBundleArtifactRecord[] {
  return store.artifacts.filter((artifact) => {
    if (artifact.type !== hook.on["artifact.type"]) return false
    return hook.on["artifact.status"] === undefined || artifact.status === hook.on["artifact.status"]
  })
}

function relatedHookArtifacts(
  store: LocalBundleRunStore,
  artifact: LocalBundleArtifactRecord,
): LocalBundleArtifactRecord[] {
  const ids = [...(artifact.derived_from ?? []), artifact.id]
  return ids.map((id) => store.artifacts.find((entry) => entry.id === id)).filter((entry): entry is LocalBundleArtifactRecord => {
    return entry !== undefined
  })
}

async function localBundleProposalPayload(
  bindings: LocalBundleRuntimeBindings,
  context: Omit<LocalBundleProposalPayloadFactoryContext, "deploy" | "handler_module_path">,
): Promise<JsonObject | undefined> {
  const factory = bindings.proposalPayloads[context.trigger_id]
  if (factory === undefined) return undefined
  if (bindings.deploy === undefined || bindings.handlerModulePath === undefined) {
    throw new Error(`Local bundle proposal payload ${context.trigger_id} has no loaded deploy handler context.`)
  }
  return factory({
    ...context,
    deploy: bindings.deploy,
    handler_module_path: bindings.handlerModulePath,
  })
}

function preparedBundleLatest(
  target: LocalRunTarget,
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  invocation: RuntimeInvocation,
): LocalBundleRunLatest {
  return {
    ...bundleLatestBase(target, bundle, store, invocation),
    status: "prepared",
    message: "Bundle execution is prepared; no local trigger sequence was executed.",
  }
}

function failedBundleLatest(
  target: LocalRunTarget,
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  invocation: RuntimeInvocation,
  err: unknown,
): LocalBundleRunLatest {
  return {
    ...bundleLatestBase(target, bundle, store, invocation),
    status: "failed",
    message: "Bundle execution failed before completion.",
    error: errorMessage(err),
    actions: store.actions.map(summarizeBundleAction),
    artifacts: store.artifacts.map(summarizeBundleArtifact),
  }
}

function completedBundleLatest(
  target: LocalRunTarget,
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  invocation: RuntimeInvocation,
): LocalBundleRunLatest {
  const approvalAction = [...store.actions].reverse().find((action) => action.status === "approval_required")
  const approvalArtifact = store.artifacts.find((artifact) => artifact.type === "approval-request")
  const approvalActionId = approvalAction?.id ?? (
    approvalArtifact === undefined ? undefined : stringJsonValue(approvalArtifact.body.action_id)
  )
  const approvalDecisions = store.approvalDecisions.map(summarizeApprovalDecision)
  const latestDecision = approvalDecisions.at(-1)
  const externalWriteExecuted = store.actions.some((action) => {
    return action.status === "completed" && (action.effects ?? []).some((effect) => effect.startsWith("external.write:"))
  })
  const latest: LocalBundleRunLatest = {
    ...bundleLatestBase(target, bundle, store, invocation),
    status: "completed",
    message: "Bundle execution completed through local trigger declarations.",
    external_write_executed: externalWriteExecuted,
    actions: store.actions.map(summarizeBundleAction),
    artifacts: store.artifacts.map(summarizeBundleArtifact),
  }
  if (approvalActionId !== undefined) latest.approval_required_action_id = approvalActionId
  if (approvalArtifact !== undefined) latest.approval_request_artifact_id = approvalArtifact.id
  if (approvalDecisions.length > 0) latest.approval_decisions = approvalDecisions
  if (latestDecision !== undefined) {
    latest.approval_decision_id = latestDecision.id
    latest.approval_status = latestDecision.decision
  }
  return latest
}

function bundleLatestBase(
  target: LocalRunTarget,
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  invocation: RuntimeInvocation,
): LocalBundleRunLatest {
  return {
    run_id: store.runId,
    context_mode: "bundle",
    bundle: {
      name: bundle.manifest.name,
      version: bundle.manifest.version,
    },
    runtime_invocation_id: invocation.id,
    run_dir: pathRelative(target.workspace_root, store.runDir),
    summary_path: pathRelative(target.workspace_root, store.summaryPath),
    latest_path: pathRelative(target.workspace_root, store.latestPath),
  }
}

function summarizeBundleAction(action: ActionRecord): Pick<ActionRecord, "id" | "type" | "status" | "capability" | "error"> {
  const summary: Pick<ActionRecord, "id" | "type" | "status" | "capability" | "error"> = {
    id: action.id,
    type: action.type,
    status: action.status,
  }
  if (action.capability !== undefined) summary.capability = action.capability
  if (action.error !== undefined) summary.error = action.error
  return summary
}

function summarizeBundleArtifact(
  artifact: LocalBundleArtifactRecord,
): Pick<LocalBundleArtifactRecord, "id" | "type" | "title" | "status"> {
  return {
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    status: artifact.status,
  }
}

function summarizeApprovalDecision(
  decision: ApprovalDecisionRecord,
): Pick<ApprovalDecisionRecord, "id" | "action_id" | "decision" | "principal" | "capability"> {
  const summary: Pick<ApprovalDecisionRecord, "id" | "action_id" | "decision" | "principal" | "capability"> = {
    id: decision.id,
    action_id: decision.action_id,
    decision: decision.decision,
    principal: decision.principal,
  }
  if (decision.capability !== undefined) summary.capability = decision.capability
  return summary
}

function renderBundleCompletedSummary(
  target: LocalRunTarget,
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  latest: LocalBundleRunLatest,
): string {
  const inventoryRows = [
    ["prompts", bundle.prompts.map((entry) => entry.id)],
    ["skills", bundle.skills.map((entry) => entry.id)],
    ["artifacts", bundle.artifacts.map((entry) => entry.id)],
    ["actions", bundle.actions.map((entry) => entry.id)],
    ["capabilities", bundle.capabilities.map((entry) => entry.id)],
    ["hooks", bundle.hooks.map((entry) => entry.id)],
    ["surfaces", bundle.surfaces.map((entry) => entry.id)],
    ["schedules", bundle.schedules.map((entry) => entry.id)],
  ]
    .map(([section, ids]) => `| ${section} | ${(ids as string[]).join(", ")} |`)
    .join("\n")
  const actionRows = store.actions
    .map((action) => {
      const policy = action.policy?.decision ?? "not_checked"
      const reason = action.policy?.reason ?? "none"
      const digest = action.digest === undefined ? "none" : action.digest.slice(0, 12)
      return `| ${action.id} | ${action.type} | ${action.status} | ${action.capability ?? "none"} | ${policy} | ${digest} | ${reason} |`
    })
    .join("\n")
  const artifactRows = store.artifacts
    .map((artifact) => `| ${artifact.id} | ${artifact.type} | ${artifact.status} | ${artifact.title} |`)
    .join("\n")
  const approvalActionId = typeof latest.approval_required_action_id === "string"
    ? latest.approval_required_action_id
    : "none"
  const approvalArtifactId = typeof latest.approval_request_artifact_id === "string"
    ? latest.approval_request_artifact_id
    : "none"
  const approvalDecisionRows = store.approvalDecisions.length === 0
    ? "No approval decisions recorded."
    : [
        "| ID | Action | Decision | Principal | Capability | Comment |",
        "| --- | --- | --- | --- | --- | --- |",
        ...store.approvalDecisions.map((decision) => {
          return [
            `| ${decision.id}`,
            decision.action_id,
            decision.decision,
            decision.principal,
            decision.capability ?? "none",
            `${decision.comment ?? ""} |`,
          ].join(" | ")
        }),
      ].join("\n")

  return `# Local Bundle Run: ${bundle.manifest.name}

Run id: ${store.runId}
Bundle: ${bundle.manifest.name}@${bundle.manifest.version}

## What Happened

The local runtime loaded the authored bundle from \`${pathRelative(target.workspace_root, bundle.manifestPath)}\`, processed declared surfaces, schedules, and hooks, and stopped at any approval gate before external effects.

## Authored Bundle Inventory

| Section | Loaded ids |
| --- | --- |
${inventoryRows}

## Actions

| ID | Type | Status | Capability | Policy | Digest | Reason |
| --- | --- | --- | --- | --- | --- | --- |
${actionRows}

## Artifacts

| ID | Type | Status | Title |
| --- | --- | --- | --- |
${artifactRows}

## Approval Gate

- Action requiring approval: ${approvalActionId}
- Approval request artifact: ${approvalArtifactId}
- External write executed: ${latest.external_write_executed === true ? "yes" : "no"}

The runtime created exact action digests and approval requests. A host-owned authenticated approval channel must grant the exact action before approval-gated external effects execute.

## Approval Decisions

${approvalDecisionRows}

## Inspect

- Latest pointer: ${pathRelative(target.workspace_root, store.latestPath)}
- Action log: ${pathRelative(target.workspace_root, store.actionLogPath)}
- Action records: ${pathRelative(target.workspace_root, store.actionDir)}
- Artifact records: ${pathRelative(target.workspace_root, store.artifactDir)}
`
}

export class LocalActionGateway<TArtifact extends LocalActionGatewayArtifact> implements ActionGatewayPort {
  #actions = new Map<string, ActionRecord>()
  #approvalRequests = new Map<string, ApprovalRequest>()

  constructor(
    readonly declarations: LocalActionGatewayDeclarations,
    readonly store: LocalActionGatewayStore<TArtifact>,
    readonly options: LocalActionGatewayOptions = {},
  ) {}

  async requestAction(
    proposal: RequestActionRequest,
    execute?: LocalActionHandler<TArtifact> | undefined,
  ): Promise<RequestActionResult> {
    const result = await this.submit(proposal, execute)
    const output: RequestActionResult = {
      action: result.action,
      status: result.action.status,
      output_artifact_ids: result.action.output_artifact_ids ?? [],
    }
    if (result.approval_request_artifact !== undefined) {
      output.approval_request_artifact_id = result.approval_request_artifact.id
    }
    const approvalRequest = await this.readApprovalRequest(result.action.id)
    if (approvalRequest !== undefined) output.approval_request = approvalRequest
    return output
  }

  async checkActionStatus(input: CheckActionStatusRequest): Promise<CheckActionStatusResult> {
    const storedAction = this.store.readAction === undefined
      ? undefined
      : await this.store.readAction(input.action_id)
    const action = storedAction ?? this.#actions.get(input.action_id)
    if (action === undefined) {
      throw new Error(`Action not found: ${input.action_id}`)
    }

    const output: CheckActionStatusResult = { action }
    const approvalRequest = await this.readApprovalRequest(input.action_id)
    if (approvalRequest !== undefined) output.approval_request = approvalRequest
    return output
  }

  async submit(
    proposal: ActionProposal,
    execute?: LocalActionHandler<TArtifact> | undefined,
  ): Promise<LocalActionGatewayResult<TArtifact>> {
    const actionDeclaration = this.declarations.actions.find((action) => action.id === proposal.type)
    const actionId = proposal.id ?? this.store.nextId(actionIdPrefix(proposal.type))
    const resolved = resolveActionProposal(
      proposal,
      actionDeclaration ?? { id: proposal.type, effects: proposal.effects ?? [] },
      actionId,
    )
    const digest = computeActionDigest(resolved)

    if (actionDeclaration === undefined) {
      const policy: ActionDecision = {
        decision: "deny",
        code: "missing_action_declaration",
        reason: `Missing action declaration: ${proposal.type}.`,
      }
      const action = await this.recordAction(resolved, "denied", policy, digest)
      return { action, artifacts: [] }
    }

    const policy = evaluateActionPolicy({
      principals: this.declarations.principals,
      action: actionDeclaration,
      proposal: resolved,
      capabilities: this.declarations.capabilities,
      integrations: this.declarations.integrations,
      data_boundary: this.declarations.data_boundary,
    })

    if (policy.decision === "deny") {
      const action = await this.recordAction(resolved, "denied", policy, digest)
      return { action, artifacts: [] }
    }

    if (policy.decision === "approval_required") {
      const approvalRequestArtifact = await this.requestApproval(resolved, policy, digest)
      const action = await this.recordAction(resolved, "approval_required", policy, digest, [
        approvalRequestArtifact.id,
      ])
      return {
        action,
        artifacts: [approvalRequestArtifact],
        approval_request_artifact: approvalRequestArtifact,
      }
    }

    const context: ActionExecutionContext = {
      action_id: resolved.id,
      digest,
      proposal: resolved,
      action: actionDeclaration as unknown as JsonObject,
    }
    const capability = resolved.capability === undefined
      ? undefined
      : this.declarations.capabilities?.find((entry) => entry.id === resolved.capability)
    if (capability !== undefined) context.capability = capability as unknown as JsonObject

    let execution: LocalActionExecutionResult<TArtifact>
    try {
      execution = execute === undefined ? {} : await execute(context)
    } catch (err) {
      await this.recordAction(resolved, "failed", policy, digest, [], resolved.payload, errorMessage(err))
      throw err
    }
    const artifacts = execution.artifacts ?? []
    const outputArtifactIds = execution.output_artifact_ids ?? artifacts.map((artifact) => artifact.id)
    const action = await this.recordAction(
      resolved,
      "completed",
      policy,
      digest,
      outputArtifactIds,
      execution.payload ?? resolved.payload,
    )
    return { action, artifacts }
  }

  async resumeApprovedAction(
    storedAction: ActionRecord,
    execute?: LocalActionHandler<TArtifact> | undefined,
  ): Promise<LocalActionGatewayResult<TArtifact>> {
    const actionDeclaration = this.declarations.actions.find((action) => action.id === storedAction.type)
    if (actionDeclaration === undefined) throw new Error(`Missing action declaration: ${storedAction.type}.`)
    const resolved = resolvedProposalFromActionRecord(storedAction)
    const digest = computeActionDigest(resolved)
    if (storedAction.digest !== digest) {
      throw new Error(`Stored action digest does not match action ${storedAction.id}.`)
    }
    const policy: ActionDecision = {
      decision: "allow",
      code: "allowed",
      capability: storedAction.capability,
      reason: `Action ${storedAction.id} was resumed after a runtime-authenticated approval grant.`,
    }
    const context: ActionExecutionContext = {
      action_id: resolved.id,
      digest,
      proposal: resolved,
      action: actionDeclaration as unknown as JsonObject,
    }
    const capability = resolved.capability === undefined
      ? undefined
      : this.declarations.capabilities?.find((entry) => entry.id === resolved.capability)
    if (capability !== undefined) context.capability = capability as unknown as JsonObject

    let execution: LocalActionExecutionResult<TArtifact>
    try {
      execution = execute === undefined ? {} : await execute(context)
    } catch (err) {
      await this.recordAction(resolved, "failed", policy, digest, [], resolved.payload, errorMessage(err))
      throw err
    }
    const artifacts = execution.artifacts ?? []
    const outputArtifactIds = execution.output_artifact_ids ?? artifacts.map((artifact) => artifact.id)
    const action = await this.recordAction(
      resolved,
      "completed",
      policy,
      digest,
      outputArtifactIds,
      execution.payload ?? resolved.payload,
    )
    return { action, artifacts }
  }

  private async requestApproval(
    proposal: ResolvedActionProposal,
    policy: ActionDecision,
    actionDigest: string,
  ): Promise<TArtifact> {
    const approvalRequest = createApprovalRequest({
      proposal,
      action_digest: actionDigest,
      approver_rule: policy.required_approval,
      expires_at: this.options.approvalExpiresAt?.() ?? isoInHours(24),
    })
    this.#approvalRequests.set(proposal.id, approvalRequest)
    const approvalProposal: ActionProposal = {
      type: "approval.request",
      principal: "service:agentic-runtime",
      data_class: proposal.data_class,
      payload: approvalRequest as unknown as JsonObject,
    }
    if (proposal.input_artifact_ids !== undefined) {
      approvalProposal.input_artifact_ids = proposal.input_artifact_ids
    }

    const result = await this.submit(approvalProposal, async ({ action_id }) => {
      const artifact = await this.store.writeApprovalRequest({
        id: this.store.nextId("art_approval_request"),
        type: "approval-request",
        title: `Approval required for ${proposal.id}`,
        status: "pending",
        data_class: proposal.data_class,
        tags: ["approval", "pending"],
        body: approvalRequest,
        derived_from: proposal.input_artifact_ids ?? [],
        created_by_action_id: action_id,
      })
      return { artifacts: [artifact] }
    })

    const approvalRequestArtifact = result.artifacts.find((artifact) => artifact.type === "approval-request")
    if (approvalRequestArtifact === undefined) {
      throw new Error("Approval gateway did not create an approval-request artifact.")
    }
    return approvalRequestArtifact
  }

  private async recordAction(
    proposal: ResolvedActionProposal,
    status: ActionStatus,
    policy: ActionDecision,
    digest: string,
    outputArtifactIds: string[] = [],
    payload: JsonObject | undefined = proposal.payload,
    error?: string | undefined,
  ): Promise<ActionRecord> {
    const input: Omit<ActionRecord, "created_at" | "completed_at"> = {
      id: proposal.id,
      type: proposal.type,
      status,
      principal: proposal.principal,
      data_class: proposal.data_class,
      policy,
      digest,
    }
    if (proposal.capability !== undefined) input.capability = proposal.capability
    if (proposal.surface !== undefined) input.surface = proposal.surface
    if (proposal.schedule !== undefined) input.schedule = proposal.schedule
    if (proposal.hook !== undefined) input.hook = proposal.hook
    if (proposal.input_artifact_ids !== undefined) input.input_artifact_ids = proposal.input_artifact_ids
    if (outputArtifactIds.length > 0) input.output_artifact_ids = outputArtifactIds
    if (proposal.effects.length > 0) input.effects = proposal.effects
    if (payload !== undefined) input.payload = payload
    if (error !== undefined) input.error = error

    const action = await this.store.recordAction(input)
    this.#actions.set(action.id, action)
    return action
  }

  private async readApprovalRequest(actionId: string): Promise<ApprovalRequest | undefined> {
    const stored = this.store.readApprovalRequest === undefined
      ? undefined
      : await this.store.readApprovalRequest(actionId)
    return stored ?? this.#approvalRequests.get(actionId)
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function jsonObjectValue(value: JsonValue): JsonObject {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value
  return {}
}

function stringJsonValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function bundleArtifactIdPrefix(type: string): string {
  return `art_${type.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}`
}

function artifactPortBodyToString(body: JsonValue): string {
  if (typeof body === "string") return body
  return `${JSON.stringify(body, null, 2)}\n`
}

function requiredPortString(value: string | undefined, field: string): string {
  if (typeof value === "string" && value.trim() !== "") return value
  throw new Error(`writeDraftArtifact requires ${field} when artifact_id is omitted.`)
}

function resolvedProposalFromActionRecord(action: ActionRecord): ResolvedActionProposal {
  if (action.data_class === undefined) {
    throw new Error(`Action ${action.id} cannot be resumed because it has no data_class.`)
  }
  const proposal: ResolvedActionProposal = {
    id: action.id,
    type: action.type,
    principal: action.principal,
    data_class: action.data_class,
    effects: action.effects ?? [],
  }
  if (action.capability !== undefined) proposal.capability = action.capability
  if (action.surface !== undefined) proposal.surface = action.surface
  if (action.schedule !== undefined) proposal.schedule = action.schedule
  if (action.hook !== undefined) proposal.hook = action.hook
  if (action.input_artifact_ids !== undefined) proposal.input_artifact_ids = action.input_artifact_ids
  if (action.payload !== undefined) proposal.payload = action.payload
  return proposal
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

function isoInHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function actionIdPrefix(type: string): string {
  return `act_${type.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}`
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

function invocationsDirFor(workspaceRoot: string): string {
  return join(runtimeDirFor(workspaceRoot), INVOCATIONS_DIR)
}

function invocationsDir(ctx: RuntimeContext): string {
  return invocationsDirFor(ctx.workspace_root)
}

function piSessionsDirFor(workspaceRoot: string): string {
  return join(runtimeDirFor(workspaceRoot), PI_SESSIONS_DIR)
}

function invocationPathFor(workspaceRoot: string, invocationId: string): string {
  return join(invocationsDirFor(workspaceRoot), `${invocationId}.json`)
}

function piSystemPromptPathFor(workspaceRoot: string, invocationId: string): string {
  return join(invocationsDirFor(workspaceRoot), `${invocationId}.pi-system.md`)
}

function piUserPromptPathFor(workspaceRoot: string, invocationId: string): string {
  return join(invocationsDirFor(workspaceRoot), `${invocationId}.pi-user.md`)
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

async function hasBundleManifest(path: string): Promise<boolean> {
  for (const filename of AGENTIC_BUNDLE_MANIFEST_FILENAMES) {
    if (await pathExists(join(path, filename))) return true
  }
  return false
}

async function bundleRootForWorkspace(workspaceRoot: string): Promise<string | undefined> {
  const agenticRoot = join(workspaceRoot, ".agentic")
  if (await hasBundleManifest(agenticRoot)) return agenticRoot
  if (await hasBundleManifest(workspaceRoot)) return workspaceRoot
  return undefined
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

function booleanFlag(args: RuntimeRunArgs, name: string): boolean {
  return args.flags[name] === true
}

function stringRuntimeConfig(ctx: RuntimeContext, name: string): string | undefined {
  const value = ctx.runtime_config[name]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function resolveHarness(ctx: RuntimeContext, args: RuntimeRunArgs): LocalHarness {
  if (args.flags["harness"] === true) {
    throw new Error('`--harness` requires a value. Supported values: "none", "pi".')
  }

  const value = stringFlag(args.flags, "harness") ?? stringRuntimeConfig(ctx, "harness")
  if (value === undefined || value === "none" || value === "off" || value === "prepare") {
    return "none"
  }
  if (value === "pi") return "pi"

  throw new Error(`Unsupported local runtime harness "${value}". Supported values: none, pi.`)
}

function piCommand(ctx: RuntimeContext, args: RuntimeRunArgs): string {
  return stringFlag(args.flags, "pi-command") ?? stringRuntimeConfig(ctx, "pi_command") ?? "pi"
}

function piInteractive(args: RuntimeRunArgs): boolean {
  return args.flags["interactive"] === true
}

function resolveContextMode(ctx: RuntimeContext, args: RuntimeRunArgs): LocalContextMode {
  const value = stringFlag(args.flags, "context") ?? stringRuntimeConfig(ctx, "context") ?? "workflow"
  if (value === "workflow") return "workflow"
  if (value === "artifacts" || value === "artifact") return "artifacts"
  if (value === "bundle") return "bundle"

  throw new Error('Unsupported local runtime context "' + value + '". Supported values: workflow, artifacts, bundle.')
}

function splitCsvFlag(args: RuntimeRunArgs, name: string): string[] {
  const value = stringFlag(args.flags, name)
  if (value === undefined) return []
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}

async function resolveRunTarget(
  ctx: RuntimeContext,
  args: LocalRuntimeTargetArgs,
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

function taskMetadataString(task: Task | undefined, key: string): string | undefined {
  const value = task?.metadata?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function selectPersona(
  refs: PersonaRef[],
  workflowId: string | undefined,
  personaName: string | undefined,
): PersonaRef | undefined {
  if (personaName !== undefined) {
    const match = refs.find((ref) => ref.name === personaName)
    if (match === undefined) {
      const available = refs.map((ref) => ref.name).sort().join(", ") || "none"
      throw new Error(
        `Persona target "${personaName}" was not found. Available personas: ${available}.`,
      )
    }
    return match
  }

  if (workflowId !== undefined) {
    const workflowMatches = refs.filter((ref) => ref.workflow === workflowId)
    if (workflowMatches.length === 1) return workflowMatches[0]
    if (workflowMatches.length > 1) {
      throw new Error(
        `Multiple personas target workflow "${workflowId}". Add task metadata.persona or run an explicit persona-aware harness.`,
      )
    }
  }
  if (refs.length === 1) return refs[0]

  const workflowRefs = refs.filter((ref) => ref.workflow !== undefined)
  if (workflowRefs.length === 1) return workflowRefs[0]
  if (refs.length > 1) {
    const available = refs.map((ref) => ref.name).sort().join(", ")
    throw new Error(
      `No persona target was provided and multiple personas are available: ${available}. Add task metadata.persona or run \`agentic run <workflow-id>\`.`,
    )
  }

  return refs[0]
}

async function loadSelectedPersona(
  workspaceRoot: string,
  workflowId: string | undefined,
  personaName: string | undefined,
): Promise<PersonaFile | undefined> {
  const personas = new FilesystemPersonaAdapter(workspaceRoot)
  const selected = selectPersona(await personas.listPersonas(), workflowId, personaName)
  if (selected === undefined) return undefined

  const persona = await personas.loadPersona(selected.name)
  if (persona === undefined) {
    throw new Error(`Persona "${selected.name}" could not be loaded.`)
  }
  return persona
}

function activateLocalRunPersona(
  target: LocalRunTarget,
  persona: PersonaFile | undefined,
): Persona | undefined {
  if (persona === undefined) return undefined
  return activatePersona(persona, {
    cwd: target.workspace_root,
    timestamp: new Date().toISOString(),
    hostname: hostname(),
    git_branch: undefined,
  })
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

function inputArtifactFromMeta(meta: ArtifactMetadata, body: string): LocalInputArtifact {
  return {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    version: meta.version,
    finalized: meta.finalized,
    tags: meta.tags,
    body,
  }
}

async function loadInputArtifacts(
  workspaceRoot: string,
  args: RuntimeRunArgs,
): Promise<LocalInputArtifact[]> {
  const artifacts = new FilesystemArtifactAdapter(workspaceRoot)
  const ids = splitCsvFlag(args, "artifacts")
  const tags = splitCsvFlag(args, "artifact-tags")

  if (ids.length > 0) {
    const mounted: LocalInputArtifact[] = []
    for (const id of ids) {
      const meta = await artifacts.inspect(id)
      mounted.push(inputArtifactFromMeta(meta, await artifacts.read(id)))
    }
    return mounted
  }

  if (tags.length === 0) return []

  const refs = await artifacts.list({ tags, finalized: true })
  refs.sort((a, b) => a.id.localeCompare(b.id))

  const mounted: LocalInputArtifact[] = []
  for (const ref of refs) {
    const meta = await artifacts.inspect(ref.id)
    mounted.push(inputArtifactFromMeta(meta, await artifacts.read(ref.id)))
  }
  return mounted
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
    `context:${run.context_mode}`,
  ])

  if (run.graph !== undefined) tags.add(`workflow:${run.graph.id}`)
  for (const tag of run.persona?.memory_tags ?? []) tags.add(tag)
  for (const tag of run.task?.tags ?? []) tags.add(tag)
  if (run.persona !== undefined) tags.add(`persona:${run.persona.name}`)

  const artifact = await artifacts.create({
    type: "local-runtime-run",
    title: `Local runtime run: ${run.graph?.name ?? run.persona?.name ?? run.context_mode}`,
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
    ? run.context_mode === "artifacts"
      ? "No task projection was mounted for this artifact context run."
      : "No ready task matched the selected persona/task filter."
    : `${run.task.id}: ${run.task.description}`
  const personaSummary = run.persona === undefined
    ? "No persona selected."
    : `${run.persona.name}: ${run.persona.description}`
  const harnessSummary = run.harness_ref === undefined
    ? "No harness was invoked. The runtime prepared durable Agentic state only."
    : `Provider: ${run.harness_ref.provider}\n- Session id: ${run.harness_ref.id}`
  const workflowSummary = run.graph === undefined
    ? "- Workflow: none selected.\n- Workflow run id: none created."
    : `- Workflow: ${run.graph.id} (${run.graph.name})\n- Workflow version: ${run.graph.version}\n- Workflow run id: ${run.workflow_run_id}`
  const inputArtifactList = run.input_artifacts.length === 0
    ? "- None mounted."
    : run.input_artifacts
      .map((artifact) => `- ${artifact.id}: ${artifact.title} (${artifact.type}, v${artifact.version})`)
      .join("\n")
  const inspectionCommands = run.workflow_run_id === undefined
    ? `agentic artifact read ${run.artifact_id} --base-dir ${baseDirArg}
agentic artifact inspect ${run.artifact_id} --base-dir ${baseDirArg}`
    : `agentic workflow status ${run.workflow_run_id} --base-dir ${baseDirArg}
agentic artifact read ${run.artifact_id} --base-dir ${baseDirArg}
agentic artifact inspect ${run.artifact_id} --base-dir ${baseDirArg}`

  return `# Local Runtime Run: ${run.graph?.name ?? run.persona?.name ?? "Artifact Context"}

## Summary

The local runtime prepared an Agentic workspace run and left this durable packet for inspection.
This is not a model transcript and does not claim the assistant work is complete.

## Workspace

- Workspace: ${run.target.workspace_label}
- Workspace path: ${run.target.workspace_root}
- Runtime package: ${ctx.runtime_package}

## Target

- Context mode: ${run.context_mode}
${workflowSummary}
- Runtime invocation id: ${run.invocation_id}
- Runtime invocation path: ${pathRelative(
    run.target.workspace_root,
    invocationPathFor(run.target.workspace_root, run.invocation_id),
  )}
- Artifact id: ${run.artifact_id}

## Harness

${harnessSummary}

## Persona

${personaSummary}

## Skills

${skillList}

## Input Artifacts

${inputArtifactList}

## Task

${taskSummary}

## Next Inspection Commands


\`\`\`bash
${inspectionCommands}
\`\`\`
`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function invocationTarget(args: RuntimeRunArgs, target: LocalRunTarget): string | undefined {
  return args.target ?? target.workflow_id ?? target.workspace_label
}

function harnessRefFor(harness: LocalHarness, invocationId: string): RuntimeInvocationHarnessRef | undefined {
  if (harness === "none") return undefined
  return {
    provider: "pi",
    id: invocationId,
  }
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
  harness: LocalHarness,
): Promise<RuntimeInvocation> {
  const id = createInvocationId()
  return writeInvocation(target.workspace_root, {
    id,
    runtime: RUNTIME_NAME,
    runtime_package: PACKAGE_NAME,
    target: invocationTarget(args, target),
    workspace_root: target.workspace_root,
    status: "running",
    started_at: new Date().toISOString(),
    artifact_ids: [],
    harness_ref: harnessRefFor(harness, id),
  })
}

function invocationArtifactIds(run: LocalRunContext): string[] {
  return run.context_mode === "bundle" ? [] : [run.artifact_id]
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
    artifact_ids: invocationArtifactIds(run),
  })
}

async function failInvocation(
  invocation: RuntimeInvocation,
  err: unknown,
  run?: LocalRunContext | undefined,
): Promise<RuntimeInvocation> {
  const message = errorMessage(err)
  return writeInvocation(invocation.workspace_root, {
    ...invocation,
    status: "failed",
    ended_at: new Date().toISOString(),
    workflow_run_id: run?.workflow_run_id ?? invocation.workflow_run_id,
    artifact_ids: run === undefined ? invocation.artifact_ids : invocationArtifactIds(run),
    error: message,
  })
}

function renderPiSystemPrompt(ctx: RuntimeContext, run: LocalRunContext): string {
  const personaBody = run.activated_persona === undefined
    ? "No persona selected."
    : run.activated_persona.body.trim()
  const skillBlocks = run.skills.length === 0
    ? "No skills loaded."
    : run.skills.map((skill) => `## ${skill.name}\n\n${skill.content.trim()}`).join("\n\n")
  const taskBlock = run.task === undefined
    ? run.context_mode === "artifacts"
      ? "No task projection was mounted for this artifact context run."
      : "No ready task matched the selected persona/task filter."
    : `${run.task.id}: ${run.task.description}`
  const workflowBlock = run.graph === undefined
    ? "No workflow is selected for this run. Do not invent workflow state or advance workflow transitions."
    : `Workflow: ${run.graph.id} (${run.graph.name})\nWorkflow run id: ${run.workflow_run_id}`
  const artifactList = run.input_artifacts.length === 0
    ? "No input artifacts were mounted."
    : run.input_artifacts
      .map((artifact) => `- ${artifact.id}: ${artifact.title} (${artifact.type}, v${artifact.version})`)
      .join("\n")
  const artifactBlocks = run.input_artifacts.length === 0
    ? "No input artifact bodies were mounted."
    : run.input_artifacts.map((artifact) => `## ${artifact.title}

- Artifact id: ${artifact.id}
- Type: ${artifact.type}
- Version: ${artifact.version}
- Tags: ${artifact.tags.join(", ") || "none"}

${artifact.body.trim()}`).join("\n\n")
  const workflowDefinition = run.graph === undefined
    ? "No workflow definition is mounted for this run."
    : ["```json", JSON.stringify(run.graph, null, 2), "```"].join("\n")

  return `You are Pi running behind the Agentic local runtime.

Agentic owns durable workspace primitives: personas, skills, memories, tasks,
workflows, artifacts, and runtime invocation records. Pi owns the harness loop,
model call, tool execution, and its own session tree. Do not invent Agentic
session semantics or store transcripts in Agentic invocation records.

Workspace: ${run.target.workspace_root}
Runtime invocation id: ${run.invocation_id}
Context mode: ${run.context_mode}
${workflowBlock}
Run packet artifact id: ${run.artifact_id}
Persona: ${run.persona?.name ?? "none"}
Runtime package: ${ctx.runtime_package}

Use the Agentic CLI when you need to inspect or update durable primitives. When
you produce reusable output, persist it as an Agentic artifact. If a workflow run
is present, advance it with explicit transitions. If no workflow run is present,
stay in persona/skill/artifact context and do not create workflow state just to
act busy.

# Selected Task

${taskBlock}

# Persona

${personaBody}

# Skills

${skillBlocks}

# Mounted Input Artifacts

${artifactList}

${artifactBlocks}

# Workflow Definition

${workflowDefinition}
`
}

function renderPiUserPrompt(run: LocalRunContext, mode: "print" | "interactive"): string {
  if (run.context_mode === "artifacts") {
    const interactionLine = mode === "interactive"
      ? "After the briefing, stop and wait for the user instead of starting the recommended work."
      : "Produce the briefing as the final response for this one-shot run."

    return `Start a personal-assistant session from the mounted Agentic artifacts.

Briefly orient the user with the current picture, open work, items needing the user, and one recommended next step. Do not start executing the recommended work before the user confirms intent.

${interactionLine}

Run packet artifact: ${run.artifact_id}
Mounted artifact ids: ${run.input_artifacts.map((artifact) => artifact.id).join(", ") || "none"}`
  }

  const taskLine = run.task === undefined
    ? "No ready task was selected; inspect the workspace before choosing next action."
    : `Work the selected task: ${run.task.description}`

  return `Continue this Agentic local runtime run.

${taskLine}

Start from the generated run packet artifact (${run.artifact_id}) and workflow
run (${run.workflow_run_id}). Use Agentic primitives for durable state. Keep the
final answer concise and include the IDs of any artifacts or workflow runs you
create or update.`
}

function appendCapturedOutput(current: string, chunk: string): string {
  const next = current + chunk
  if (next.length <= OUTPUT_CAPTURE_LIMIT) return next
  return next.slice(next.length - OUTPUT_CAPTURE_LIMIT)
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
  },
): Promise<{ exit_code: number; stdout: string; stderr: string }> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf-8")
    child.stderr?.setEncoding("utf-8")
    child.stdout?.on("data", (chunk: string) => {
      stdout = appendCapturedOutput(stdout, chunk)
    })
    child.stderr?.on("data", (chunk: string) => {
      stderr = appendCapturedOutput(stderr, chunk)
    })
    child.on("error", rejectProcess)
    child.on("close", (code) => {
      resolveProcess({ exit_code: code ?? 0, stdout, stderr })
    })
  })
}

async function runInteractiveProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
  },
): Promise<{ exit_code: number; stdout: string; stderr: string }> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    })

    child.on("error", rejectProcess)
    child.on("close", (code) => {
      resolveProcess({ exit_code: code ?? 0, stdout: "", stderr: "" })
    })
  })
}

function piHarnessArgs(run: LocalRunContext, mode: "print" | "interactive"): string[] {
  const harnessRef = run.harness_ref
  if (harnessRef === undefined) {
    throw new Error("Pi harness requested without a harness reference.")
  }

  const sessionDir = piSessionsDirFor(run.target.workspace_root)
  const systemPromptPath = piSystemPromptPathFor(run.target.workspace_root, run.invocation_id)
  const userPromptPath = piUserPromptPathFor(run.target.workspace_root, run.invocation_id)
  const args = [
    "--session-dir",
    sessionDir,
    "--session-id",
    harnessRef.id,
    "--name",
    `Agentic ${run.graph?.id ?? run.persona?.name ?? run.context_mode}`,
    "--append-system-prompt",
    systemPromptPath,
    `@${userPromptPath}`,
  ]

  if (mode === "interactive") return args
  return ["--print", "--mode", "text", ...args]
}

async function runPiHarness(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
  run: LocalRunContext,
): Promise<PiHarnessResult> {
  const harnessRef = run.harness_ref
  if (harnessRef === undefined) {
    throw new Error("Pi harness requested without a harness reference.")
  }

  await mkdir(invocationsDirFor(run.target.workspace_root), { recursive: true })
  await mkdir(piSessionsDirFor(run.target.workspace_root), { recursive: true })

  const systemPromptPath = piSystemPromptPathFor(run.target.workspace_root, run.invocation_id)
  const userPromptPath = piUserPromptPathFor(run.target.workspace_root, run.invocation_id)
  const mode = piInteractive(args) ? "interactive" : "print"
  await writeFile(systemPromptPath, renderPiSystemPrompt(ctx, run), "utf-8")
  await writeFile(userPromptPath, renderPiUserPrompt(run, mode), "utf-8")

  const sessionDir = piSessionsDirFor(run.target.workspace_root)
  const command = piCommand(ctx, args)
  const commandArgs = piHarnessArgs(run, mode)
  const processOptions = {
    cwd: run.target.workspace_root,
    env: { ...process.env, ...ctx.env },
  }
  const result = mode === "interactive"
    ? await runInteractiveProcess(command, commandArgs, processOptions)
    : await runProcess(command, commandArgs, processOptions)

  if (result.exit_code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exit_code}`
    throw new Error(`Pi harness failed: ${detail}`)
  }

  return {
    provider: "pi",
    mode,
    session_id: harnessRef.id,
    session_dir: pathRelative(run.target.workspace_root, sessionDir),
    system_prompt_path: pathRelative(run.target.workspace_root, systemPromptPath),
    user_prompt_path: pathRelative(run.target.workspace_root, userPromptPath),
    ...result,
  }
}

async function runHarness(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
  run: LocalRunContext,
): Promise<PiHarnessResult | undefined> {
  if (run.harness_ref === undefined) return undefined
  if (run.harness_ref.provider === "pi") return runPiHarness(ctx, args, run)
  throw new Error(`Unsupported harness provider "${run.harness_ref.provider}".`)
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

async function prepareWorkflowLocalRun(
  ctx: RuntimeContext,
  target: LocalRunTarget,
  invocation: RuntimeInvocation,
  args: RuntimeRunArgs,
): Promise<LocalRunContext> {
  const taskAdapter = new FilesystemTaskAdapter(target.workspace_root)
  const taskDriven = target.workflow_id === undefined
  const task = taskDriven
    ? await taskAdapter.nextReadyTask()
    : undefined
  const workflowId = target.workflow_id ?? taskMetadataString(task ?? undefined, "workflow")
  const personaName = stringFlag(args.flags, "persona")
    ?? (taskDriven ? taskMetadataString(task ?? undefined, "persona") : undefined)
  const persona = await loadSelectedPersona(target.workspace_root, workflowId, personaName)
  const activatedPersona = activateLocalRunPersona(target, persona)
  const workflows = new FilesystemWorkflowAdapter(target.workspace_root)
  const graph = await resolveWorkflow(workflows, workflowId, persona, target.workspace_root)
  const skills = await loadPersonaSkills(target.workspace_root, persona)
  const selectedTask = taskDriven
    ? task
    : await taskAdapter.nextReadyTask(taskQueryWithoutStatus(persona?.task_filter))
  const workflowRun = await workflows.createRun(
    graph.id,
    `local runtime run: ${graph.id}`,
  )

  const run: LocalRunContext = {
    context_mode: "workflow",
    target,
    graph,
    persona,
    activated_persona: activatedPersona,
    skills,
    input_artifacts: [],
    task: selectedTask ?? undefined,
    workflow_run_id: workflowRun.run_id,
    artifact_id: "pending",
    invocation_id: invocation.id,
    harness_ref: invocation.harness_ref,
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
        ...(run.harness_ref === undefined ? {} : { harness_ref: run.harness_ref }),
      },
    })
  }

  return run
}

async function prepareArtifactContextRun(
  ctx: RuntimeContext,
  target: LocalRunTarget,
  invocation: RuntimeInvocation,
  args: RuntimeRunArgs,
): Promise<LocalRunContext> {
  const personaName = stringFlag(args.flags, "persona")
  const persona = await loadSelectedPersona(target.workspace_root, undefined, personaName)
  const activatedPersona = activateLocalRunPersona(target, persona)
  const skills = await loadPersonaSkills(target.workspace_root, persona)
  const inputArtifacts = await loadInputArtifacts(target.workspace_root, args)

  if (inputArtifacts.length === 0) {
    throw new Error(
      '`--context artifacts` requires mounted artifacts. Add `--artifacts <ids>` or `--artifact-tags <tags>`.',
    )
  }

  const run: LocalRunContext = {
    context_mode: "artifacts",
    target,
    persona,
    activated_persona: activatedPersona,
    skills,
    input_artifacts: inputArtifacts,
    artifact_id: "pending",
    invocation_id: invocation.id,
    harness_ref: invocation.harness_ref,
  }
  await createRunPacketArtifact(ctx, run)

  return run
}

async function prepareBundleLocalRun(
  target: LocalRunTarget,
  invocation: RuntimeInvocation,
  args: RuntimeRunArgs,
  bundleRoot: string,
): Promise<LocalRunContext> {
  const bundle = await loadAgenticBundle(bundleRoot)
  if (bundle.manifest.state.adapter !== "filesystem") {
    throw new Error(`Local bundle mode only supports filesystem state, got ${bundle.manifest.state.adapter}.`)
  }

  const stateDir = resolve(target.workspace_root, bundle.manifest.state.dir)
  if (booleanFlag(args, "clean")) await rm(stateDir, { recursive: true, force: true })

  const store = new LocalBundleRunStore(stateDir, createLocalBundleRunId())
  await store.init()

  let execution: LocalBundleTriggerExecutionResult
  try {
    execution = await executeLocalBundleTriggers(target, bundle, store, invocation, {
      deployId: stringFlag(args.flags, "deploy"),
      workspaceRoot: target.workspace_root,
    })
  } catch (err) {
    const latest = failedBundleLatest(target, bundle, store, invocation, err)
    await store.writeSummary(renderBundleFailedSummary(target, bundle, store, latest), latest)
    throw err
  }
  await store.writeSummary(execution.summary, execution.latest)

  return {
    context_mode: "bundle",
    target,
    bundle,
    bundle_run_id: store.runId,
    bundle_run_dir: store.runDir,
    bundle_summary_path: store.summaryPath,
    bundle_latest_path: store.latestPath,
    bundle_latest: execution.latest,
    skills: [],
    input_artifacts: [],
    artifact_id: "pending",
    invocation_id: invocation.id,
    harness_ref: invocation.harness_ref,
  }
}

function renderBundlePreparedSummary(
  target: LocalRunTarget,
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  invocation: RuntimeInvocation,
): string {
  return `# Local Bundle Run: ${bundle.manifest.name}

## Summary

The local runtime loaded this authored Agentic bundle, initialized filesystem runtime state, and recorded a dry bundle invocation.

No local trigger sequence was executed for this bundle. Bundles with explicit local runtime handlers can be served through declared surfaces, schedules, and hooks.

## Bundle

- Name: ${bundle.manifest.name}
- Version: ${bundle.manifest.version}
- Schema version: ${bundle.manifest.schema_version}
- Root: ${pathRelative(target.workspace_root, bundle.root)}

## Runtime State

- Context mode: bundle
- Runtime invocation id: ${invocation.id}
- Bundle run id: ${store.runId}
- Run directory: ${pathRelative(target.workspace_root, store.runDir)}
- Actions log: ${pathRelative(target.workspace_root, store.actionLogPath)}
- Summary path: ${pathRelative(target.workspace_root, store.summaryPath)}
- Latest pointer: ${pathRelative(target.workspace_root, store.latestPath)}
`
}

function renderBundleFailedSummary(
  target: LocalRunTarget,
  bundle: LoadedAgenticBundle,
  store: LocalBundleRunStore,
  latest: LocalBundleRunLatest,
): string {
  const error = typeof latest.error === "string" ? latest.error : "Unknown error"
  return `# Local Bundle Run: ${bundle.manifest.name}

## Summary

The local runtime loaded this authored Agentic bundle, initialized filesystem runtime state, and failed before completing the local trigger sequence.

## Failure

${error}

## Bundle

- Name: ${bundle.manifest.name}
- Version: ${bundle.manifest.version}
- Schema version: ${bundle.manifest.schema_version}
- Root: ${pathRelative(target.workspace_root, bundle.root)}

## Runtime State

- Context mode: bundle
- Runtime invocation id: ${latest.runtime_invocation_id}
- Bundle run id: ${store.runId}
- Run directory: ${pathRelative(target.workspace_root, store.runDir)}
- Actions log: ${pathRelative(target.workspace_root, store.actionLogPath)}
- Summary path: ${pathRelative(target.workspace_root, store.summaryPath)}
- Latest pointer: ${pathRelative(target.workspace_root, store.latestPath)}
`
}

async function prepareLocalRun(
  ctx: RuntimeContext,
  target: LocalRunTarget,
  invocation: RuntimeInvocation,
  args: RuntimeRunArgs,
  contextMode: LocalContextMode,
): Promise<LocalRunContext> {
  if (!(await hasAgenticWorkspace(target.workspace_root))) {
    throw new Error(`No Agentic workspace found at ${target.workspace_root}.`)
  }
  if (!(await pathExists(statePathFor(target.workspace_root)))) {
    throw new Error(
      `Local runtime is not initialized for ${target.workspace_root}. Run \`agentic runtime init local --base-dir ${target.workspace_label}\` first.`,
    )
  }

  if (contextMode === "artifacts") {
    return prepareArtifactContextRun(ctx, target, invocation, args)
  }

  const bundleRoot = await bundleRootForWorkspace(target.workspace_root)
  if (contextMode === "bundle" || bundleRoot !== undefined) {
    if (bundleRoot === undefined) {
      throw new Error(`No Agentic bundle manifest found in ${target.workspace_root}.`)
    }
    return prepareBundleLocalRun(target, invocation, args, bundleRoot)
  }

  return prepareWorkflowLocalRun(ctx, target, invocation, args)
}

async function readStateFor(workspaceRoot: string): Promise<LocalRuntimeState | undefined> {
  try {
    return JSON.parse(await readFile(statePathFor(workspaceRoot), "utf-8")) as LocalRuntimeState
  } catch {
    return undefined
  }
}

async function ensureLocalRuntimeState(workspaceRoot: string): Promise<{
  created: boolean
  dir: string
  path: string
  targetDir: string
  invocationDir: string
}> {
  const dir = runtimeDirFor(workspaceRoot)
  const targetDir = targetsDirFor(workspaceRoot)
  const invocationDir = invocationsDirFor(workspaceRoot)
  const path = statePathFor(workspaceRoot)
  await mkdir(targetDir, { recursive: true })
  await mkdir(invocationDir, { recursive: true })

  const existing = await readStateFor(workspaceRoot)
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

  return { created, dir, path, targetDir, invocationDir }
}

type LocalApprovalDecisionContext = {
  target: LocalRunTarget
  bundle: LoadedAgenticBundle
  store: LocalBundleRunStore
  invocation: RuntimeInvocation
  action: ActionRecord
  approvalRequestArtifact: LocalBundleArtifactRecord
  approvalRequest: ApprovalRequest
}

async function loadApprovalDecisionContext(
  ctx: RuntimeContext,
  args: RuntimeApprovalDecisionArgs,
  options: { allowCompleted?: boolean | undefined } = {},
): Promise<LocalApprovalDecisionContext> {
  const target = await resolveRunTarget(ctx, args)
  if (!(await hasAgenticWorkspace(target.workspace_root))) {
    throw new Error(`No Agentic workspace found at ${target.workspace_root}.`)
  }

  const bundleRoot = await bundleRootForWorkspace(target.workspace_root)
  if (bundleRoot === undefined) {
    throw new Error(`No Agentic bundle manifest found in ${target.workspace_root}.`)
  }

  const bundle = await loadAgenticBundle(bundleRoot)
  if (bundle.manifest.state.adapter !== "filesystem") {
    throw new Error(`Local approval decisions only support filesystem state, got ${bundle.manifest.state.adapter}.`)
  }

  const stateDir = resolve(target.workspace_root, bundle.manifest.state.dir)
  const latestPath = join(stateDir, "latest.json")
  let latest: LocalBundleRunLatest
  try {
    latest = JSON.parse(await readFile(latestPath, "utf-8")) as LocalBundleRunLatest
  } catch {
    throw new Error(`No local bundle run state found at ${latestPath}. Run \`agentic serve\` first.`)
  }

  const runId = typeof latest.run_id === "string" ? latest.run_id : undefined
  if (runId === undefined) throw new Error(`Local bundle latest state at ${latestPath} has no run_id.`)

  const store = new LocalBundleRunStore(stateDir, runId)
  await store.loadActions()
  await store.loadArtifacts()
  await store.loadApprovalDecisions()

  const action = await store.readAction(args.action_id)
  if (action === undefined) throw new Error(`Action not found: ${args.action_id}`)
  if (action.status !== "approval_required" && !(options.allowCompleted === true && action.status === "completed")) {
    throw new Error(`Action ${args.action_id} is ${action.status}; only approval_required actions can be decided.`)
  }
  if (action.digest === undefined) throw new Error(`Action ${args.action_id} has no digest to bind approval against.`)

  const approvalRequestArtifact = await store.readApprovalRequestArtifact(action.id)
  if (approvalRequestArtifact === undefined) {
    throw new Error(`Approval request artifact not found for action ${action.id}.`)
  }
  const approvalRequest = approvalRequestFromArtifact(approvalRequestArtifact)
  if (approvalRequest.action_digest !== action.digest) {
    throw new Error(`Approval request digest does not match action ${action.id}.`)
  }
  if (action.capability !== approvalRequest.capability) {
    throw new Error(`Approval request capability does not match action ${action.id}.`)
  }

  assertHumanApprovalPrincipal(bundle, args.principal)

  const runtimeInvocationId = typeof latest.runtime_invocation_id === "string"
    ? latest.runtime_invocation_id
    : "approval-decision"
  return {
    target,
    bundle,
    store,
    invocation: {
      id: runtimeInvocationId,
      runtime: RUNTIME_NAME,
      runtime_package: PACKAGE_NAME,
      target: target.workspace_label,
      workspace_root: target.workspace_root,
      status: "completed",
      started_at: new Date().toISOString(),
      artifact_ids: [],
    },
    action,
    approvalRequestArtifact,
    approvalRequest,
  }
}

function approvalRequestFromArtifact(artifact: LocalBundleArtifactRecord): ApprovalRequest {
  const request = artifact.body as unknown as ApprovalRequest
  if (typeof request.action_id !== "string" || typeof request.action_digest !== "string") {
    throw new Error(`Approval request artifact ${artifact.id} is malformed.`)
  }
  return request
}

function approvalPrincipalDeclaration(
  bundle: LoadedAgenticBundle,
  principal: string,
): LoadedAgenticBundle["manifest"]["principals"][number] {
  const declaration = bundle.manifest.principals.find((entry) => entry.id === principal)
  if (declaration === undefined) throw new Error(`Approval principal is not declared in the bundle: ${principal}`)
  return declaration
}

function assertHumanApprovalPrincipal(bundle: LoadedAgenticBundle, principal: string): void {
  const declaration = approvalPrincipalDeclaration(bundle, principal)
  if (declaration.kind !== "human") {
    throw new Error(`Approval principal must be human, got ${declaration.kind ?? "unknown"}.`)
  }
}

function assertApproverRule(
  bundle: LoadedAgenticBundle,
  principal: string,
  action: ActionRecord,
  approvalRequest: ApprovalRequest,
): void {
  const declaration = approvalPrincipalDeclaration(bundle, principal)
  const clauses = Array.isArray(approvalRequest.approver_rule.all_of)
    ? approvalRequest.approver_rule.all_of.filter((item): item is string => typeof item === "string")
    : []
  for (const clause of clauses) {
    if (clause === "principal.kind == human") {
      if (declaration.kind !== "human") throw new Error("Approval principal must be human.")
      continue
    }
    if (clause.startsWith("principal.roles includes ")) {
      const role = clause.slice("principal.roles includes ".length).trim()
      if (!(declaration.roles ?? []).includes(role)) throw new Error(`Approval principal lacks required role: ${role}`)
      continue
    }
    if (clause === "grant.action_digest == action.digest") {
      if (approvalRequest.action_digest !== action.digest) throw new Error("Approval grant digest does not match action digest.")
      continue
    }
    if (clause.startsWith("grant.capability == ")) {
      const capability = clause.slice("grant.capability == ".length).trim()
      if (approvalRequest.capability !== capability || action.capability !== capability) {
        throw new Error(`Approval grant capability does not match required capability: ${capability}`)
      }
      continue
    }
    throw new Error(`Unsupported approver rule clause: ${clause}`)
  }
}

function assertApprovalNotExpired(approvalRequest: ApprovalRequest): void {
  const expiresAt = Date.parse(approvalRequest.expires_at)
  if (!Number.isFinite(expiresAt)) throw new Error("Approval request has an invalid expiration timestamp.")
  if (expiresAt <= Date.now()) throw new Error("Approval request has expired.")
}

async function approveLocalRuntime(
  ctx: RuntimeContext,
  args: RuntimeApprovalDecisionArgs,
): Promise<RuntimeCommandResult> {
  const decisionContext = await loadApprovalDecisionContext(ctx, args, { allowCompleted: true })
  const { target, bundle, store, invocation, action, approvalRequestArtifact, approvalRequest } = decisionContext

  const existing = await store.readApprovalDecisionByAction(action.id)
  if (existing !== undefined) {
    if (existing.decision !== "granted") {
      throw new Error(`Action ${action.id} already has approval decision ${existing.decision}.`)
    }
    return approvalDecisionResult(ctx, target, store, existing, approvalRequestArtifact.id, {
      existing: true,
      externalWriteExecuted: action.status === "completed",
      outputArtifactIds: action.output_artifact_ids,
    })
  }

  if (action.status === "completed") {
    throw new Error(`Action ${action.id} is already completed without a recorded approval grant.`)
  }

  assertApprovalNotExpired(approvalRequest)
  assertApproverRule(bundle, args.principal, action, approvalRequest)

  const input: Omit<ApprovalDecisionRecord, "decided_at"> = {
    id: await store.nextApprovalDecisionId(),
    approval_request_id: approvalRequestArtifact.id,
    action_id: action.id,
    action_digest: approvalRequest.action_digest,
    principal: args.principal,
    decision: "granted",
    expires_at: approvalRequest.expires_at,
  }
  if (approvalRequest.capability !== undefined) input.capability = approvalRequest.capability
  if (args.comment !== undefined) input.comment = args.comment
  const decision = await store.recordApprovalDecision(input)

  const bindings = await loadLocalBundleRuntimeBindings(bundle, store, {
    deployId: stringFlag(args.flags, "deploy"),
    workspaceRoot: target.workspace_root,
  })
  const handler = bindings.handlers[action.type]
  if (handler === undefined) throw new Error(`No local handler registered for approved action ${action.type}.`)

  const gateway = createLocalBundleActionGateway(bundle, store)
  const resumed = await gateway.resumeApprovedAction(action, handler)
  const latest = completedBundleLatest(target, bundle, store, invocation)
  await store.writeSummary(renderBundleCompletedSummary(target, bundle, store, latest), latest)
  return approvalDecisionResult(ctx, target, store, decision, approvalRequestArtifact.id, {
    existing: false,
    externalWriteExecuted: true,
    outputArtifactIds: resumed.action.output_artifact_ids,
  })
}

async function rejectLocalRuntime(
  ctx: RuntimeContext,
  args: RuntimeApprovalDecisionArgs,
): Promise<RuntimeCommandResult> {
  const decisionContext = await loadApprovalDecisionContext(ctx, args)
  const { target, bundle, store, invocation, action, approvalRequestArtifact, approvalRequest } = decisionContext

  const existing = await store.readApprovalDecisionByAction(action.id)
  if (existing !== undefined) {
    if (existing.decision !== "rejected") {
      throw new Error(`Action ${action.id} already has approval decision ${existing.decision}.`)
    }
    return approvalDecisionResult(ctx, target, store, existing, approvalRequestArtifact.id, {
      existing: true,
      externalWriteExecuted: false,
    })
  }

  const input: Omit<ApprovalDecisionRecord, "decided_at"> = {
    id: await store.nextApprovalDecisionId(),
    approval_request_id: approvalRequestArtifact.id,
    action_id: action.id,
    action_digest: approvalRequest.action_digest,
    principal: args.principal,
    decision: "rejected",
    expires_at: approvalRequest.expires_at,
  }
  if (approvalRequest.capability !== undefined) input.capability = approvalRequest.capability
  if (args.comment !== undefined) input.comment = args.comment

  const decision = await store.recordApprovalDecision(input)
  const latest = completedBundleLatest(target, bundle, store, invocation)
  await store.writeSummary(renderBundleCompletedSummary(target, bundle, store, latest), latest)
  return approvalDecisionResult(ctx, target, store, decision, approvalRequestArtifact.id, {
    existing: false,
    externalWriteExecuted: false,
  })
}

function approvalDecisionResult(
  ctx: RuntimeContext,
  target: LocalRunTarget,
  store: LocalBundleRunStore,
  decision: ApprovalDecisionRecord,
  approvalRequestId: string,
  options: {
    existing: boolean
    externalWriteExecuted: boolean
    outputArtifactIds?: string[] | undefined
  },
): RuntimeCommandResult {
  const verb = decision.decision === "granted" ? "Granted" : "Rejected"
  return {
    summary: options.existing
      ? `Approval for action ${decision.action_id} was already ${decision.decision}.`
      : `${verb} approval for action ${decision.action_id}.`,
    data: {
      run_id: store.runId,
      run_dir: pathRelative(ctx.workspace_root, store.runDir),
      summary_path: pathRelative(ctx.workspace_root, store.summaryPath),
      latest_path: pathRelative(ctx.workspace_root, store.latestPath),
      approval_decision_id: decision.id,
      approval_request_id: approvalRequestId,
      action_id: decision.action_id,
      action_digest: decision.action_digest,
      capability: decision.capability ?? null,
      principal: decision.principal,
      decision: decision.decision,
      decided_at: decision.decided_at,
      comment: decision.comment ?? null,
      output_artifact_ids: options.outputArtifactIds ?? [],
      external_write_executed: options.externalWriteExecuted,
      workspace: pathRelative(ctx.workspace_root, target.workspace_root),
    },
  }
}

function localAdminConsoleTargetArgs(options: LocalAdminConsoleOptions): LocalRuntimeTargetArgs {
  return {
    target: options.target,
    args: options.args ?? [],
    flags: options.flags ?? {},
  }
}

function approvalDisplayStatus(approval: LocalAdminApproval): string {
  if (approval.decision !== undefined) return approval.decision.decision
  if (approvalRequestExpired(approval.approval_request)) return "expired"
  if (approval.action.status === "approval_required") return "pending"
  return approval.action.status
}

function approvalRequestExpired(approvalRequest: ApprovalRequest): boolean {
  const expiresAt = Date.parse(approvalRequest.expires_at)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function approvalSortRank(approval: LocalAdminApproval): number {
  const status = approvalDisplayStatus(approval)
  if (status === "pending") return 0
  if (status === "expired") return 1
  return 2
}

export async function loadLocalAdminConsoleState(
  ctx: RuntimeContext,
  options: LocalAdminConsoleOptions = {},
): Promise<LocalAdminConsoleState> {
  const target = await resolveRunTarget(ctx, localAdminConsoleTargetArgs(options))
  if (!(await hasAgenticWorkspace(target.workspace_root))) {
    throw new Error(`No Agentic workspace found at ${target.workspace_root}.`)
  }

  const bundleRoot = await bundleRootForWorkspace(target.workspace_root)
  if (bundleRoot === undefined) {
    throw new Error(`No Agentic bundle manifest found in ${target.workspace_root}.`)
  }

  const bundle = await loadAgenticBundle(bundleRoot)
  if (bundle.manifest.state.adapter !== "filesystem") {
    throw new Error(`Local admin console only supports filesystem state, got ${bundle.manifest.state.adapter}.`)
  }

  const stateDir = resolve(target.workspace_root, bundle.manifest.state.dir)
  const latestPath = join(stateDir, "latest.json")
  let latest: LocalBundleRunLatest
  try {
    latest = JSON.parse(await readFile(latestPath, "utf-8")) as LocalBundleRunLatest
  } catch {
    throw new Error(`No local bundle run state found at ${latestPath}. Run \`agentic serve\` first.`)
  }

  const runId = typeof latest.run_id === "string" ? latest.run_id : undefined
  if (runId === undefined) throw new Error(`Local bundle latest state at ${latestPath} has no run_id.`)

  const store = new LocalBundleRunStore(stateDir, runId)
  const actions = await store.loadActions()
  const artifacts = await store.loadArtifacts()
  const approvalDecisions = await store.loadApprovalDecisions()
  const approvals: LocalAdminApproval[] = []
  let summaryMarkdown: string | undefined

  try {
    summaryMarkdown = await readFile(store.summaryPath, "utf-8")
  } catch {
    summaryMarkdown = undefined
  }

  for (const artifact of artifacts.filter((entry) => entry.type === "approval-request")) {
    const approvalRequest = approvalRequestFromArtifact(artifact)
    const action = await store.readAction(approvalRequest.action_id)
    if (action === undefined) continue
    const decision = [...approvalDecisions].reverse().find((entry) => entry.action_id === action.id)
    const inputArtifactIds = new Set<string>([
      ...approvalRequest.input_artifact_ids,
      ...(action.input_artifact_ids ?? []),
      ...(artifact.derived_from ?? []),
    ])
    const approval: LocalAdminApproval = {
      action,
      approval_request_artifact: artifact,
      approval_request: approvalRequest,
      input_artifacts: artifacts.filter((entry) => inputArtifactIds.has(entry.id)),
    }
    if (decision !== undefined) approval.decision = decision
    approvals.push(approval)
  }

  approvals.sort((a, b) => {
    return approvalSortRank(a) - approvalSortRank(b) || a.action.created_at.localeCompare(b.action.created_at)
  })

  return {
    workspace: {
      root: target.workspace_root,
      label: target.workspace_label,
    },
    bundle: {
      name: bundle.manifest.name,
      version: bundle.manifest.version,
      schema_version: bundle.manifest.schema_version,
      manifest_path: pathRelative(target.workspace_root, bundle.manifestPath),
    },
    run: {
      id: runId,
      dir: pathRelative(target.workspace_root, store.runDir),
      summary_path: pathRelative(target.workspace_root, store.summaryPath),
      latest_path: pathRelative(target.workspace_root, store.latestPath),
      status: typeof latest.status === "string" ? latest.status : "unknown",
      summary_markdown: summaryMarkdown,
    },
    latest,
    actions,
    artifacts,
    approval_decisions: approvalDecisions,
    approvals,
    human_principals: bundle.manifest.principals
      .filter((principal) => principal.kind === "human")
      .map((principal) => {
        const info: LocalAdminPrincipal = {
          id: principal.id,
          kind: principal.kind ?? "human",
          roles: principal.roles ?? [],
        }
        if (principal.description !== undefined) info.description = principal.description
        return info
      }),
  }
}

function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveJson(entry))
  if (value === null || typeof value !== "object") return value
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSensitiveJson(entry)
  }
  return output
}

function jsonPreview(value: unknown): string {
  return JSON.stringify(redactSensitiveJson(value), null, 2) ?? "null"
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function statusClass(status: string): string {
  if (status === "pending" || status === "approval_required") return "status-pending"
  if (status === "granted" || status === "completed") return "status-good"
  if (status === "rejected" || status === "denied" || status === "failed") return "status-bad"
  return "status-muted"
}

function renderStatusPill(status: string): string {
  return `<span class="status ${statusClass(status)}">${escapeHtml(status)}</span>`
}

function renderJsonBlock(value: unknown): string {
  return `<pre>${escapeHtml(jsonPreview(value))}</pre>`
}

function shortValue(value: string, head = 14, tail = 8): string {
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function compactId(value: string): string {
  if (value.length <= 28) return value
  return shortValue(value, 20, 6)
}

function formatAdminDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function humanizeIdentifier(value: string): string {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function humanizeEffect(effect: string): string {
  const parts = effect.split(":", 2)
  const kind = parts[0] ?? effect
  const target = parts[1]
  if (target === undefined || target === "") return humanizeIdentifier(effect)
  return `${humanizeIdentifier(kind)}: ${target}`
}

function renderPills(values: readonly string[]): string {
  if (values.length === 0) return `<span class="meta">none</span>`
  return `<span class="pills">${values.map((value) => `<span class="pill mono">${escapeHtml(value)}</span>`).join("")}</span>`
}

function renderInlineJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    const strings = value.filter((entry): entry is string => typeof entry === "string")
    if (strings.length === value.length) return renderPills(strings)
    return `<span class="mono">${escapeHtml(JSON.stringify(redactSensitiveJson(value)))}</span>`
  }
  if (value === null) return `<span class="meta">null</span>`
  if (typeof value === "object") return `<span class="mono">${escapeHtml(JSON.stringify(redactSensitiveJson(value)))}</span>`
  return `<span>${escapeHtml(value)}</span>`
}

function renderObjectSummary(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return renderInlineJsonValue(value)
  const entries = Object.entries(redactSensitiveJson(value) as Record<string, unknown>)
  if (entries.length === 0) return `<p class="meta">No structured payload was recorded.</p>`
  return `<dl class="kv">${entries.map(([key, entry]) => {
    return `<dt>${escapeHtml(key)}</dt><dd>${renderInlineJsonValue(entry)}</dd>`
  }).join("")}</dl>`
}

function rawJsonDetails(label: string, value: unknown): string {
  return `<details class="raw-json"><summary>${escapeHtml(label)}</summary>${renderJsonBlock(value)}</details>`
}

function approvalRuleClauses(value: JsonObject | undefined): string[] {
  const clauses = value?.all_of
  return Array.isArray(clauses) ? clauses.filter((entry): entry is string => typeof entry === "string") : []
}

function humanizeApprovalClause(clause: string): string {
  if (clause === "principal.kind == human") return "Human approver"
  if (clause === "grant.action_digest == action.digest") return "Exact action match"
  if (clause.startsWith("principal.roles includes ")) return `Role: ${clause.slice("principal.roles includes ".length)}`
  if (clause.startsWith("grant.capability == ")) return `Capability: ${clause.slice("grant.capability == ".length)}`
  return clause
}

function payloadFieldLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function payloadHighlightKeys(payload: JsonObject): string[] {
  const preferred = ["case_id", "queue", "integration", "message", "recipient", "subject", "title", "status"]
  const keys: string[] = []
  for (const key of preferred) {
    if (payload[key] !== undefined) keys.push(key)
  }
  for (const key of Object.keys(payload)) {
    if (keys.includes(key) || key === "artifact_ids") continue
    if (SECRET_KEY_PATTERN.test(key)) continue
    const value = payload[key]
    if (value === null || typeof value !== "object") keys.push(key)
    if (keys.length >= 6) break
  }
  return keys.slice(0, 6)
}

function payloadHighlightValue(key: string, value: JsonValue | undefined): string {
  if (value === undefined) return "not recorded"
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`
  if (value === null) return "not recorded"
  if (typeof value === "object") return "structured data"
  if (typeof value === "string" && /(^id$|_id$|digest)/i.test(key)) return compactId(value)
  return String(value)
}

function primaryExternalEffect(effects: readonly string[]): string | undefined {
  return effects.find((effect) => effect.startsWith("external.")) ?? effects[0]
}

function artifactWriteEffects(effects: readonly string[]): string[] {
  return effects.filter((effect) => effect.startsWith("artifact.write:"))
}

function renderReviewSummary(approval: LocalAdminApproval): string {
  const payload = approval.action.payload ?? {}
  const primaryEffect = primaryExternalEffect(approval.approval_request.effects)
  const artifactWrites = artifactWriteEffects(approval.approval_request.effects)
  const highlights = payloadHighlightKeys(payload)
  return `<section class="card review-summary">
    <h3>Review Summary</h3>
    <div class="summary-grid">
      <div class="summary-item"><div class="summary-label">Primary Effect</div><div class="summary-value">${escapeHtml(primaryEffect === undefined ? "No external effect" : humanizeEffect(primaryEffect))}</div></div>
      <div class="summary-item"><div class="summary-label">Capability</div><div class="summary-value">${escapeHtml(approval.action.capability ?? "none")}</div></div>
      <div class="summary-item"><div class="summary-label">Requester</div><div class="summary-value mono">${escapeHtml(approval.action.principal)}</div></div>
      <div class="summary-item"><div class="summary-label">Expires</div><div class="summary-value">${escapeHtml(formatAdminDateTime(approval.approval_request.expires_at))}</div></div>
    </div>
    ${highlights.length === 0 ? "" : `<div class="summary-list">${highlights.map((key) => {
      return `<div><span>${escapeHtml(payloadFieldLabel(key))}</span><strong>${escapeHtml(payloadHighlightValue(key, payload[key]))}</strong></div>`
    }).join("")}</div>`}
    ${artifactWrites.length === 0 ? "" : `<p class="meta">Also writes: ${artifactWrites.map((effect) => escapeHtml(humanizeEffect(effect))).join(", ")}</p>`}
  </section>`
}

function renderApprovalReason(approval: LocalAdminApproval): string {
  const policy = approval.action.policy
  const clauses = approvalRuleClauses(policy?.required_approval).map(humanizeApprovalClause)
  const reason = policy?.reason ?? "This action requires a runtime approval before it can continue."
  return `<section class="card approval-reason">
    <h3>Why Approval Is Required</h3>
    <p>${escapeHtml(reason)}</p>
    <div class="rule-row">${renderPills(clauses)}</div>
  </section>`
}

function renderPolicySummary(approval: LocalAdminApproval): string {
  const policy = approval.action.policy
  if (policy === undefined) return `<p class="meta">No policy decision was recorded.</p>`
  const clauses = approvalRuleClauses(policy.required_approval)
  return `<dl class="kv">
    <dt>Decision</dt><dd>${renderStatusPill(policy.decision)}</dd>
    <dt>Code</dt><dd><span class="mono">${escapeHtml(policy.code ?? "none")}</span></dd>
    <dt>Capability</dt><dd>${escapeHtml(policy.capability ?? approval.action.capability ?? "none")}</dd>
    <dt>Reason</dt><dd>${escapeHtml(policy.reason)}</dd>
    <dt>Approval Rule</dt><dd>${renderPills(clauses)}</dd>
  </dl>`
}

function renderApprovalRequestSummary(approval: LocalAdminApproval): string {
  const request = approval.approval_request
  return `<dl class="kv">
    <dt>Request Artifact</dt><dd><span class="mono" title="${escapeHtml(approval.approval_request_artifact.id)}">${escapeHtml(compactId(approval.approval_request_artifact.id))}</span></dd>
    <dt>Action Type</dt><dd>${escapeHtml(request.action_type)}</dd>
    <dt>Digest</dt><dd><span class="mono" title="${escapeHtml(request.action_digest)}">${escapeHtml(shortValue(request.action_digest, 18, 10))}</span></dd>
    <dt>Effects</dt><dd>${renderPills(request.effects.map(humanizeEffect))}</dd>
    <dt>Inputs</dt><dd>${renderPills(request.input_artifact_ids.map(compactId))}</dd>
    <dt>Expires</dt><dd><span title="${escapeHtml(request.expires_at)}">${escapeHtml(formatAdminDateTime(request.expires_at))}</span></dd>
  </dl>`
}

function renderArtifactSummary(artifact: LocalBundleArtifactRecord): string {
  return `<div class="artifact card inset-card">
    <div class="artifact-title"><strong>${escapeHtml(artifact.title)}</strong><span class="meta mono">${escapeHtml(artifact.id)}</span></div>
    <div class="meta">${escapeHtml(artifact.type)} - ${escapeHtml(artifact.status)} - created by ${escapeHtml(artifact.created_by_action_id)}</div>
    ${renderObjectSummary(artifact.body)}
    ${rawJsonDetails("Raw artifact JSON", artifact.body)}
  </div>`
}

function renderAdminDesignSystemStyles(): string {
  return `
    :root {
      color-scheme: light;
      --bg: #f8f6f1;
      --surface: #fffefb;
      --surface-strong: #ffffff;
      --surface-tint: #fbfaf6;
      --ink: #20182d;
      --muted: #746d78;
      --subtle: #9a94a0;
      --line: #dfdad1;
      --line-strong: #bdb5c7;
      --accent: #7665a8;
      --accent-strong: #3b2d5a;
      --accent-soft: #f2effb;
      --accent-warm: #fff0ee;
      --good: #116145;
      --good-bg: #def7ea;
      --bad: #9c1f2e;
      --bad-bg: #ffe4e4;
      --pending: #8a5a11;
      --pending-bg: #fff1c2;
      --code-bg: #17151f;
      --radius-sm: 4px;
      --radius: 7px;
      --radius-lg: 11px;
      --shadow-sm: 0 5px 18px rgba(32, 24, 45, 0.045);
      --shadow: 0 16px 42px rgba(32, 24, 45, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        linear-gradient(rgba(32, 24, 45, 0.022) 1px, transparent 1px),
        linear-gradient(90deg, rgba(32, 24, 45, 0.022) 1px, transparent 1px),
        radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.82), transparent 34rem),
        var(--bg);
      background-size: 28px 28px, 28px 28px, auto, auto;
      color: var(--ink);
      font: 14px/1.52 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    a { color: var(--accent-strong); text-decoration: none; }
    a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .shell { max-width: 1180px; margin: 0 auto; padding: 20px 18px 42px; }
    header {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      margin-bottom: 18px;
      border: 1px solid var(--line);
      background: rgba(255, 254, 251, 0.9);
      border-radius: var(--radius-lg);
      padding: 12px;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(8px);
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 { font-size: 20px; line-height: 1.1; margin-bottom: 3px; font-weight: 680; letter-spacing: -0.025em; }
    h2 { font-size: 18px; line-height: 1.2; margin-bottom: 8px; font-weight: 640; letter-spacing: -0.015em; }
    h3 { font-size: 12px; margin-bottom: 10px; color: var(--muted); font-weight: 620; text-transform: uppercase; letter-spacing: 0.1em; }
    .brand-cluster { display: flex; align-items: center; gap: 11px; min-width: 0; }
    .brand-mark {
      display: grid;
      place-items: center;
      width: 38px;
      height: 30px;
      border: 1px solid var(--ink);
      border-radius: 2px;
      background: var(--ink);
      color: #fffefb;
      font-weight: 760;
      letter-spacing: -0.08em;
      box-shadow: none;
    }
    .eyebrow { color: var(--muted); font-size: 11px; font-weight: 620; text-transform: uppercase; letter-spacing: 0.11em; }
    .meta { color: var(--muted); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .nav { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .nav a {
      border: 1px solid var(--line-strong);
      background: var(--surface-strong);
      border-radius: var(--radius-sm);
      padding: 7px 12px;
      color: var(--ink);
      font-size: 13px;
      font-weight: 580;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
    }
    .nav a[aria-current="page"] { background: var(--accent-warm); border-color: var(--line-strong); color: var(--ink); }
    .grid { display: grid; gap: 12px; }
    .card {
      background: rgba(255, 254, 251, 0.94);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 14px;
      box-shadow: var(--shadow-sm);
    }
    .hero-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(240px, 0.42fr);
      gap: 18px;
      align-items: end;
      margin-bottom: 14px;
      padding: 18px;
      border-radius: var(--radius-lg);
      background:
        linear-gradient(135deg, rgba(255, 254, 251, 0.97), rgba(251, 250, 246, 0.94)),
        var(--surface);
    }
    .hero-card h2 { font-size: 24px; margin-bottom: 7px; }
    .hero-copy { max-width: 650px; margin-bottom: 0; color: var(--muted); font-size: 15px; }
    .workspace-card {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--surface-strong);
      padding: 12px;
    }
    .workspace-card dl { grid-template-columns: 82px minmax(0, 1fr); gap: 5px 10px; }
    .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 14px; }
    .metric-card {
      position: relative;
      min-height: 112px;
      overflow: hidden;
      background: var(--surface-strong);
    }
    .metric-card::after { content: ""; position: absolute; inset: auto 0 0; height: 3px; background: var(--accent-warm); }
    .metric-label { color: var(--muted); font-size: 12px; font-weight: 620; text-transform: uppercase; letter-spacing: 0.1em; }
    .stat-value { font-size: 30px; line-height: 1; font-weight: 680; letter-spacing: -0.035em; margin-top: 9px; }
    .metric-detail { color: var(--subtle); margin-top: 9px; }
    .section-heading { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 10px; }
    .section-heading p { margin-bottom: 0; color: var(--muted); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 720px; border-collapse: separate; border-spacing: 0; }
    th, td { padding: 11px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.09em; }
    tr:last-child td { border-bottom: 0; }
    tbody tr:hover td { background: rgba(254, 231, 229, 0.32); }
    .record-link { color: var(--ink); font-weight: 620; }
    .status { display: inline-flex; align-items: center; border-radius: var(--radius-sm); padding: 3px 7px; font-size: 12px; font-weight: 600; border: 1px solid transparent; }
    .status-pending { background: var(--pending-bg); color: var(--pending); border-color: rgba(138, 90, 17, 0.16); }
    .status-good { background: var(--good-bg); color: var(--good); border-color: rgba(17, 97, 69, 0.14); }
    .status-bad { background: var(--bad-bg); color: var(--bad); border-color: rgba(156, 31, 46, 0.14); }
    .status-muted { background: #ece8df; color: #5b544b; border-color: rgba(91, 84, 75, 0.12); }
    .breadcrumb { margin: 0 0 12px; color: var(--muted); }
    .detail-hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: start;
      margin-bottom: 12px;
      padding: 18px;
      border-radius: var(--radius-lg);
    }
    .detail-hero h2 { font-size: 22px; margin-bottom: 6px; }
    .hero-meta { min-width: 230px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface-tint); }
    .review-top { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; align-items: start; margin-bottom: 12px; }
    .review-sections { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr); gap: 12px; align-items: start; margin-bottom: 14px; }
    .review-summary { border-color: rgba(118, 101, 168, 0.24); }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; margin-top: 6px; }
    .summary-item { border: 1px solid var(--line); background: var(--surface-tint); border-radius: var(--radius-sm); padding: 10px; min-width: 0; }
    .summary-label { color: var(--muted); font-size: 10px; font-weight: 620; text-transform: uppercase; letter-spacing: 0.09em; }
    .summary-value { margin-top: 3px; font-weight: 600; overflow-wrap: anywhere; }
    .summary-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; margin: 13px 0 8px; }
    .summary-list div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 10px; align-items: baseline; }
    .summary-list span { color: var(--muted); }
    .summary-list strong { font-weight: 600; overflow-wrap: anywhere; }
    .approval-reason p { margin-bottom: 10px; }
    .rule-row { margin-top: 8px; }
    .technical-details { margin-bottom: 14px; background: rgba(255, 254, 251, 0.82); }
    .technical-details > summary { cursor: pointer; color: var(--accent-strong); font-weight: 760; }
    .technical-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .technical-grid.two-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    dl { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 7px 12px; margin: 0; }
    .kv { grid-template-columns: 118px minmax(0, 1fr); }
    dt { color: var(--muted); }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    pre { margin: 0; padding: 11px; overflow: auto; border-radius: var(--radius-sm); background: var(--code-bg); color: #ece8ff; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    details.raw-json { margin-top: 10px; border-top: 1px solid var(--line); padding-top: 8px; }
    details.raw-json summary { cursor: pointer; color: var(--accent-strong); font-weight: 680; }
    details.raw-json pre { margin-top: 8px; max-height: 420px; }
    form { display: grid; gap: 11px; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 11px; font-weight: 620; text-transform: uppercase; letter-spacing: 0.09em; }
    select, textarea {
      width: 100%;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      padding: 8px 9px;
      font: inherit;
      background: var(--surface-strong);
      color: var(--ink);
      outline: none;
    }
    select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(118, 101, 168, 0.13); }
    textarea { min-height: 76px; resize: vertical; }
    .button-row { display: flex; gap: 9px; flex-wrap: wrap; }
    button { border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 8px 13px; font: inherit; font-weight: 600; cursor: pointer; }
    .primary { background: var(--accent-warm); color: var(--ink); box-shadow: none; }
    .primary:hover { background: #fbd9d6; }
    .danger { background: var(--surface-strong); color: var(--bad); border-color: rgba(156, 31, 46, 0.28); }
    .danger:hover { background: var(--bad-bg); }
    .empty { padding: 28px; text-align: center; color: var(--muted); background: var(--surface-tint); border-radius: var(--radius); }
    .artifact { display: grid; gap: 8px; margin-top: 10px; }
    .artifact-title { display: flex; justify-content: space-between; gap: 10px; }
    .inset-card { background: var(--surface-strong); }
    .pills { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill { display: inline-flex; align-items: center; border: 1px solid var(--line); background: var(--surface-tint); border-radius: var(--radius-sm); padding: 2px 7px; color: #3f3a33; }
    .button-link { display: inline-flex; align-items: center; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 8px 13px; color: var(--ink); font-weight: 600; background: var(--surface-strong); }
    .button-link:hover { text-decoration: none; background: var(--surface-tint); }
    .button-link.primary { background: var(--accent-warm); }
    .next-actions p { margin-bottom: 12px; color: var(--muted); }
    .record-list { display: grid; gap: 8px; }
    .record-row { display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(160px, 0.5fr); gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .record-row:last-child { border-bottom: 0; }
    .record-row strong { font-weight: 620; overflow-wrap: anywhere; }
    .summary-markdown { max-height: 440px; white-space: pre-wrap; }
    @media (max-width: 980px) {
      .hero-card, .detail-hero, .review-sections, .technical-grid, .summary-grid { grid-template-columns: 1fr; }
      .review-top { grid-template-columns: 1fr; }
      .hero-meta { min-width: 0; }
    }
    @media (max-width: 760px) {
      .shell { padding: 12px 10px 28px; }
      header { display: grid; align-items: start; }
      .stats { grid-template-columns: 1fr 1fr; }
      dl, .kv, .workspace-card dl { grid-template-columns: 1fr; }
      .summary-list, .summary-list div { grid-template-columns: 1fr; }
      .record-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 520px) { .stats { grid-template-columns: 1fr; } }
  `
}

type LocalAdminConsolePage = "run" | "actions" | "artifacts" | "approvals"

function currentPageAttr(page: LocalAdminConsolePage, currentPage: LocalAdminConsolePage): string {
  return page === currentPage ? ` aria-current="page"` : ""
}

function renderLayout(
  title: string,
  state: LocalAdminConsoleState,
  body: string,
  currentPage: LocalAdminConsolePage,
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Agentic Local Admin</title>
  <style>
${renderAdminDesignSystemStyles()}
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand-cluster">
        <div class="brand-mark" aria-hidden="true">A</div>
        <div>
          <div class="eyebrow">Agentic Local Admin</div>
          <h1>${escapeHtml(state.bundle.name)} <span class="meta">${escapeHtml(state.bundle.version)}</span></h1>
          <div class="meta mono" title="${escapeHtml(state.run.id)}">run ${escapeHtml(compactId(state.run.id))} - ${escapeHtml(state.run.status)}</div>
        </div>
      </div>
      <nav class="nav" aria-label="Admin navigation">
        <a href="/runs/latest"${currentPageAttr("run", currentPage)}>Run</a>
        <a href="/actions"${currentPageAttr("actions", currentPage)}>Actions</a>
        <a href="/artifacts"${currentPageAttr("artifacts", currentPage)}>Artifacts</a>
        <a href="/approvals"${currentPageAttr("approvals", currentPage)}>Approvals</a>
      </nav>
    </header>
    ${body}
  </div>
</body>
</html>`
}

function renderMetricCard(label: string, value: string | number, detail: string): string {
  return `<div class="card metric-card">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="stat-value">${escapeHtml(value)}</div>
    <div class="metric-detail">${escapeHtml(detail)}</div>
  </div>`
}

function latestMessage(state: LocalAdminConsoleState): string {
  return typeof state.latest.message === "string" ? state.latest.message : "Latest run state is available for local inspection."
}

function actionSource(action: ActionRecord): string {
  if (action.surface !== undefined) return `surface:${action.surface}`
  if (action.schedule !== undefined) return `schedule:${action.schedule}`
  if (action.hook !== undefined) return `hook:${action.hook}`
  return "direct"
}

function actionPrimaryEffect(action: ActionRecord): string {
  const effect = primaryExternalEffect(action.effects ?? [])
  return effect === undefined ? "No external effect" : humanizeEffect(effect)
}

function artifactReferences(
  state: LocalAdminConsoleState,
  ids: readonly string[] | undefined,
): LocalBundleArtifactRecord[] {
  if (ids === undefined || ids.length === 0) return []
  const wanted = new Set(ids)
  return state.artifacts.filter((artifact) => wanted.has(artifact.id))
}

function renderArtifactReferenceList(
  state: LocalAdminConsoleState,
  ids: readonly string[] | undefined,
  emptyText: string,
): string {
  const artifacts = artifactReferences(state, ids)
  if (ids === undefined || ids.length === 0) return `<p class="meta">${escapeHtml(emptyText)}</p>`
  if (artifacts.length === 0) return renderPills(ids.map(compactId))
  return `<div class="record-list">${artifacts.map((artifact) => {
    return `<div class="record-row"><a class="mono record-link" href="/artifacts/${encodeURIComponent(artifact.id)}" title="${escapeHtml(artifact.id)}">${escapeHtml(compactId(artifact.id))}</a><strong>${escapeHtml(artifact.title)}</strong><span class="meta">${escapeHtml(artifact.type)} - ${escapeHtml(artifact.status)}</span></div>`
  }).join("")}</div>`
}

function artifactCreatorLink(state: LocalAdminConsoleState, artifact: LocalBundleArtifactRecord): string {
  const action = state.actions.find((entry) => entry.id === artifact.created_by_action_id)
  if (action === undefined) return `<span class="mono">${escapeHtml(artifact.created_by_action_id)}</span>`
  return `<a class="mono record-link" href="/actions/${encodeURIComponent(action.id)}">${escapeHtml(action.id)}</a>`
}

function approvalForArtifact(state: LocalAdminConsoleState, artifact: LocalBundleArtifactRecord): LocalAdminApproval | undefined {
  if (artifact.type !== "approval-request") return undefined
  return state.approvals.find((approval) => approval.approval_request_artifact.id === artifact.id)
}

function renderArtifactRows(state: LocalAdminConsoleState): string {
  return [...state.artifacts].reverse().map((artifact) => {
    return `<tr>
      <td>${renderStatusPill(artifact.status)}</td>
      <td><a class="record-link mono" href="/artifacts/${encodeURIComponent(artifact.id)}">${escapeHtml(artifact.id)}</a><br><span class="meta">${escapeHtml(artifact.title)}</span></td>
      <td>${escapeHtml(artifact.type)}<br><span class="meta">${escapeHtml(artifact.data_class)}</span></td>
      <td>${renderPills(artifact.tags)}</td>
      <td>${artifactCreatorLink(state, artifact)}</td>
      <td><span class="mono" title="${escapeHtml(artifact.created_at)}">${escapeHtml(formatAdminDateTime(artifact.created_at))}</span></td>
    </tr>`
  }).join("")
}

function actionApproval(state: LocalAdminConsoleState, action: ActionRecord): LocalAdminApproval | undefined {
  return state.approvals.find((approval) => approval.action.id === action.id)
}

function renderActionRows(state: LocalAdminConsoleState): string {
  return [...state.actions].reverse().map((action) => {
    const approval = actionApproval(state, action)
    const approvalStatus = approval === undefined ? "none" : approvalDisplayStatus(approval)
    return `<tr>
      <td>${renderStatusPill(action.status)}</td>
      <td><a class="record-link mono" href="/actions/${encodeURIComponent(action.id)}">${escapeHtml(action.id)}</a><br><span class="meta">${escapeHtml(action.type)}</span></td>
      <td>${escapeHtml(action.capability ?? "none")}</td>
      <td><span class="mono">${escapeHtml(action.principal)}</span><br><span class="meta">${escapeHtml(actionSource(action))}</span></td>
      <td>${escapeHtml(actionPrimaryEffect(action))}</td>
      <td>${approval === undefined ? `<span class="meta">none</span>` : `<a href="/approvals/${encodeURIComponent(action.id)}">${renderStatusPill(approvalStatus)}</a>`}</td>
    </tr>`
  }).join("")
}

function renderRunOverviewPage(state: LocalAdminConsoleState): string {
  const pendingCount = state.approvals.filter((approval) => approvalDisplayStatus(approval) === "pending").length
  const externalWriteCount = state.actions.filter((action) => {
    return (action.effects ?? []).some((effect) => effect.startsWith("external.write:"))
  }).length
  const body = `<section class="card hero-card">
    <div>
      <div class="eyebrow">Latest local run</div>
      <h2>Run Overview ${renderStatusPill(state.run.status)}</h2>
      <p class="hero-copy">${escapeHtml(latestMessage(state))}</p>
    </div>
    <div class="workspace-card">
      <dl>
        <dt>Workspace</dt><dd>${escapeHtml(state.workspace.label)}</dd>
        <dt>Manifest</dt><dd class="mono">${escapeHtml(state.bundle.manifest_path)}</dd>
        <dt>Run Dir</dt><dd class="mono">${escapeHtml(state.run.dir)}</dd>
      </dl>
    </div>
  </section>
  <section class="grid stats">
    ${renderMetricCard("Actions", state.actions.length, "Recorded in this run")}
    ${renderMetricCard("Artifacts", state.artifacts.length, "Generated or loaded")}
    ${renderMetricCard("Pending", pendingCount, "Approval decisions needed")}
    ${renderMetricCard("External Writes", externalWriteCount, "Tracked effects")}
  </section>
  <section class="review-sections">
    <div class="card">
      <h2>Operational Snapshot</h2>
      <dl>
        <dt>Status</dt><dd>${renderStatusPill(state.run.status)}</dd>
        <dt>Run</dt><dd class="mono">${escapeHtml(state.run.id)}</dd>
        <dt>Latest Pointer</dt><dd class="mono">${escapeHtml(state.run.latest_path)}</dd>
        <dt>Summary</dt><dd class="mono">${escapeHtml(state.run.summary_path)}</dd>
      </dl>
    </div>
    <div class="card next-actions">
      <h2>Review Queue</h2>
      <p>${pendingCount === 0 ? "No pending human approval is blocking this run." : `${pendingCount} approval request${pendingCount === 1 ? "" : "s"} need a human decision.`}</p>
      <div class="button-row">
        <a class="button-link primary" href="/approvals">Open Approvals</a>
        <a class="button-link" href="/actions">Inspect Actions</a>
      </div>
    </div>
  </section>
  <section class="card">
    <div class="section-heading">
      <div>
        <h2>Recent Actions</h2>
        <p>Runtime actions from the latest run, newest first.</p>
      </div>
      <a class="record-link" href="/actions">View all</a>
    </div>
    ${state.actions.length === 0 ? `<div class="empty">No actions were recorded in the latest run.</div>` : `<div class="table-wrap"><table>
      <thead><tr><th>Status</th><th>Action</th><th>Capability</th><th>Principal</th><th>Primary Effect</th><th>Approval</th></tr></thead>
      <tbody>${renderActionRows(state)}</tbody>
    </table></div>`}
  </section>
  <details class="card technical-details">
    <summary>Runtime summary and latest pointer</summary>
    <div class="technical-grid two-column">
      <div class="card">
        <h3>Summary Markdown</h3>
        ${state.run.summary_markdown === undefined ? `<p class="meta">No summary file was available for this run.</p>` : `<pre class="summary-markdown">${escapeHtml(state.run.summary_markdown)}</pre>`}
      </div>
      <div class="card">
        <h3>Latest JSON</h3>
        ${renderJsonBlock(state.latest)}
      </div>
    </div>
  </details>`
  return renderLayout("Run Overview", state, body, "run")
}

function renderActionsPage(state: LocalAdminConsoleState): string {
  const completedCount = state.actions.filter((action) => action.status === "completed").length
  const blockedCount = state.actions.filter((action) => action.status === "approval_required").length
  const failedCount = state.actions.filter((action) => action.status === "failed" || action.status === "denied").length
  const body = `<section class="card hero-card">
    <div>
      <div class="eyebrow">Runtime observability</div>
      <h2>Action Log</h2>
      <p class="hero-copy">Trace every proposed action from the latest local run, including policy status, effects, principals, and approval handoffs.</p>
    </div>
    <div class="workspace-card">
      <dl>
        <dt>Run</dt><dd class="mono">${escapeHtml(compactId(state.run.id))}</dd>
        <dt>Status</dt><dd>${renderStatusPill(state.run.status)}</dd>
        <dt>Actions</dt><dd>${escapeHtml(state.actions.length)}</dd>
      </dl>
    </div>
  </section>
  <section class="grid stats">
    ${renderMetricCard("Completed", completedCount, "Finished actions")}
    ${renderMetricCard("Blocked", blockedCount, "Approval required")}
    ${renderMetricCard("Failed", failedCount, "Denied or failed")}
    ${renderMetricCard("Approvals", state.approvals.length, "Approval request artifacts")}
  </section>
  <section class="card">
    <div class="section-heading">
      <div>
        <h2>Action Log</h2>
        <p>${state.actions.length} action${state.actions.length === 1 ? "" : "s"} in the latest run</p>
      </div>
    </div>
    ${state.actions.length === 0 ? `<div class="empty">No actions were recorded in the latest run.</div>` : `<div class="table-wrap"><table>
      <thead><tr><th>Status</th><th>Action</th><th>Capability</th><th>Principal</th><th>Primary Effect</th><th>Approval</th></tr></thead>
      <tbody>${renderActionRows(state)}</tbody>
    </table></div>`}
  </section>`
  return renderLayout("Actions", state, body, "actions")
}

function renderActionPolicySummary(action: ActionRecord): string {
  const policy = action.policy
  if (policy === undefined) return `<p class="meta">No policy decision was recorded for this action.</p>`
  const clauses = approvalRuleClauses(policy.required_approval)
  return `<dl class="kv">
    <dt>Decision</dt><dd>${renderStatusPill(policy.decision)}</dd>
    <dt>Code</dt><dd><span class="mono">${escapeHtml(policy.code ?? "none")}</span></dd>
    <dt>Capability</dt><dd>${escapeHtml(policy.capability ?? action.capability ?? "none")}</dd>
    <dt>Reason</dt><dd>${escapeHtml(policy.reason)}</dd>
    <dt>Approval Rule</dt><dd>${renderPills(clauses.map(humanizeApprovalClause))}</dd>
  </dl>`
}

function renderActionDetailPage(state: LocalAdminConsoleState, action: ActionRecord): string {
  const approval = actionApproval(state, action)
  const effects = action.effects ?? []
  const approvalPanel = approval === undefined
    ? `<p class="meta">No approval request is associated with this action.</p>`
    : `<dl class="kv">
        <dt>Status</dt><dd>${renderStatusPill(approvalDisplayStatus(approval))}</dd>
        <dt>Request</dt><dd><span class="mono" title="${escapeHtml(approval.approval_request_artifact.id)}">${escapeHtml(compactId(approval.approval_request_artifact.id))}</span></dd>
        <dt>Expires</dt><dd title="${escapeHtml(approval.approval_request.expires_at)}">${escapeHtml(formatAdminDateTime(approval.approval_request.expires_at))}</dd>
        <dt>Review</dt><dd><a class="record-link" href="/approvals/${encodeURIComponent(action.id)}">Open approval detail</a></dd>
      </dl>`
  const body = `<p class="breadcrumb"><a href="/actions">Actions</a> / <span class="mono">${escapeHtml(action.id)}</span></p>
  <section class="card detail-hero">
    <div>
      <div class="eyebrow">Action trace</div>
      <h2>Action Detail ${renderStatusPill(action.status)}</h2>
      <p class="hero-copy">Inspect the policy result, recorded effects, payload summary, and linked artifacts for this exact stored action.</p>
    </div>
    <div class="hero-meta">
      <dl class="kv">
        <dt>Status</dt><dd>${renderStatusPill(action.status)}</dd>
        <dt>Type</dt><dd>${escapeHtml(action.type)}</dd>
        <dt>Created</dt><dd title="${escapeHtml(action.created_at)}">${escapeHtml(formatAdminDateTime(action.created_at))}</dd>
      </dl>
    </div>
  </section>
  <section class="review-top">
    <div class="card">
      <h2>Action at a glance</h2>
      <dl>
        <dt>Action</dt><dd class="mono">${escapeHtml(action.id)}</dd>
        <dt>Principal</dt><dd class="mono">${escapeHtml(action.principal)}</dd>
        <dt>Capability</dt><dd>${escapeHtml(action.capability ?? "none")}</dd>
        <dt>Source</dt><dd class="mono">${escapeHtml(actionSource(action))}</dd>
        <dt>Digest</dt><dd>${action.digest === undefined ? `<span class="meta">none</span>` : `<span class="mono" title="${escapeHtml(action.digest)}">${escapeHtml(shortValue(action.digest, 18, 10))}</span>`}</dd>
        <dt>Primary Effect</dt><dd>${escapeHtml(actionPrimaryEffect(action))}</dd>
      </dl>
    </div>
    <div class="card">
      <h2>Approval Handoff</h2>
      ${approvalPanel}
    </div>
  </section>
  <section class="review-sections">
    <div class="card">
      <h3>Policy Decision</h3>
      ${renderActionPolicySummary(action)}
    </div>
    <div class="card">
      <h3>Effects</h3>
      ${effects.length === 0 ? `<p class="meta">No effects were recorded.</p>` : renderPills(effects.map(humanizeEffect))}
    </div>
  </section>
  <section class="review-sections">
    <div class="card">
      <h3>Input Artifacts</h3>
      ${renderArtifactReferenceList(state, action.input_artifact_ids, "No input artifacts were recorded.")}
    </div>
    <div class="card">
      <h3>Output Artifacts</h3>
      ${renderArtifactReferenceList(state, action.output_artifact_ids, "No output artifacts were recorded.")}
    </div>
  </section>
  <details class="card technical-details">
    <summary>Payload and raw action record</summary>
    <div class="technical-grid two-column">
      <div class="card">
        <h3>Payload Summary</h3>
        ${renderObjectSummary(action.payload ?? {})}
        ${rawJsonDetails("Raw payload JSON", action.payload ?? {})}
      </div>
      <div class="card">
        <h3>Action Record</h3>
        ${renderJsonBlock(action)}
      </div>
    </div>
  </details>`
  return renderLayout(`Action ${action.id}`, state, body, "actions")
}

function renderArtifactsPage(state: LocalAdminConsoleState): string {
  const finalizedCount = state.artifacts.filter((artifact) => artifact.finalized).length
  const draftCount = state.artifacts.filter((artifact) => !artifact.finalized).length
  const approvalRequestCount = state.artifacts.filter((artifact) => artifact.type === "approval-request").length
  const types = new Set(state.artifacts.map((artifact) => artifact.type))
  const body = `<section class="card hero-card">
    <div>
      <div class="eyebrow">Runtime artifacts</div>
      <h2>Artifact Browser</h2>
      <p class="hero-copy">Inspect generated artifacts from the latest local run, including lineage, status, data class, and safely escaped structured bodies.</p>
    </div>
    <div class="workspace-card">
      <dl>
        <dt>Run</dt><dd class="mono">${escapeHtml(compactId(state.run.id))}</dd>
        <dt>Status</dt><dd>${renderStatusPill(state.run.status)}</dd>
        <dt>Artifacts</dt><dd>${escapeHtml(state.artifacts.length)}</dd>
      </dl>
    </div>
  </section>
  <section class="grid stats">
    ${renderMetricCard("Artifacts", state.artifacts.length, "Available in this run")}
    ${renderMetricCard("Types", types.size, "Distinct artifact types")}
    ${renderMetricCard("Finalized", finalizedCount, "Read-only records")}
    ${renderMetricCard("Approval Requests", approvalRequestCount, "Human review packets")}
  </section>
  <section class="card">
    <div class="section-heading">
      <div>
        <h2>Artifact Browser</h2>
        <p>${draftCount === 0 ? "All artifacts are finalized." : `${draftCount} draft artifact${draftCount === 1 ? "" : "s"} remain writable.`}</p>
      </div>
    </div>
    ${state.artifacts.length === 0 ? `<div class="empty">No artifacts were recorded in the latest run.</div>` : `<div class="table-wrap"><table>
      <thead><tr><th>Status</th><th>Artifact</th><th>Type</th><th>Tags</th><th>Created By</th><th>Created</th></tr></thead>
      <tbody>${renderArtifactRows(state)}</tbody>
    </table></div>`}
  </section>`
  return renderLayout("Artifacts", state, body, "artifacts")
}

function renderArtifactDetailPage(state: LocalAdminConsoleState, artifact: LocalBundleArtifactRecord): string {
  const createdByAction = state.actions.find((action) => action.id === artifact.created_by_action_id)
  const approval = approvalForArtifact(state, artifact)
  const approvalLink = approval === undefined
    ? `<p class="meta">This artifact is not an approval request.</p>`
    : `<dl class="kv">
        <dt>Approval</dt><dd><a class="record-link" href="/approvals/${encodeURIComponent(approval.action.id)}">Open approval detail</a></dd>
        <dt>Action</dt><dd><a class="mono record-link" href="/actions/${encodeURIComponent(approval.action.id)}">${escapeHtml(approval.action.id)}</a></dd>
        <dt>Status</dt><dd>${renderStatusPill(approvalDisplayStatus(approval))}</dd>
      </dl>`
  const body = `<p class="breadcrumb"><a href="/artifacts">Artifacts</a> / <span class="mono">${escapeHtml(artifact.id)}</span></p>
  <section class="card detail-hero">
    <div>
      <div class="eyebrow">Artifact record</div>
      <h2>${escapeHtml(artifact.title)} ${renderStatusPill(artifact.status)}</h2>
      <p class="hero-copy">Review the artifact's lineage and structured body without treating the body as trusted HTML.</p>
    </div>
    <div class="hero-meta">
      <dl class="kv">
        <dt>Type</dt><dd>${escapeHtml(artifact.type)}</dd>
        <dt>Version</dt><dd>${escapeHtml(artifact.version)}</dd>
        <dt>Finalized</dt><dd>${escapeHtml(artifact.finalized ? "yes" : "no")}</dd>
      </dl>
    </div>
  </section>
  <section class="review-top">
    <div class="card">
      <h2>Artifact at a glance</h2>
      <dl>
        <dt>Artifact</dt><dd class="mono">${escapeHtml(artifact.id)}</dd>
        <dt>Data Class</dt><dd>${escapeHtml(artifact.data_class)}</dd>
        <dt>Tags</dt><dd>${renderPills(artifact.tags)}</dd>
        <dt>Created</dt><dd title="${escapeHtml(artifact.created_at)}">${escapeHtml(formatAdminDateTime(artifact.created_at))}</dd>
        <dt>Created By</dt><dd>${artifactCreatorLink(state, artifact)}</dd>
        <dt>Source</dt><dd>${artifact.source === undefined ? `<span class="meta">not recorded</span>` : renderInlineJsonValue(artifact.source)}</dd>
      </dl>
    </div>
    <div class="card">
      <h2>Approval Context</h2>
      ${approvalLink}
    </div>
  </section>
  <section class="review-sections">
    <div class="card">
      <h3>Derived From</h3>
      ${renderArtifactReferenceList(state, artifact.derived_from, "No source artifacts were recorded.")}
    </div>
    <div class="card">
      <h3>Created Action</h3>
      ${createdByAction === undefined ? `<p class="meta">No matching action record was found.</p>` : `<dl class="kv">
        <dt>Status</dt><dd>${renderStatusPill(createdByAction.status)}</dd>
        <dt>Type</dt><dd>${escapeHtml(createdByAction.type)}</dd>
        <dt>Capability</dt><dd>${escapeHtml(createdByAction.capability ?? "none")}</dd>
        <dt>Open</dt><dd><a class="record-link" href="/actions/${encodeURIComponent(createdByAction.id)}">Open action detail</a></dd>
      </dl>`}
    </div>
  </section>
  <section class="card">
    <h2>Artifact Body</h2>
    ${renderObjectSummary(artifact.body)}
    ${rawJsonDetails("Raw Artifact JSON", artifact)}
  </section>`
  return renderLayout(`Artifact ${artifact.id}`, state, body, "artifacts")
}

function renderApprovalsPage(state: LocalAdminConsoleState): string {
  const pendingCount = state.approvals.filter((approval) => approvalDisplayStatus(approval) === "pending").length
  const decidedCount = state.approvals.filter((approval) => approval.decision !== undefined).length
  const rows = state.approvals.map((approval) => {
    const status = approvalDisplayStatus(approval)
    return `<tr>
      <td>${renderStatusPill(status)}</td>
      <td><a class="record-link mono" href="/approvals/${encodeURIComponent(approval.action.id)}">${escapeHtml(approval.action.id)}</a><br><span class="meta">${escapeHtml(approval.action.type)}</span></td>
      <td>${escapeHtml(approval.action.capability ?? "none")}</td>
      <td class="mono">${escapeHtml(approval.action.principal)}</td>
      <td><span class="mono" title="${escapeHtml(approval.approval_request.expires_at)}">${escapeHtml(formatAdminDateTime(approval.approval_request.expires_at))}</span></td>
    </tr>`
  }).join("")
  const body = `<section class="card hero-card">
    <div>
      <div class="eyebrow">Runtime control plane</div>
      <h2>Approval Inbox</h2>
      <p class="hero-copy">Review approval-gated actions from the latest local run, then grant or reject the exact stored action payload.</p>
    </div>
    <div class="workspace-card">
      <dl>
        <dt>Workspace</dt><dd>${escapeHtml(state.workspace.label)}</dd>
        <dt>Manifest</dt><dd class="mono">${escapeHtml(state.bundle.manifest_path)}</dd>
        <dt>Summary</dt><dd class="mono">${escapeHtml(state.run.summary_path)}</dd>
      </dl>
    </div>
  </section>
  <section class="grid stats">
    ${renderMetricCard("Pending", pendingCount, "Need a human decision")}
    ${renderMetricCard("Decided", decidedCount, "Granted or rejected")}
    ${renderMetricCard("Actions", state.actions.length, "Recorded in this run")}
    ${renderMetricCard("Artifacts", state.artifacts.length, "Available for review")}
  </section>
  <section class="card">
    <div class="section-heading">
      <div>
        <h2>Approval Inbox</h2>
        <p>${state.approvals.length} request${state.approvals.length === 1 ? "" : "s"} in the latest run</p>
      </div>
    </div>
    ${state.approvals.length === 0 ? `<div class="empty">No approval requests in the latest run.</div>` : `<div class="table-wrap"><table>
      <thead><tr><th>Status</th><th>Action</th><th>Capability</th><th>Requester</th><th>Expires</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`}
  </section>`
  return renderLayout("Approvals", state, body, "approvals")
}

function principalOptions(state: LocalAdminConsoleState): string {
  return state.human_principals.map((principal) => {
    const roles = principal.roles.length === 0 ? "" : ` (${principal.roles.join(", ")})`
    return `<option value="${escapeHtml(principal.id)}">${escapeHtml(principal.id + roles)}</option>`
  }).join("")
}

function renderDecisionForm(
  state: LocalAdminConsoleState,
  approval: LocalAdminApproval,
  csrfToken: string,
): string {
  const status = approvalDisplayStatus(approval)
  if (status !== "pending") {
    return `<div class="card decision-card"><h2>Decision</h2>${approval.decision === undefined ? `<p class="meta">No decision can be recorded because this approval is ${escapeHtml(status)}.</p>` : renderJsonBlock(approval.decision)}</div>`
  }
  if (state.human_principals.length === 0) {
    return `<div class="card decision-card"><h2>Decision</h2><p class="meta">No human principals are declared in this bundle.</p></div>`
  }
  return `<div class="card decision-card">
    <h2>Decision</h2>
    <form method="post" action="/approvals/${encodeURIComponent(approval.action.id)}/approve">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
      <label>Principal<select name="principal" required>${principalOptions(state)}</select></label>
      <label>Comment<textarea name="comment" placeholder="Optional approval note"></textarea></label>
      <div class="button-row">
        <button class="primary" type="submit">Approve And Resume</button>
        <button class="danger" type="submit" formaction="/approvals/${encodeURIComponent(approval.action.id)}/reject">Reject</button>
      </div>
    </form>
  </div>`
}

function renderApprovalDetailPage(
  state: LocalAdminConsoleState,
  approval: LocalAdminApproval,
  csrfToken: string,
): string {
  const status = approvalDisplayStatus(approval)
  const artifacts = approval.input_artifacts.map(renderArtifactSummary).join("")
  const body = `<p class="breadcrumb"><a href="/approvals">Approvals</a> / <span class="mono">${escapeHtml(approval.action.id)}</span></p>
  <section class="card detail-hero">
    <div>
      <div class="eyebrow">Approval review</div>
      <h2>Approval Detail ${renderStatusPill(status)}</h2>
      <p class="hero-copy">Confirm the requested effect, the reason approval is required, and the human principal before resuming this action.</p>
    </div>
    <div class="hero-meta">
      <dl class="kv">
        <dt>Status</dt><dd>${renderStatusPill(status)}</dd>
        <dt>Expires</dt><dd title="${escapeHtml(approval.approval_request.expires_at)}">${escapeHtml(formatAdminDateTime(approval.approval_request.expires_at))}</dd>
        <dt>Capability</dt><dd>${escapeHtml(approval.action.capability ?? "none")}</dd>
      </dl>
    </div>
  </section>
  <section class="review-top">
    <div class="card">
      <h2>Action at a glance</h2>
      <dl>
        <dt>Action</dt><dd class="mono">${escapeHtml(approval.action.id)}</dd>
        <dt>Type</dt><dd>${escapeHtml(approval.action.type)}</dd>
        <dt>Requester</dt><dd class="mono">${escapeHtml(approval.action.principal)}</dd>
        <dt>Capability</dt><dd>${escapeHtml(approval.action.capability ?? "none")}</dd>
        <dt>Effects</dt><dd>${renderPills(approval.approval_request.effects.map(humanizeEffect))}</dd>
        <dt>Expires</dt><dd title="${escapeHtml(approval.approval_request.expires_at)}">${escapeHtml(formatAdminDateTime(approval.approval_request.expires_at))}</dd>
      </dl>
    </div>
    ${renderDecisionForm(state, approval, csrfToken)}
  </section>
  <section class="review-sections">
    ${renderReviewSummary(approval)}
    ${renderApprovalReason(approval)}
  </section>
  <details class="card technical-details">
    <summary>Technical details</summary>
    <div class="technical-grid">
    <div class="card">
      <h3>Action Payload</h3>
      ${renderObjectSummary(approval.action.payload ?? {})}
      ${rawJsonDetails("Raw action JSON", approval.action.payload ?? {})}
    </div>
    <div class="card">
      <h3>Approval Request</h3>
      ${renderApprovalRequestSummary(approval)}
      ${rawJsonDetails("Raw request JSON", approval.approval_request)}
    </div>
    <div class="card">
      <h3>Policy Decision</h3>
      ${renderPolicySummary(approval)}
      ${rawJsonDetails("Raw policy JSON", approval.action.policy ?? {})}
    </div>
    </div>
  </details>
  <section>
    <h2>Input Artifacts</h2>
    ${artifacts.length === 0 ? `<div class="card empty">No input artifacts were recorded for this approval.</div>` : artifacts}
  </section>`
  return renderLayout(`Approval ${approval.action.id}`, state, body, "approvals")
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 303, headers: { location } })
}

function errorResponse(message: string, status = 500): Response {
  return htmlResponse(`<!doctype html><title>Agentic Local Admin Error</title><pre>${escapeHtml(message)}</pre>`, status)
}

function apiApproval(approval: LocalAdminApproval): Record<string, unknown> {
  return {
    action_id: approval.action.id,
    action_type: approval.action.type,
    status: approvalDisplayStatus(approval),
    action_status: approval.action.status,
    capability: approval.action.capability ?? null,
    principal: approval.action.principal,
    action_digest: approval.action.digest ?? null,
    expires_at: approval.approval_request.expires_at,
    approval_request_id: approval.approval_request_artifact.id,
    decision: approval.decision ?? null,
    input_artifact_ids: approval.input_artifacts.map((artifact) => artifact.id),
  }
}

function apiAction(state: LocalAdminConsoleState, action: ActionRecord): Record<string, unknown> {
  const approval = actionApproval(state, action)
  return {
    id: action.id,
    type: action.type,
    status: action.status,
    principal: action.principal,
    created_at: action.created_at,
    completed_at: action.completed_at ?? null,
    data_class: action.data_class ?? null,
    capability: action.capability ?? null,
    source: actionSource(action),
    effects: action.effects ?? [],
    primary_effect: actionPrimaryEffect(action),
    policy: action.policy ?? null,
    digest: action.digest ?? null,
    input_artifact_ids: action.input_artifact_ids ?? [],
    output_artifact_ids: action.output_artifact_ids ?? [],
    approval: approval === undefined ? null : apiApproval(approval),
    payload: redactSensitiveJson(action.payload ?? {}),
    error: action.error ?? null,
  }
}

function apiArtifact(state: LocalAdminConsoleState, artifact: LocalBundleArtifactRecord): Record<string, unknown> {
  const approval = approvalForArtifact(state, artifact)
  const createdByAction = state.actions.find((action) => action.id === artifact.created_by_action_id)
  return {
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    status: artifact.status,
    version: artifact.version,
    finalized: artifact.finalized,
    data_class: artifact.data_class,
    tags: artifact.tags,
    source: artifact.source === undefined ? null : redactSensitiveJson(artifact.source),
    derived_from: artifact.derived_from ?? [],
    created_by_action_id: artifact.created_by_action_id,
    created_at: artifact.created_at,
    created_by_action: createdByAction === undefined ? null : apiAction(state, createdByAction),
    approval: approval === undefined ? null : apiApproval(approval),
    body: redactSensitiveJson(artifact.body),
  }
}

function apiConsoleState(state: LocalAdminConsoleState): Record<string, unknown> {
  return {
    workspace: state.workspace,
    bundle: state.bundle,
    run: state.run,
    counts: {
      approvals: state.approvals.length,
      pending_approvals: state.approvals.filter((approval) => approvalDisplayStatus(approval) === "pending").length,
      actions: state.actions.length,
      artifacts: state.artifacts.length,
    },
    latest: state.latest,
    actions: state.actions.map((action) => apiAction(state, action)),
    artifacts: state.artifacts.map((artifact) => apiArtifact(state, artifact)),
    approvals: state.approvals.map(apiApproval),
  }
}

async function decisionFormValue(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    const parsed = await request.json()
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const output: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") output[key] = value
    }
    return output
  }

  const form = await request.formData()
  const output: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") output[key] = value
  }
  return output
}

function requireCsrfToken(input: Record<string, string>, request: Request, expected: string): Response | undefined {
  const token = input._csrf ?? request.headers.get("x-agentic-csrf") ?? ""
  if (token === expected) return undefined
  return errorResponse("Forbidden: missing or invalid local admin CSRF token.", 403)
}

async function handleApprovalDecisionRequest(
  ctx: RuntimeContext,
  options: LocalAdminConsoleOptions,
  request: Request,
  actionId: string,
  decision: "approve" | "reject",
  api: boolean,
): Promise<Response> {
  const input = await decisionFormValue(request)
  const csrfError = requireCsrfToken(input, request, options.csrfToken ?? "")
  if (csrfError !== undefined) return csrfError
  const principal = input.principal
  if (principal === undefined || principal.trim() === "") {
    return errorResponse("A human approval principal is required.", 400)
  }
  const comment = input.comment?.trim() === "" ? undefined : input.comment
  const targetArgs = localAdminConsoleTargetArgs(options)
  const commandArgs: RuntimeApprovalDecisionArgs = {
    target: targetArgs.target,
    action_id: actionId,
    principal,
    args: [],
    flags: targetArgs.flags,
  }
  if (comment !== undefined) commandArgs.comment = comment
  const result = decision === "approve"
    ? await approveLocalRuntime(ctx, commandArgs)
    : await rejectLocalRuntime(ctx, commandArgs)
  if (api) return jsonResponse(result.data ?? {})
  return redirectResponse(`/approvals/${encodeURIComponent(actionId)}`)
}

export function createLocalAdminConsoleHandler(
  ctx: RuntimeContext,
  options: LocalAdminConsoleOptions = {},
): (request: Request) => Promise<Response> {
  const csrfToken = options.csrfToken ?? crypto.randomUUID()
  const handlerOptions: LocalAdminConsoleOptions = { ...options, csrfToken }
  return async function handleLocalAdminConsoleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment))

    try {
      if (request.method === "GET" && segments.length === 0) {
        return htmlResponse(renderRunOverviewPage(await loadLocalAdminConsoleState(ctx, handlerOptions)))
      }

      if (request.method === "GET" && segments[0] === "api" && segments[1] === "runs" && segments[2] === "latest" && segments.length === 3) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        return jsonResponse({ ...apiConsoleState(state), summary_markdown: state.run.summary_markdown ?? null })
      }

      if (request.method === "GET" && segments[0] === "api" && segments[1] === "actions" && segments.length === 2) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        return jsonResponse({ run: state.run, actions: state.actions.map((action) => apiAction(state, action)) })
      }

      if (request.method === "GET" && segments[0] === "api" && segments[1] === "actions" && segments.length === 3) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        const action = state.actions.find((entry) => entry.id === segments[2])
        if (action === undefined) return jsonResponse({ error: "action not found" }, 404)
        return jsonResponse(apiAction(state, action))
      }

      if (request.method === "GET" && segments[0] === "api" && segments[1] === "artifacts" && segments.length === 2) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        return jsonResponse({ run: state.run, artifacts: state.artifacts.map((artifact) => apiArtifact(state, artifact)) })
      }

      if (request.method === "GET" && segments[0] === "api" && segments[1] === "artifacts" && segments.length === 3) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        const artifact = state.artifacts.find((entry) => entry.id === segments[2])
        if (artifact === undefined) return jsonResponse({ error: "artifact not found" }, 404)
        return jsonResponse(apiArtifact(state, artifact))
      }

      if (request.method === "GET" && segments[0] === "api" && segments[1] === "approvals" && segments.length === 2) {
        return jsonResponse(apiConsoleState(await loadLocalAdminConsoleState(ctx, handlerOptions)))
      }

      if (request.method === "GET" && segments[0] === "api" && segments[1] === "approvals" && segments.length === 3) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        const approval = state.approvals.find((entry) => entry.action.id === segments[2])
        if (approval === undefined) return jsonResponse({ error: "approval not found" }, 404)
        return jsonResponse(apiApproval(approval))
      }

      if (request.method === "GET" && segments[0] === "approvals" && segments.length === 1) {
        return htmlResponse(renderApprovalsPage(await loadLocalAdminConsoleState(ctx, handlerOptions)))
      }

      if (request.method === "GET" && segments[0] === "runs" && segments[1] === "latest" && segments.length === 2) {
        return htmlResponse(renderRunOverviewPage(await loadLocalAdminConsoleState(ctx, handlerOptions)))
      }

      if (request.method === "GET" && segments[0] === "actions" && segments.length === 1) {
        return htmlResponse(renderActionsPage(await loadLocalAdminConsoleState(ctx, handlerOptions)))
      }

      if (request.method === "GET" && segments[0] === "actions" && segments.length === 2) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        const action = state.actions.find((entry) => entry.id === segments[1])
        if (action === undefined) return errorResponse("Action not found.", 404)
        return htmlResponse(renderActionDetailPage(state, action))
      }

      if (request.method === "GET" && segments[0] === "artifacts" && segments.length === 1) {
        return htmlResponse(renderArtifactsPage(await loadLocalAdminConsoleState(ctx, handlerOptions)))
      }

      if (request.method === "GET" && segments[0] === "artifacts" && segments.length === 2) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        const artifact = state.artifacts.find((entry) => entry.id === segments[1])
        if (artifact === undefined) return errorResponse("Artifact not found.", 404)
        return htmlResponse(renderArtifactDetailPage(state, artifact))
      }

      if (request.method === "GET" && segments[0] === "approvals" && segments.length === 2) {
        const state = await loadLocalAdminConsoleState(ctx, handlerOptions)
        const approval = state.approvals.find((entry) => entry.action.id === segments[1])
        if (approval === undefined) return errorResponse("Approval not found.", 404)
        return htmlResponse(renderApprovalDetailPage(state, approval, csrfToken))
      }

      if (
        request.method === "POST" && segments[0] === "approvals" && segments.length === 3 &&
        (segments[2] === "approve" || segments[2] === "reject")
      ) {
        return handleApprovalDecisionRequest(ctx, handlerOptions, request, segments[1]!, segments[2], false)
      }

      if (
        request.method === "POST" && segments[0] === "api" && segments[1] === "approvals" && segments.length === 4 &&
        (segments[3] === "approve" || segments[3] === "reject")
      ) {
        return handleApprovalDecisionRequest(ctx, handlerOptions, request, segments[2]!, segments[3], true)
      }

      return errorResponse("Not found.", 404)
    } catch (err) {
      return errorResponse(errorMessage(err), 500)
    }
  }
}

function resolveLocalAdminConsoleHost(args: RuntimeRunArgs): string {
  if (args.flags["ui-host"] === true) throw new Error("`--ui-host` requires a value.")
  const host = stringFlag(args.flags, "ui-host") ?? DEFAULT_UI_HOST
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Local admin console only binds to loopback hosts: 127.0.0.1, localhost, or ::1.")
  }
  return host
}

function resolveLocalAdminConsolePort(args: RuntimeRunArgs): number {
  if (args.flags["ui-port"] === true) throw new Error("`--ui-port` requires a numeric value.")
  const raw = stringFlag(args.flags, "ui-port") ?? String(DEFAULT_UI_PORT)
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid local admin console port: ${raw}`)
  }
  return port
}

const localAdminConsoleServers: unknown[] = []

function startLocalAdminConsoleServer(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
): { url: string; host: string; port: number } {
  const host = resolveLocalAdminConsoleHost(args)
  const port = resolveLocalAdminConsolePort(args)
  const handler = createLocalAdminConsoleHandler(ctx, {
    target: args.target,
    args: args.args,
    flags: args.flags,
  })
  const server = Bun.serve({ hostname: host, port, fetch: handler })
  localAdminConsoleServers.push(server)
  if (server.port === undefined) throw new Error("Local admin console server did not report a bound port.")
  const urlHost = host === "::1" ? "[::1]" : host
  return { url: `http://${urlHost}:${server.port}`, host, port: server.port }
}

async function initLocalRuntime(
  ctx: RuntimeContext,
  _args: RuntimeInitArgs,
): Promise<RuntimeCommandResult> {
  const state = await ensureLocalRuntimeState(ctx.workspace_root)

  return {
    summary: state.created
      ? "Initialized local Agentic runtime glue."
      : "Local Agentic runtime glue is already initialized.",
    data: {
      initialized: true,
      created: state.created,
      config_dir: workspaceRelative(ctx, state.dir),
      state_path: workspaceRelative(ctx, state.path),
      targets_dir: workspaceRelative(ctx, state.targetDir),
      invocations_dir: workspaceRelative(ctx, state.invocationDir),
    },
  }
}

async function runLocalRuntime(
  ctx: RuntimeContext,
  args: RuntimeRunArgs,
): Promise<RuntimeCommandResult> {
  const target = await resolveRunTarget(ctx, args)
  const harness = resolveHarness(ctx, args)
  const contextMode = resolveContextMode(ctx, args)
  const uiRequested = booleanFlag(args, "ui")
  if (harness === "none" && piInteractive(args)) {
    throw new Error('`--interactive` requires `--harness pi` or runtime config `harness = "pi"`.')
  }
  if (!(await hasAgenticWorkspace(target.workspace_root))) {
    throw new Error(`No Agentic workspace found at ${target.workspace_root}.`)
  }
  if (uiRequested && contextMode === "artifacts") {
    throw new Error("Local admin console only supports authored bundle runs.")
  }
  if (uiRequested && (await bundleRootForWorkspace(target.workspace_root)) === undefined) {
    throw new Error("Local admin console requires an authored Agentic bundle target.")
  }
  await ensureLocalRuntimeState(target.workspace_root)

  const invocation = await createInvocation(args, target, harness)
  let run: LocalRunContext | undefined
  let harnessResult: PiHarnessResult | undefined

  try {
    run = await prepareLocalRun(ctx, target, invocation, args, contextMode)
    harnessResult = await runHarness(ctx, args, run)
    await completeInvocation(invocation, run)
  } catch (err) {
    await failInvocation(invocation, err, run)
    throw err
  }

  if (run === undefined) {
    throw new Error("Local runtime run did not produce a run context.")
  }
  const ui = uiRequested ? startLocalAdminConsoleServer(ctx, args) : undefined
  const targetName = run.bundle?.manifest.name ?? run.graph?.id ?? run.persona?.name ?? run.context_mode
  const bundleData = run.bundle === undefined
    ? {}
    : {
        ...(run.bundle_latest ?? {}),
        bundle: {
          name: run.bundle.manifest.name,
          version: run.bundle.manifest.version,
          schema_version: run.bundle.manifest.schema_version,
        },
        run_id: run.bundle_run_id,
        run_dir: pathRelative(ctx.workspace_root, run.bundle_run_dir!),
        summary_path: pathRelative(ctx.workspace_root, run.bundle_summary_path!),
        latest_path: pathRelative(ctx.workspace_root, run.bundle_latest_path!),
      }

  return {
    summary: run.context_mode === "bundle"
      ? ui === undefined
        ? `Prepared local Agentic bundle ${targetName} and wrote run ${run.bundle_run_id}.`
        : `Prepared local Agentic bundle ${targetName}, wrote run ${run.bundle_run_id}, and started the local admin console at ${ui.url}.`
      : harnessResult === undefined
      ? `Prepared local Agentic run for ${targetName} and wrote artifact ${run.artifact_id}.`
      : `Ran local Agentic target ${targetName} through Pi session ${harnessResult.session_id}.`,
    data: {
      invocation_id: invocation.id,
      invocation_path: pathRelative(
        ctx.workspace_root,
        invocationPathFor(run.target.workspace_root, invocation.id),
      ),
      target: args.target ?? run.graph?.id ?? run.persona?.name ?? run.context_mode,
      args: args.args,
      workspace: pathRelative(ctx.workspace_root, run.target.workspace_root),
      initialized: true,
      context_mode: run.context_mode,
      harness: run.harness_ref ?? null,
      harness_result: harnessResult === undefined ? null : harnessResult,
      workflow_id: run.graph?.id ?? null,
      workflow_run_id: run.workflow_run_id ?? null,
      artifact_id: run.context_mode === "bundle" ? null : run.artifact_id,
      ui: ui ?? null,
      ...bundleData,
      persona: run.persona?.name ?? null,
      skills: run.skills.map((skill) => skill.name),
      input_artifacts: run.input_artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        version: artifact.version,
      })),
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
        harness_ref: lastInvocation.harness_ref,
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
  capabilities: ["init", "run", "approve", "reject", "status"],
  commands: {
    init: initLocalRuntime,
    run: runLocalRuntime,
    approve: approveLocalRuntime,
    reject: rejectLocalRuntime,
    status: statusLocalRuntime,
  },
}

export default runtime
