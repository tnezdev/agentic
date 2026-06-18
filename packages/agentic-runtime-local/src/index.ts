import { spawn } from "node:child_process"
import { access, appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join, relative, resolve } from "node:path"
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
  ActionProposal,
  ActionRecord,
  ActionStatus,
  AgenticPorts,
  ArtifactPort,
  ArtifactAdapter,
  ArtifactMetadata,
  ArtifactRecord,
  ApprovalRequest,
  CheckActionStatusRequest,
  CheckActionStatusResult,
  GraphDef,
  JsonObject,
  JsonValue,
  LoadedAgenticBundle,
  Persona,
  PersonaFile,
  PersonaRef,
  ReadArtifactRequest,
  ReadArtifactResult,
  ResolvedActionProposal,
  RequestActionRequest,
  RequestActionResult,
  Skill,
  Task,
  TaskQuery,
  WriteDraftArtifactRequest,
  WriteDraftArtifactResult,
} from "@tnezdev/agentic"
import type {
  AgenticRuntimePackage,
  RuntimeCommandResult,
  RuntimeContext,
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
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LEN = 10
const RANDOM_LEN = 16
const OUTPUT_CAPTURE_LIMIT = 20_000

type LocalHarness = "none" | "pi"
type LocalContextMode = "workflow" | "artifacts" | "bundle"

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
  context_mode: LocalContextMode
  target: LocalRunTarget
  bundle?: LoadedAgenticBundle | undefined
  bundle_run_id?: string | undefined
  bundle_run_dir?: string | undefined
  bundle_summary_path?: string | undefined
  bundle_latest_path?: string | undefined
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
  readonly summaryPath: string
  readonly latestPath: string
  readonly actions: ActionRecord[] = []
  readonly artifacts: LocalBundleArtifactRecord[] = []
  #sequence = 0

  constructor(readonly stateDir: string, readonly runId: string) {
    this.runDir = join(stateDir, "runs", runId)
    this.artifactDir = join(this.runDir, "artifacts")
    this.actionDir = join(this.runDir, "actions")
    this.actionLogPath = join(this.runDir, "actions.jsonl")
    this.summaryPath = join(this.runDir, "summary.md")
    this.latestPath = join(stateDir, "latest.json")
  }

  async init(): Promise<void> {
    await mkdir(this.artifactDir, { recursive: true })
    await mkdir(this.actionDir, { recursive: true })
    await writeFile(this.actionLogPath, "", "utf-8")
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
    this.actions.push(action)
    await writeJson(join(this.actionDir, `${action.id}.json`), action)
    await appendFile(this.actionLogPath, `${JSON.stringify(action)}\n`, "utf-8")
    return action
  }

  async readAction(actionId: string): Promise<ActionRecord | undefined> {
    const existing = this.actions.find((entry) => entry.id === actionId)
    if (existing !== undefined) return existing
    try {
      const action = JSON.parse(await readFile(join(this.actionDir, `${actionId}.json`), "utf-8")) as ActionRecord
      this.actions.push(action)
      return action
    } catch {
      return undefined
    }
  }

  async writeSummary(markdown: string, latest: LocalBundleRunLatest): Promise<void> {
    await writeFile(this.summaryPath, markdown, "utf-8")
    await writeJson(this.latestPath, latest)
  }

  private rememberArtifact(artifact: LocalBundleArtifactRecord): void {
    const index = this.artifacts.findIndex((entry) => entry.id === artifact.id)
    if (index === -1) {
      this.artifacts.push(artifact)
    } else {
      this.artifacts[index] = artifact
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
      action: actionDeclaration as unknown as JsonObject,
    }
    const capability = resolved.capability === undefined
      ? undefined
      : this.declarations.capabilities?.find((entry) => entry.id === resolved.capability)
    if (capability !== undefined) context.capability = capability as unknown as JsonObject

    const execution = execute === undefined ? {} : await execute(context)
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
  ): Promise<ActionRecord> {
    const input: Omit<ActionRecord, "created_at" | "completed_at"> = {
      id: proposal.id,
      type: proposal.type,
      status,
      principal: proposal.principal,
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
  const message = err instanceof Error ? err.message : String(err)
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

  const latest: LocalBundleRunLatest = {
    run_id: store.runId,
    context_mode: "bundle",
    status: "prepared",
    bundle: {
      name: bundle.manifest.name,
      version: bundle.manifest.version,
    },
    runtime_invocation_id: invocation.id,
    run_dir: pathRelative(target.workspace_root, store.runDir),
    summary_path: pathRelative(target.workspace_root, store.summaryPath),
    latest_path: pathRelative(target.workspace_root, store.latestPath),
    message: "Bundle execution is prepared; trigger execution is not implemented yet.",
  }
  await store.writeSummary(renderBundlePreparedSummary(target, bundle, store, invocation), latest)

  return {
    context_mode: "bundle",
    target,
    bundle,
    bundle_run_id: store.runId,
    bundle_run_dir: store.runDir,
    bundle_summary_path: store.summaryPath,
    bundle_latest_path: store.latestPath,
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

Trigger execution, action proposal handling, handler loading, and domain artifact materialization are not implemented in this path yet.

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
  if (harness === "none" && piInteractive(args)) {
    throw new Error('`--interactive` requires `--harness pi` or runtime config `harness = "pi"`.')
  }
  if (!(await hasAgenticWorkspace(target.workspace_root))) {
    throw new Error(`No Agentic workspace found at ${target.workspace_root}.`)
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
  const targetName = run.bundle?.manifest.name ?? run.graph?.id ?? run.persona?.name ?? run.context_mode
  const bundleData = run.bundle === undefined
    ? {}
    : {
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
      ? `Prepared local Agentic bundle ${targetName} and wrote run ${run.bundle_run_id}.`
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
  capabilities: ["init", "run", "status"],
  commands: {
    init: initLocalRuntime,
    run: runLocalRuntime,
    status: statusLocalRuntime,
  },
}

export default runtime
