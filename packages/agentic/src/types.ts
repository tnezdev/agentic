import type { ArtifactAdapter } from "./artifact/adapter.js"
import type { MemoryAdapter } from "./memory/adapter.js"
import type { PersonaAdapter } from "./personas/adapter.js"
import type { Source } from "./sources/source.js"
import type { WorkflowAdapter } from "./workflow/adapter.js"

export type MemoryTier = "L1" | "L2" | "L3"

export type Memory = {
  key: string
  content: string
  source?: string | undefined
  weight: number // 0..1, set at remember time
  confidence: number // 0..1, bumped by reinforce
  tier: MemoryTier
  tags: string[]
  timestamp: string // ISO 8601
}

export type RecallQuery = {
  text?: string | undefined
  tags?: string[] | undefined
  tier?: MemoryTier | undefined
  limit: number
}

export type RecallResult = {
  memory: Memory
  score: number // adapter-determined relevance, 0..1
}

export type DreamResult = {
  promoted: string[] // keys promoted to higher tier
  pruned: string[] // keys removed (below threshold)
}

export type SporesConfig = {
  adapter: string
  memory: {
    dir: string
    defaultTier: MemoryTier
    dreamDepth: number
  }
  workflow: {
    graphsDir: string
    runsDir: string
  }
  wake: {
    template?: string | undefined // path to WAKE.md template (absolute or relative to baseDir)
  }
  runtime?: RuntimeConfig | undefined
}

/** Preferred alias for {@link SporesConfig}. Use `AgenticConfig` in new code. */
export type AgenticConfig = SporesConfig

// ---------------------------------------------------------------------------
// JSON types
// ---------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

// ---------------------------------------------------------------------------
// Workflow types (digraph runtime)
// ---------------------------------------------------------------------------

export type NodeType = "automated" | "manual"

/**
 * Structured artifact contract for a workflow node. Declares the expected
 * output shape so runtimes can validate, route, and index artifacts without
 * relying on prose in `description` or `claims`.
 *
 * `type` is required — it names the artifact kind (e.g. `"user-identity"`).
 * All other fields are optional and advisory: `required` gates whether the
 * runtime enforces presence on completion, `schema` is opaque runtime-owned
 * validation data (JSON Schema, Zod metadata, etc.), `path` is a logical
 * routing hint, and `tags` aid indexing.
 */
export type NodeArtifactDef = {
  type: ArtifactType
  description?: string
  required?: boolean
  path?: string
  tags?: string[]
  schema?: unknown
}

export type NodeDef = {
  id: string
  label: string
  description?: string
  /** @deprecated Use `artifact` instead. Kept for backward compatibility. */
  artifact_type?: string
  artifact?: NodeArtifactDef
  type?: NodeType
  claims?: string[]
  subgraph?: GraphDef
}

export type EdgeDef = {
  from: string
  to: string
  condition?: "always" | EvaluatorRef
}

export type EvaluatorRef = {
  type: "evaluator"
  criteria: string
}

export type GraphDef = {
  id: string
  name: string
  description?: string
  version: string
  nodes: NodeDef[]
  edges: EdgeDef[]
}

export type NodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "invalidated"

export type Artifact = {
  type: ArtifactType
  content: unknown
  produced_at: string
}

export type Transition = {
  node_id: string
  pass: number
  from_status: NodeStatus
  to_status: NodeStatus
  identity: string
  timestamp: string
  artifact?: Artifact
  reason?: string
  metadata?: Record<string, unknown>
}

export type NodeState = {
  node_id: string
  status: NodeStatus
  pass: number
  artifact?: Artifact
}

export type Run = {
  run_id: string
  graph_id: string
  graph_version?: string | undefined
  name?: string
  created_at: string
  history: Transition[]
}

// ---------------------------------------------------------------------------
// Skill types
// ---------------------------------------------------------------------------

/**
 * A branded URI string for SPORES-owned resources.
 * The `spores://` scheme is reserved for SPORES runtime compute, referenced
 * from within skill bodies and dispatched by the host runtime (e.g. Beacon).
 * Example: `spores://dream`, `spores://reflect`
 * @deprecated Use {@link AgenticUri} with the `agentic://` scheme in new code.
 */
export type SporesUri = `spores://${string}`

/**
 * Preferred URI type for Agentic-owned resources.
 * The `agentic://` scheme is used for runtime compute references in skill bodies.
 * Example: `agentic://dream`, `agentic://reflect`
 */
export type AgenticUri = `agentic://${string}`

/** Lightweight skill reference — metadata without body content. */
export type SkillRef = {
  name: string
  description: string
  tags: string[]
  /**
   * Optional list of capability names this skill is associated with.
   * A capability name uses dot-separated namespacing by convention:
   * `<domain>.<verb>`, e.g. `"issue_tracker.create_issue"`.
   * Hosts may use this list to bind model-readable skill instructions
   * to executable capability policy contracts.
   * Absent when the skill file does not declare a `capabilities` field.
   */
  capabilities?: string[] | undefined
  path: string // absolute path to skill.md
}

/** Fully loaded skill with body content. */
export type Skill = SkillRef & {
  content: string // body of skill.md after frontmatter
}

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export type TaskStatus =
  | "ready"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled"

export type TaskAnnotation = {
  text: string
  timestamp: string // ISO 8601
}

export type Task = {
  id: string // ULID (monotonic factory)
  description: string
  status: TaskStatus
  parent_id?: string | undefined // subtask link
  workflow_run_id?: string | undefined // link to SPORES workflow run
  tags: string[]
  annotations: TaskAnnotation[]
  recurrence?: string | undefined // deferred — field exists, semantics TBD
  wait_until?: string | undefined // ISO 8601 — nextReadyTask skips until elapsed
  created_at: string // ISO 8601
  updated_at: string // ISO 8601
  metadata?: Record<string, unknown> | undefined
}

export type TaskQuery = {
  status?: TaskStatus | undefined
  tags?: string[] | undefined
  parent_id?: string | undefined
}

// ---------------------------------------------------------------------------
// Persona types
// ---------------------------------------------------------------------------

/**
 * Situational facts resolved at activation time, substituted into a
 * persona body via `{{key}}` tokens. v0.1 is static-only — no command
 * execution, no API calls. Bodies needing richer context should instruct
 * the agent to gather it in prose.
 */
export type SituationalContext = {
  cwd: string
  timestamp: string // ISO 8601
  hostname: string
  git_branch?: string | undefined
}

/**
 * Routing hint — advisory shape used by callers (run orchestrators) to map
 * a persona to an LLM model and provider. Spores never binds a persona to
 * a model directly; the routing layer owns that decision plus guardrails,
 * observability, and provider fallback. Three levels are enough vocabulary
 * to start; expand only when a real workload demands it.
 */
export type RoutingHint = "low" | "medium" | "high"

/**
 * Metadata-only persona reference — cheap to list. Frontmatter fields only,
 * no body content. Used by `listPersonas()` and by callers scanning the
 * persona catalog for activation targets.
 *
 * Descriptions should be phrased as activation triggers ("Activate when...")
 * rather than labels ("The X maintainer") — they're agent-facing lookup hooks.
 *
 * `effort` and `reasoning` are advisory hints — see `RoutingHint`. The
 * persona declares what it wants; the routing layer decides what model
 * gets it. Personas never name models directly: a persona can edit itself,
 * so capability-shaping fields belong outside the editable surface.
 */
export type PersonaRef = {
  name: string
  description: string
  memory_tags: string[]
  skills: string[]
  task_filter?: TaskQuery | undefined
  workflow?: string | undefined
  effort?: RoutingHint | undefined
  reasoning?: RoutingHint | undefined
}

/**
 * A persona as it exists on disk: metadata + raw body with unsubstituted
 * `{{template}}` tokens. Returned by `loadPersona()`. Pair with
 * `activatePersona(file, situational)` to produce a fully rendered `Persona`.
 */
export type PersonaFile = PersonaRef & {
  body: string
  path: string // absolute path to persona file
}

/**
 * A fully activated persona — template tokens replaced with live situational
 * facts. This is what gets piped into an LLM as focus context.
 */
export type Persona = PersonaRef & {
  body: string // rendered: `{{key}}` tokens substituted
  situational: SituationalContext
  path: string
}

// ---------------------------------------------------------------------------
// Dispatch types
//
// A Dispatch is a message that crosses a boundary into an agent's turn:
// from another agent (PA→ORG, ORG→PA), from a surface (Slack, email),
// from a scheduler (recurring or one-shot wakes), or addressed to self.
// Spores ships the message shape and pure match logic; the runtime
// (caller) ships transport, scheduling, and handler execution.
//
// See PROJECTS/spores/DESIGN-runtime-description.md §"Dispatch primitive
// shape" for the full design.
// ---------------------------------------------------------------------------

/** ULID-shaped identifier. Same monotonic-factory shape as Task.id. */
export type DispatchId = string

/**
 * The message shape that crosses every boundary into an agent's turn.
 * `from` and `to` are runtime-assigned addresses (e.g. `pa:user-x`,
 * `org:channel-y`, `scheduler`, `self`, `surface:slack`); the convention
 * is colon-separated kind:identifier but spores does not enforce it —
 * callers can use whatever address scheme their runtime prefers.
 *
 * `when` and `recurrence` are *delivery metadata* — sender-side scheduling.
 * The scheduler is just the runtime executor of recurring sends; from the
 * handler's perspective, every dispatch arrives the same way regardless
 * of source (scheduled, surface, agent-to-agent).
 */
export type Dispatch = {
  id: DispatchId
  from: string
  to: string
  payload: unknown
  timestamp: string // ISO 8601 — when the dispatch was emitted
  when?: string | undefined // ISO 8601 — deferred delivery
  recurrence?: string | undefined // cron expression or ISO 8601 duration
}

/**
 * Declarative predicate over `from` and `to`. A string matches by equality;
 * a string array matches by inclusion (one-of). An undefined field places
 * no constraint. An empty filter matches every dispatch.
 *
 * Payload-shape matching is intentionally absent at the foundation layer:
 * payload schemas are source-specific, and a one-size predicate language
 * would force premature decisions. Callers needing payload matching can
 * compose a function filter `(d) => match(d, baseFilter) && payloadCheck(d)`
 * outside this module.
 */
export type DispatchFilter = {
  from?: string | readonly string[] | undefined
  to?: string | readonly string[] | undefined
}

/**
 * Lifecycle hooks attached at handler registration. `onRegister` runs once
 * when the handler is brought up (idempotency is the registrar's
 * responsibility — spores stays stateless about prior runs). `onUnregister`
 * runs once at teardown. Both default to no-op when omitted.
 *
 * The caller (runtime) decides *when* to fire `onRegister` — at process
 * boot for long-running daemons, at deploy time for serverless. Spores
 * ships the hook shape; the runtime owns the policy.
 */
export type DispatchHandlerHooks = {
  onRegister?: () => Promise<void>
  onUnregister?: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Bundle manifest types
//
// A bundle manifest is authored configuration. Core owns the portable shape and
// validation vocabulary; runtimes own materialization, deployment, and state.
// ---------------------------------------------------------------------------

export type AgenticBundleSectionName =
  | "prompts"
  | "skills"
  | "artifacts"
  | "actions"
  | "capabilities"
  | "hooks"
  | "surfaces"
  | "schedules"
  | "integrations"
  | "policies"
  | "deploy"
  | "evals"
  | "fixtures"

export type AgenticBundleRef = {
  id: string
  path: string
}

export type AgenticBundleState = {
  adapter: string
  dir: string
}

export type AgenticPrincipalDeclaration = {
  id: string
  kind?: string | undefined
  roles?: string[] | undefined
  description?: string | undefined
  metadata?: JsonObject | undefined
}

export type AgenticBundleManifest = {
  schema_version: string
  name: string
  version: string
  description: string
  state: AgenticBundleState
  principals: AgenticPrincipalDeclaration[]
  prompts: AgenticBundleRef[]
  skills: AgenticBundleRef[]
  artifacts: AgenticBundleRef[]
  actions: AgenticBundleRef[]
  capabilities: AgenticBundleRef[]
  hooks: AgenticBundleRef[]
  surfaces: AgenticBundleRef[]
  schedules: AgenticBundleRef[]
  integrations: AgenticBundleRef[]
  policies: AgenticBundleRef[]
  deploy: AgenticBundleRef[]
  evals: AgenticBundleRef[]
  fixtures: AgenticBundleRef[]
}

// ---------------------------------------------------------------------------
// Surface, schedule, and hook declaration types
//
// These are authored bundle declarations. They describe ingress/reaction points
// and action proposals; runtimes still decide when to fire them and must route
// every effect through ActionGatewayPort.requestAction.
// ---------------------------------------------------------------------------

export type ProposedActionRef = {
  action: string
  capability?: string | undefined
  reason?: string | undefined
}

export type ActionProposalTemplate = ProposedActionRef & {
  principal?: string | undefined
  data_class?: string | undefined
  input_artifact_ids?: string[] | undefined
  payload?: JsonObject | undefined
}

export type SurfaceArtifactEmission = {
  artifact: ArtifactType
  status?: string | undefined
  tags?: string[] | undefined
}

export type SurfaceDeclaration = {
  id: string
  kind?: string | undefined
  surface: string
  route?: string | undefined
  principal: string
  fixture?: string | undefined
  emits?: SurfaceArtifactEmission[] | undefined
  proposes: ActionProposalTemplate
  notes?: string | undefined
  metadata?: JsonObject | undefined
}

export type ScheduleArtifactSelector = {
  artifact: ArtifactType
  status?: string | undefined
  tags?: string[] | undefined
}

export type ScheduleDeclaration = {
  id: string
  kind?: string | undefined
  cron: string
  timezone?: string | undefined
  principal: string
  selects?: ScheduleArtifactSelector | undefined
  proposes: ActionProposalTemplate
  notes?: string | undefined
  metadata?: JsonObject | undefined
}

export type HookMatchDeclaration = {
  "artifact.type": ArtifactType
  "artifact.status"?: string | undefined
}

export type HookDeclaration = {
  id: string
  kind?: string | undefined
  description?: string | undefined
  on: HookMatchDeclaration
  proposes: ActionProposalTemplate
  policy_note?: string | undefined
  metadata?: JsonObject | undefined
}

// ---------------------------------------------------------------------------
// Action gateway types
//
// Action gateways are the portable policy membrane between agent requests and
// runtime-owned effects. Core owns vocabulary and pure helpers; runtimes own
// identity binding, persistence, approval channels, handlers, and execution.
// ---------------------------------------------------------------------------

export type ActionDigest = string

export type ActionDecisionStatus = "allow" | "deny" | "approval_required"

export type ActionStatus = "completed" | "denied" | "approval_required" | "failed"

export type ActionPolicyReason =
  | "allowed"
  | "approval_required"
  | "missing_action_declaration"
  | "undeclared_principal"
  | "data_boundary_denied"
  | "action_capability_mismatch"
  | "capability_not_declared"
  | "capability_action_mismatch"
  | "principal_not_allowed"
  | "effect_not_allowed"
  | "data_class_not_allowed"
  | "integration_missing"
  | "integration_unavailable"
  | "service_principal_required"

export type ActionDecision = {
  decision: ActionDecisionStatus
  reason: string
  code?: ActionPolicyReason | undefined
  capability?: string | undefined
  required_approval?: JsonObject | undefined
}

export type ActionPolicyResult = ActionDecision

export type ActionDeclaration = {
  id: string
  capability?: string | undefined
  effects?: string[] | undefined
}

export type ActionCapabilityDeclaration = {
  id: string
  action?: string | undefined
  effects?: string[] | undefined
  data_classes?: string[] | undefined
  principals?: {
    allowed?: string[] | undefined
  } | undefined
  integrations?: string[] | undefined
  approval?: {
    required?: boolean | undefined
    approver_rule?: JsonObject | undefined
  } | undefined
}

export type ActionIntegrationDeclaration = {
  id: string
  availability?: string | undefined
}

export type ActionDataBoundaryPolicy = {
  allowed_data_classes?: string[] | undefined
  disallowed?: string[] | undefined
}

export type ActionProposal = {
  id?: string | undefined
  type: string
  principal: string
  data_class: string
  capability?: string | undefined
  surface?: string | undefined
  schedule?: string | undefined
  hook?: string | undefined
  input_artifact_ids?: string[] | undefined
  effects?: string[] | undefined
  payload?: JsonObject | undefined
}

export type ResolvedActionProposal = Omit<ActionProposal, "id" | "effects"> & {
  id: string
  effects: string[]
}

export type ActionRecord = {
  id: string
  type: string
  status: ActionStatus
  principal: string
  created_at: string
  completed_at?: string | undefined
  data_class?: string | undefined
  capability?: string | undefined
  surface?: string | undefined
  schedule?: string | undefined
  hook?: string | undefined
  input_artifact_ids?: string[] | undefined
  output_artifact_ids?: string[] | undefined
  effects?: string[] | undefined
  policy?: ActionDecision | undefined
  digest?: ActionDigest | undefined
  payload?: JsonObject | undefined
  error?: string | undefined
}

export type ActionExecutionContext = {
  action_id: string
  digest: ActionDigest
  proposal: ResolvedActionProposal
  action: JsonObject
  capability?: JsonObject | undefined
}

export type ActionExecutionResult = {
  output_artifact_ids?: string[] | undefined
  payload?: JsonObject | undefined
}

export type ApprovalRequestStatus = "pending" | "granted" | "rejected" | "expired"

export type ApprovalDecisionStatus = "granted" | "rejected"

export type ApprovalRequest = {
  action_id: string
  action_type: string
  action_digest: ActionDigest
  effects: string[]
  input_artifact_ids: string[]
  approver_rule: JsonObject
  expires_at: string
  status: ApprovalRequestStatus
  capability?: string | undefined
}

export type ApprovalDecisionRecord = {
  id: string
  approval_request_id: string
  action_id: string
  action_digest: ActionDigest
  principal: string
  decision: ApprovalDecisionStatus
  decided_at: string
  expires_at: string
  capability?: string | undefined
  comment?: string | undefined
}

export type ActionGatewayEventName =
  | "action.requested"
  | "action.allowed"
  | "action.denied"
  | "action.approval_required"
  | "action.completed"

export type ActionGatewayEvent = {
  name: ActionGatewayEventName
  action_id: string
  action_type: string
  timestamp: string
  digest?: ActionDigest | undefined
  decision?: ActionDecision | undefined
}

export type ReadArtifactRequest = {
  artifact_id: ArtifactId
  version?: number | undefined
}

export type ReadArtifactResult<TArtifact = ArtifactMetadata> = {
  artifact: TArtifact
  body: JsonValue
}

export type WriteDraftArtifactMode = "iterate" | "replace"

export type WriteDraftArtifactRequest = {
  artifact_id?: ArtifactId | undefined
  type?: ArtifactType | undefined
  title?: string | undefined
  body: JsonValue
  tags?: string[] | undefined
  derived_from?: ArtifactId | undefined
  mode?: WriteDraftArtifactMode | undefined
}

export type WriteDraftArtifactResult<TArtifact = ArtifactRecord> = {
  artifact: TArtifact
}

export type RequestActionRequest = ActionProposal

export type RequestActionResult = {
  action: ActionRecord
  status: ActionStatus
  output_artifact_ids: ArtifactId[]
  approval_request_artifact_id?: ArtifactId | undefined
  approval_request?: ApprovalRequest | undefined
}

export type CheckActionStatusRequest = {
  action_id: string
}

export type CheckActionStatusResult = {
  action: ActionRecord
  approval_request?: ApprovalRequest | undefined
}

export type ArtifactPort<TReadArtifact = ArtifactMetadata, TWriteArtifact = ArtifactRecord> = {
  readArtifact(input: ReadArtifactRequest): Promise<ReadArtifactResult<TReadArtifact>>
  writeDraftArtifact(input: WriteDraftArtifactRequest): Promise<WriteDraftArtifactResult<TWriteArtifact>>
}

export type ActionGatewayPort = {
  requestAction(input: RequestActionRequest): Promise<RequestActionResult>
  checkActionStatus(input: CheckActionStatusRequest): Promise<CheckActionStatusResult>
}

export type AgenticPorts<TReadArtifact = ArtifactMetadata, TWriteArtifact = ArtifactRecord> =
  ArtifactPort<TReadArtifact, TWriteArtifact> & ActionGatewayPort

// ---------------------------------------------------------------------------
// Runtime package CLI types
//
// Core owns the runtime CLI front door and package seam. Runtime packages own
// harness/platform integration.
// ---------------------------------------------------------------------------

export type RuntimeTargetConfig = {
  package?: string | undefined
  config: Record<string, string>
}

export type RuntimeConfig = {
  default?: string | undefined
  targets: Record<string, RuntimeTargetConfig>
}

export type RuntimeCapability =
  | "init"
  | "run"
  | "approve"
  | "reject"
  | "status"
  | "dev"
  | "deploy"
  | "interactive"
  | "json-events"
  | "harness-sessions"

export type RuntimeCommandName =
  | "add"
  | "init"
  | "run"
  | "serve"
  | "approve"
  | "reject"
  | "status"

export type RuntimeCommandFlags = Record<string, string | true>

export type RuntimeInitArgs = {
  args: string[]
  flags: RuntimeCommandFlags
}

export type RuntimeRunArgs = {
  target?: string | undefined
  args: string[]
  flags: RuntimeCommandFlags
}

export type RuntimeApprovalDecisionArgs = {
  target?: string | undefined
  action_id: string
  principal: string
  comment?: string | undefined
  args: string[]
  flags: RuntimeCommandFlags
}

export type RuntimeStatusArgs = {
  args: string[]
  flags: RuntimeCommandFlags
}

export type RuntimeDevArgs = {
  args: string[]
  flags: RuntimeCommandFlags
}

export type RuntimeDeployArgs = {
  args: string[]
  flags: RuntimeCommandFlags
}

export type RuntimeCommandResult = {
  summary?: string | undefined
  data?: unknown
}

export type RuntimeInvocationStatus = "running" | "completed" | "failed"

export type RuntimeInvocationHarnessRef = {
  provider: string
  id: string
  uri?: string | undefined
}

export type RuntimeInvocation = {
  id: string
  runtime: string
  runtime_package: string
  target?: string | undefined
  workspace_root: string
  status: RuntimeInvocationStatus
  started_at: string
  ended_at?: string | undefined
  workflow_run_id?: string | undefined
  artifact_ids: string[]
  harness_ref?: RuntimeInvocationHarnessRef | undefined
  error?: string | undefined
}

export type RuntimeCommandHandler<TArgs> = (
  ctx: RuntimeContext,
  args: TArgs,
) => Promise<RuntimeCommandResult | void>

export type RuntimeCommandMap = {
  init?: RuntimeCommandHandler<RuntimeInitArgs> | undefined
  run?: RuntimeCommandHandler<RuntimeRunArgs> | undefined
  approve?: RuntimeCommandHandler<RuntimeApprovalDecisionArgs> | undefined
  reject?: RuntimeCommandHandler<RuntimeApprovalDecisionArgs> | undefined
  status?: RuntimeCommandHandler<RuntimeStatusArgs> | undefined
  dev?: RuntimeCommandHandler<RuntimeDevArgs> | undefined
  deploy?: RuntimeCommandHandler<RuntimeDeployArgs> | undefined
}

export type AgenticRuntimeBindings = {
  memory: MemoryAdapter
  workflows: WorkflowAdapter
  personas: PersonaAdapter
  skills: Source
  artifacts: ArtifactAdapter
}

export type RuntimeContext = {
  cwd: string
  workspace_root: string
  runtime_name: string
  runtime_package: string
  json: boolean
  env: Record<string, string | undefined>
  config: AgenticConfig
  runtime_config: Record<string, string>
  agentic: AgenticRuntimeBindings
}

export type AgenticRuntimePackage = {
  kind: "agentic-runtime"
  api_version: 1
  name: string
  package_name: string
  description?: string | undefined
  capabilities: RuntimeCapability[]
  commands: RuntimeCommandMap
}

export type RuntimeRefStatus =
  | "available"
  | "configured"
  | "installed"
  | "missing_package"
  | "invalid_manifest"

export type RuntimeRef = {
  name: string
  package_name: string
  description: string
  status: RuntimeRefStatus
  capabilities: RuntimeCapability[]
  install_command: string
  error?: string | undefined
}

export type RuntimeListOutput = {
  runtimes: RuntimeRef[]
  note: string
}

export type RuntimeCommandOutput = {
  command: RuntimeCommandName
  runtime: RuntimeRef
  target?: string | undefined
  status: "added" | "delegated" | "needs_package"
  message: string
  next_steps: string[]
  result?: RuntimeCommandResult | undefined
}

// ---------------------------------------------------------------------------
// Lifecycle event types
//
// Lifecycle events are semantic facts about primitive operations. Agentic owns
// the vocabulary and portable envelope; hosts own execution semantics: hooks,
// dispatch bridges, queues, persistence, retries, observability, and UI.
// ---------------------------------------------------------------------------

export type LifecyclePrimitive =
  | "artifact"
  | "persona"
  | "workflow"
  | "memory"
  | "capability"
  | "approval"

export type LifecycleEventName =
  | "artifact.created"
  | "artifact.written"
  | "artifact.finalized"
  | "persona.activated"
  | "workflow.transitioned"
  | "memory.remembered"
  | "capability.requested"
  | "capability.allowed"
  | "capability.denied"
  | "capability.completed"
  | "approval.requested"
  | "approval.granted"
  | "approval.rejected"
  | "approval.expired"

export const LIFECYCLE_EVENTS: readonly LifecycleEventName[] = [
  "artifact.created",
  "artifact.written",
  "artifact.finalized",
  "persona.activated",
  "workflow.transitioned",
  "memory.remembered",
  "capability.requested",
  "capability.allowed",
  "capability.denied",
  "capability.completed",
  "approval.requested",
  "approval.granted",
  "approval.rejected",
  "approval.expired",
] as const

export const LIFECYCLE_EVENT_PRIMITIVES: Readonly<Record<LifecycleEventName, LifecyclePrimitive>> = {
  "artifact.created": "artifact",
  "artifact.written": "artifact",
  "artifact.finalized": "artifact",
  "persona.activated": "persona",
  "workflow.transitioned": "workflow",
  "memory.remembered": "memory",
  "capability.requested": "capability",
  "capability.allowed": "capability",
  "capability.denied": "capability",
  "capability.completed": "capability",
  "approval.requested": "approval",
  "approval.granted": "approval",
  "approval.rejected": "approval",
  "approval.expired": "approval",
} as const

export type LifecycleEventRef = {
  name: LifecycleEventName
  id?: string | undefined
}

export type LifecycleEventSubject = {
  /** Primitive-owned subject kind, e.g. `artifact`, `persona`, `workflow_run`. */
  type: string
  /** Stable subject identifier when one exists, e.g. artifact id or run id. */
  id?: string | undefined
  /** Human-readable or catalog name when the subject is name-addressed. */
  name?: string | undefined
  /** Primitive version when relevant, e.g. artifact or graph version. */
  version?: string | number | undefined
}

export type LifecycleEvent<TName extends LifecycleEventName = LifecycleEventName> = {
  /** Optional host-assigned event id. Agentic does not require persistence. */
  id?: string | undefined
  name: TName
  primitive: (typeof LIFECYCLE_EVENT_PRIMITIVES)[TName]
  subject: LifecycleEventSubject
  timestamp: string
  /** Host/runtime correlation id for grouping related primitive events. */
  correlation_id?: string | undefined
  /** Related lifecycle events, e.g. a workflow transition that wrote an artifact. */
  related?: LifecycleEventRef[] | undefined
  /** Primitive-specific payload; hosts should keep provider internals out. */
  data?: Record<string, unknown> | undefined
}

// ---------------------------------------------------------------------------
// Artifact types
//
// An Artifact is a named, versioned piece of content produced by an agent
// turn — addressable, persistable, finalizable, and hookable. It is the
// standalone primitive that workflow node outputs (Transition.artifact) point
// at once they have been persisted.
//
// Lifecycle: created → written (iterate | replace) → finalized (read-only).
// Deletion is intentionally absent from the MVP; finalized artifacts are
// append-only history. Archive/drop can come later once use signals it.
// ---------------------------------------------------------------------------

/** ULID-shaped identifier for an artifact. */
export type ArtifactId = string

/** Domain/application-specific artifact kind, e.g. `case-packet`. */
export type ArtifactType = string

/**
 * Opaque reference to runtime-owned bytes attached to model-facing artifact
 * data. `ref` is storage-adapter text; core does not interpret schemes,
 * locations, signed URLs, or media-specific details.
 */
export type ArtifactAttachmentRef = {
  id: string
  role: string
  media_type: string
  ref: string
  name?: string | undefined
  size_bytes?: number | undefined
  sha256?: string | undefined
  metadata?: JsonObject | undefined
}

/** Small model-facing artifact data plus optional opaque attachment refs. */
export type ArtifactData = {
  [key: string]: JsonValue | ArtifactAttachmentRef[] | undefined
  attachments?: ArtifactAttachmentRef[] | undefined
}

export type ArtifactAttachmentDeclaration = {
  required?: boolean | undefined
  roles?: string[] | undefined
  media_types?: string[] | undefined
}

/** Authored artifact type declaration; runtime instances live elsewhere. */
export type ArtifactDeclaration = {
  id: ArtifactType
  kind?: string | undefined
  description?: string | undefined
  data_classes?: string[] | undefined
  statuses?: string[] | undefined
  required_fields?: string[] | undefined
  attachments?: ArtifactAttachmentDeclaration | undefined
  default_tags?: string[] | undefined
  metadata?: JsonObject | undefined
}

/**
 * The full persisted record for an artifact. `body_ref` is an
 * adapter-defined locator — a filesystem path, blob key, etc.
 */
export type ArtifactRecord = {
  id: ArtifactId
  type: ArtifactType         // aligns with NodeArtifactDef.type from workflow nodes
  title: string
  body_ref: string           // adapter-defined reference (FS path, blob key, etc.)
  version: number
  finalized: boolean
  tags: string[]
  created_at: string         // ISO 8601
  updated_at: string         // ISO 8601
  derived_from?: ArtifactId  // structural edge — derivation / versioning lineage
}

/**
 * Artifact metadata with computed fields. `pending_changes` is derived
 * and not stored; `size_bytes` is optional and adapter-provided.
 */
export type ArtifactMetadata = ArtifactRecord & {
  pending_changes: boolean
  size_bytes?: number | undefined
}

/** Lightweight artifact reference — id + type + title only. */
export type ArtifactRef = {
  id: ArtifactId
  type: ArtifactType
  title: string
  version: number
  finalized: boolean
  tags: string[]
  updated_at: string
}

/** Filter for listing artifacts. All fields are optional. */
export type ArtifactQuery = {
  type?: ArtifactType | undefined
  tags?: string[] | undefined
  finalized?: boolean | undefined
}

/**
 * Write mode for `artifact write`:
 * - `iterate` — bump version number, keep prior version accessible
 * - `replace` — overwrite current version in place (same version number)
 * - `create` — fail if an artifact with this id already exists
 */
export type ArtifactWriteMode = "iterate" | "replace" | "create"

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

/**
 * Result of firing a hook script. `ran: false` means no hook was found or it
 * was not executable — a non-error quiet no-op. `ran: true` with a non-zero
 * `exit_code` or an `error` string means the hook ran but failed; by design
 * this is a warning, not a fatal error — the primary verb still succeeds.
 *
 * See tnezdev/spores#26 for the design rationale and event catalog.
 */
export type HookInvocation = {
  event: string
  ran: boolean
  stdout: string
  stderr: string
  exit_code: number | null
  error?: string | undefined
}

/**
 * Output of `persona activate`: the rendered persona plus the result of any
 * `persona.activated` hook that fired. The hook's stdout is appended to the
 * human-formatted activation output; JSON mode serializes the whole wrapper.
 */
export type PersonaActivationOutput = {
  persona: Persona
  hook?: HookInvocation | undefined
}

/**
 * Output of `task add`: the created task plus the result of any `task.added`
 * hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type TaskAddedOutput = {
  task: Task
  hook?: HookInvocation | undefined
}

/**
 * Output of `task start`: the updated task (now in_progress) plus the result
 * of any `task.started` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type TaskStartedOutput = {
  task: Task
  hook?: HookInvocation | undefined
}

/**
 * Output of `task annotate`: the updated task plus the result of any
 * `task.annotated` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type TaskAnnotatedOutput = {
  task: Task
  hook?: HookInvocation | undefined
}

/**
 * Output of `skill run`: the invoked skill ref plus the result of any
 * `skill.invoked` hook that fired. Human mode outputs the raw skill content
 * (pipe-friendly); JSON mode serializes the wrapper.
 * Design + catalog: tnezdev/spores#26.
 */
export type SkillInvokedOutput = {
  skill: Skill
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory remember`: the stored memory plus the result of any
 * `memory.remembered` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryRememberedOutput = {
  memory: Memory
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory recall`: the recall results plus the result of any
 * `memory.recalled` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryRecalledOutput = {
  results: RecallResult[]
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory reinforce`: the updated memory plus the result of any
 * `memory.reinforced` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryReinforcedOutput = {
  memory: Memory
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory forget`: the forgotten key plus the result of any
 * `memory.forgotten` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryForgottenOutput = {
  key: string
  hook?: HookInvocation | undefined
}

/**
 * Output of `memory dream`: the consolidation result plus the result of any
 * `memory.dreamed` hook that fired. Design + catalog: tnezdev/spores#26.
 */
export type MemoryDreamedOutput = {
  result: DreamResult
  hook?: HookInvocation | undefined
}

/**
 * Output of `task done`: the updated task plus the result of any `task.done`
 * hook that fired. The hook's stdout is appended to the human-formatted output;
 * JSON mode serializes the whole wrapper. Design + catalog: tnezdev/spores#26.
 */
export type TaskDoneOutput = {
  task: Task
  hook?: HookInvocation | undefined
}

/**
 * Output of `workflow run <graph-id>` — the newly created run, plus the result
 * of any `workflow.run.started` hook that fired.
 * Design + catalog: tnezdev/spores#26.
 */
export type WorkflowRunStartedOutput = {
  run_id: string
  graph_id: string
  hook?: HookInvocation | undefined
}

/**
 * Output of `workflow done` / `workflow fail` when the transition causes a run
 * to reach a terminal state. Contains the final transition, the run outcome
 * ("completed" if all terminal nodes completed, "failed" if any failed), and
 * the result of any `workflow.run.terminated` hook that fired.
 * Design + catalog: tnezdev/spores#26.
 */
export type WorkflowRunTerminatedOutput = {
  run_id: string
  graph_id: string
  outcome: "completed" | "failed"
  hook?: HookInvocation | undefined
}

/**
 * Output emitted on every node status change — `workflow start`, `workflow done`,
 * `workflow fail`. Fires *after* the transition is persisted, before any
 * `workflow.run.terminated` check. Env vars passed to the hook:
 *   SPORES_RUN_ID, SPORES_GRAPH_ID, SPORES_NODE_ID,
 *   SPORES_FROM_STATUS, SPORES_TO_STATUS, SPORES_PASS
 * Design + catalog: tnezdev/spores#26.
 */
export type WorkflowRunTransitionedOutput = {
  run_id: string
  graph_id: string
  node_id: string
  from_status: NodeStatus
  to_status: NodeStatus
  pass: number
  hook?: HookInvocation | undefined
}

// ---------------------------------------------------------------------------
// Capability types
//
// A capability declaration is the host-facing execution contract around a
// skill or procedure. It names effects, connection requirements, approval
// policy, dispatch constraints, artifact reads/writes, and structured policy
// error vocabulary — without assuming a particular host runtime, provider,
// storage engine, or approval UI.
//
// See docs/capability-contracts.md for the design rationale and neutral
// examples. See tnezdev/spores#68–#75 for the implementation milestone.
// ---------------------------------------------------------------------------

/**
 * Portable names for side-effect classes produced by a capability.
 * Hosts may define narrower internal effects; portable declarations
 * should prefer these generic names.
 */
export type CapabilityEffect =
  | "memory.read"
  | "memory.write"
  | "artifact.read"
  | "artifact.write"
  | "external.read"
  | "external.write"
  | "approval.request"
  | "dispatch.send"
  | "user.notify"
  | "compute.privileged"

/** Readonly array of all defined capability effects. Useful for validation. */
export const CAPABILITY_EFFECTS: readonly CapabilityEffect[] = [
  "memory.read",
  "memory.write",
  "artifact.read",
  "artifact.write",
  "external.read",
  "external.write",
  "approval.request",
  "dispatch.send",
  "user.notify",
  "compute.privileged",
] as const

/**
 * Structured policy failure names returned by host runtimes.
 * The portable layer defines the vocabulary; hosts decide detection,
 * logging, display, and recovery.
 */
export type PolicyError =
  | "policy_denied"
  | "dispatch_not_allowed"
  | "tool_not_allowed"
  | "effect_not_allowed"
  | "missing_connection"
  | "approval_required"
  | "approval_rejected"
  | "provider_unauthorized"
  | "provider_unavailable"
  | "capability_misconfigured"

/** Readonly array of all defined policy error names. Useful for validation. */
export const POLICY_ERRORS: readonly PolicyError[] = [
  "policy_denied",
  "dispatch_not_allowed",
  "tool_not_allowed",
  "effect_not_allowed",
  "missing_connection",
  "approval_required",
  "approval_rejected",
  "provider_unauthorized",
  "provider_unavailable",
  "capability_misconfigured",
] as const

/**
 * Declares that a capability needs access to a user-owned or host-owned
 * external account. Does not define where credentials live or how
 * authorization happens — those are host responsibilities.
 */
export type ConnectionRequirement = {
  /** The provider kind, e.g. `"issue_tracker"`, `"calendar"`. */
  provider: string
  /** The scopes or permission strings the connection must carry. */
  capabilities: string[]
}

/** When human approval must be collected relative to the effect. */
export type ApprovalMode = "before_effect" | "after_effect"

/**
 * Declares which effects require human approval and when approval
 * must be collected. The host owns the approval store, notification
 * surface, and continuation behavior.
 */
export type ApprovalPolicy = {
  required_for: CapabilityEffect[]
  mode: ApprovalMode
}

/**
 * Execution policy for a capability: dispatch constraints, tool allowlist,
 * expected effects, and approval requirements. All fields are optional;
 * an absent field places no constraint on that dimension.
 */
export type CapabilityPolicy = {
  /**
   * Constrains which inbound dispatch contexts may invoke this capability.
   * Reuses `DispatchFilter` so the same vocabulary covers web, chat, voice,
   * scheduled jobs, agent-to-agent messages, and future host-defined sources.
   */
  dispatch?: DispatchFilter | undefined
  /** Tool names the host runtime may invoke on behalf of this capability. */
  tools?: string[] | undefined
  /** Side-effect classes this capability may produce. */
  effects?: CapabilityEffect[] | undefined
  /** Approval requirements for specific effects. */
  approval?: ApprovalPolicy | undefined
}

/**
 * Artifact read/write references for a capability. Values are artifact
 * kind names (strings matching `NodeArtifactDef.type` conventions).
 * The host owns storage layout, rendering, and revision history.
 */
export type CapabilityArtifacts = {
  reads?: string[] | undefined
  writes?: string[] | undefined
}

/**
 * A portable capability declaration — the host-facing execution contract
 * around a skill or procedure. This is not an executor; it is input to a
 * host runtime that enforces the policy, resolves connections, and manages
 * approvals.
 *
 * `name` uses dot-separated namespacing by convention: `<domain>.<verb>`,
 * e.g. `issue_tracker.create_issue`. `skill` optionally names a matching
 * SKILL.md in the host's skill catalog.
 */
export type CapabilityDef = {
  name: string
  description?: string | undefined
  /** Optional reference to a skill by name (e.g. `"issue-triage"`). */
  skill?: string | undefined
  requires?: {
    connections?: ConnectionRequirement[] | undefined
  } | undefined
  policy?: CapabilityPolicy | undefined
  artifacts?: CapabilityArtifacts | undefined
}

// ---------------------------------------------------------------------------
// Wake types
// ---------------------------------------------------------------------------

/**
 * Output of `spores wake` — everything an agent needs to self-orient at
 * session start. The identity content is the raw text of the configured
 * identity file. Personas are listed as refs so the agent can decide which
 * to activate. Design: tnezdev/spores#34.
 */
export type WakeOutput = {
  rendered: string // fully resolved template output
  template_path?: string | undefined // resolved path to the template file
  situational: SituationalContext
  hook?: HookInvocation | undefined
}

// ---------------------------------------------------------------------------
// Artifact output wrappers
// ---------------------------------------------------------------------------

/**
 * Output of `artifact create` — the newly created record plus any
 * `artifact.created` hook that fired.
 */
export type ArtifactCreatedOutput = {
  artifact: ArtifactRecord
  hook?: HookInvocation | undefined
}

/**
 * Output of `artifact write` — the updated record (new version if mode is
 * `iterate`) plus any `artifact.written` hook that fired.
 */
export type ArtifactWrittenOutput = {
  artifact: ArtifactRecord
  hook?: HookInvocation | undefined
}

/**
 * Output of `artifact edit` — the updated record plus any `artifact.edited`
 * hook that fired.
 */
export type ArtifactEditedOutput = {
  artifact: ArtifactRecord
  hook?: HookInvocation | undefined
}

/**
 * Output of `artifact finalize` — the finalized record plus any `artifact.finalized`
 * hook that fired.
 */
export type ArtifactFinalizedOutput = {
  artifact: ArtifactRecord
  hook?: HookInvocation | undefined
}

/**
 * Output of `artifact inspect` — the metadata record. No hook fires on
 * reads.
 */
export type ArtifactInspectedOutput = {
  artifact: ArtifactMetadata
}
