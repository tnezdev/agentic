import type {
  Memory,
  RecallResult,
  DreamResult,
  GraphDef,
  Run,
  NodeState,
  Transition,
  Skill,
  SkillRef,
  Task,
  Persona,
  PersonaActivationOutput,
  SkillInvokedOutput,
  MemoryRememberedOutput,
  MemoryRecalledOutput,
  MemoryReinforcedOutput,
  MemoryForgottenOutput,
  MemoryDreamedOutput,
  TaskAddedOutput,
  TaskStartedOutput,
  TaskAnnotatedOutput,
  TaskDoneOutput,
  WorkflowRunStartedOutput,
  WorkflowRunTerminatedOutput,
  WorkflowRunTransitionedOutput,
  PersonaFile,
  PersonaRef,
  WakeOutput,
  ArtifactRecord,
  ArtifactMetadata,
  ArtifactRef,
  ArtifactCreatedOutput,
  ArtifactWrittenOutput,
  ArtifactEditedOutput,
  ArtifactFinalizedOutput,
  ArtifactInspectedOutput,
  CapabilityDef,
  RuntimeCommandOutput,
  RuntimeListOutput,
  AgenticBundleSectionName,
  JsonObject,
} from "../types.js"


export function formatMemory(m: Memory): string {
  const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : ""
  const source = m.source !== undefined ? `\n  source: ${m.source}` : ""
  return [
    `${m.key} (${m.tier})${tags}`,
    `  ${m.content}`,
    `  weight=${m.weight} confidence=${m.confidence.toFixed(2)}${source}`,
    `  ${m.timestamp}`,
  ].join("\n")
}

export function formatRecallResults(results: RecallResult[]): string {
  if (results.length === 0) return "No memories found."
  return results
    .map(
      (r, i) =>
        `${i + 1}. [${r.score.toFixed(3)}] ${r.memory.key} (${r.memory.tier})\n   ${r.memory.content}`,
    )
    .join("\n\n")
}

export function formatDreamResult(r: DreamResult): string {
  const lines: string[] = []
  if (r.promoted.length > 0)
    lines.push(`Promoted: ${r.promoted.join(", ")}`)
  if (r.pruned.length > 0)
    lines.push(`Pruned: ${r.pruned.join(", ")}`)
  if (lines.length === 0) lines.push("No changes.")
  return lines.join("\n")
}

/** Human formatter for `memory remember` + hook. */
export function formatMemoryRemembered(result: MemoryRememberedOutput): string {
  const parts = [formatMemory(result.memory)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `memory recall` + hook. */
export function formatMemoryRecalled(result: MemoryRecalledOutput): string {
  const parts = [formatRecallResults(result.results)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `memory reinforce` + hook. */
export function formatMemoryReinforced(result: MemoryReinforcedOutput): string {
  const parts = [formatMemory(result.memory)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `memory forget` + hook. */
export function formatMemoryForgotten(result: MemoryForgottenOutput): string {
  const parts = [`Forgotten: ${result.key}`]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `memory dream` + hook. */
export function formatMemoryDreamed(result: MemoryDreamedOutput): string {
  const parts = [formatDreamResult(result.result)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// Workflow formatters
// ---------------------------------------------------------------------------

function trunc(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  )
  const sep = widths.map((w) => "-".repeat(w)).join("  ")
  const fmt = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ")
  return [fmt(headers), sep, ...rows.map(fmt)].join("\n")
}

export function formatGraphs(graphs: GraphDef[]): string {
  if (graphs.length === 0) return "No graphs registered."
  return table(
    ["ID", "NAME", "VERSION", "NODES"],
    graphs.map((g) => [g.id, g.name, g.version, String(g.nodes.length)]),
  )
}

export function formatRuns(runs: Run[]): string {
  if (runs.length === 0) return "No runs."
  return table(
    ["RUN", "GRAPH", "NAME", "CREATED"],
    runs.map((r) => [r.run_id, r.graph_id, r.name ?? "", r.created_at]),
  )
}

export function formatStatus(
  states: Record<string, NodeState>,
  graph: GraphDef,
): string {
  const rows: string[][] = []
  for (const node of graph.nodes) {
    const s = states[node.id]
    if (!s) continue
    rows.push([s.node_id, s.status, String(s.pass), s.artifact?.type ?? "-"])
  }
  return table(["NODE", "STATUS", "PASS", "ARTIFACT"], rows)
}

export function formatNext(nodeIds: string[]): string {
  if (nodeIds.length === 0) return "No available nodes."
  return nodeIds.join("\n")
}

export function formatTransition(t: Transition): string {
  const parts = [
    `${t.node_id}: ${t.from_status} → ${t.to_status}`,
    `pass=${t.pass}`,
    `by=${t.identity}`,
    `at=${t.timestamp}`,
  ]
  if (t.reason) parts.push(`reason=${t.reason}`)
  if (t.artifact) parts.push(`artifact=${t.artifact.type}`)
  return parts.join("  ")
}

export function formatHistory(transitions: Transition[]): string {
  if (transitions.length === 0) return "No history."
  return transitions.map(formatTransition).join("\n")
}

// ---------------------------------------------------------------------------
// Skill formatters
// ---------------------------------------------------------------------------

export function formatSkillRefs(refs: SkillRef[], wide = false): string {
  if (refs.length === 0) return "No skills found."
  return table(
    ["NAME", "DESCRIPTION", "TAGS"],
    refs.map((r) => [r.name, wide ? r.description : trunc(r.description), r.tags.join(", ")]),
  )
}

export function formatSkill(skill: Skill): string {
  const tags = skill.tags.length > 0 ? `\ntags: ${skill.tags.join(", ")}` : ""
  return [`${skill.name}`, `  ${skill.description}${tags}`, "", skill.content].join(
    "\n",
  )
}

/**
 * Human formatter for `skill run`: the raw skill content (pipe-friendly to LLM).
 * Hook stdout is omitted from human mode to preserve the pipe contract; it is
 * included in the JSON wrapper. Design + catalog: tnezdev/spores#26.
 */
export function formatSkillInvoked(result: SkillInvokedOutput): string {
  return result.skill.content
}

// ---------------------------------------------------------------------------
// Task formatters
// ---------------------------------------------------------------------------

export function formatTasks(tasks: Task[], wide = false): string {
  if (tasks.length === 0) return "No tasks."
  return table(
    ["ID", "STATUS", "TAGS", "DESCRIPTION"],
    tasks.map((t) => [
      t.id,
      t.status,
      t.tags.join(","),
      wide ? t.description : trunc(t.description),
    ]),
  )
}

export function formatTask(task: Task): string {
  const lines: string[] = []
  lines.push(`${task.id}  (${task.status})`)
  lines.push(`  ${task.description}`)
  if (task.tags.length > 0) lines.push(`  tags: ${task.tags.join(", ")}`)
  if (task.parent_id !== undefined) lines.push(`  parent: ${task.parent_id}`)
  if (task.workflow_run_id !== undefined)
    lines.push(`  workflow_run: ${task.workflow_run_id}`)
  if (task.wait_until !== undefined)
    lines.push(`  wait_until: ${task.wait_until}`)
  lines.push(`  created: ${task.created_at}`)
  lines.push(`  updated: ${task.updated_at}`)
  if (task.annotations.length > 0) {
    lines.push("  annotations:")
    for (const a of task.annotations) {
      lines.push(`    - [${a.timestamp}] ${a.text}`)
    }
  }
  return lines.join("\n")
}

export function formatNextTask(task: Task | null): string {
  if (task === null) return "No ready tasks."
  const tags = task.tags.length > 0 ? ` [${task.tags.join(", ")}]` : ""
  return `${task.id}  ${task.description}${tags}`
}

/** Human formatter for `task add` — task details + hook stdout if any ran. */
export function formatTaskAdded(result: TaskAddedOutput): string {
  const parts = [formatTask(result.task)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `task start` — task details + hook stdout if any ran. */
export function formatTaskStarted(result: TaskStartedOutput): string {
  const parts = [formatTask(result.task)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `task annotate` — task details + hook stdout if any ran. */
export function formatTaskAnnotated(result: TaskAnnotatedOutput): string {
  const parts = [formatTask(result.task)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/**
 * Human formatter for `task done`: the task details followed by the stdout of
 * a `task.done` hook if one ran and produced output. JSON mode serializes the
 * whole wrapper structurally.
 */
export function formatTaskDone(result: TaskDoneOutput): string {
  const parts = [formatTask(result.task)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

export function formatWorkflowRunStarted(
  result: WorkflowRunStartedOutput,
): string {
  const parts = [`Run ${result.run_id} started (graph: ${result.graph_id})`]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

export function formatWorkflowRunTerminated(
  result: WorkflowRunTerminatedOutput,
): string {
  const parts = [
    `Run ${result.run_id} terminated (graph: ${result.graph_id}, outcome: ${result.outcome})`,
  ]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

export function formatWorkflowRunTransitioned(
  result: WorkflowRunTransitionedOutput,
): string {
  const parts = [
    `Transition: ${result.node_id} ${result.from_status} → ${result.to_status} (pass ${result.pass})`,
  ]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// Persona formatters
// ---------------------------------------------------------------------------

export function formatPersonaRefs(refs: PersonaRef[], wide = false): string {
  if (refs.length === 0) return "No personas found."
  return table(
    ["NAME", "DESCRIPTION"],
    refs.map((r) => [r.name, wide ? r.description : trunc(r.description)]),
  )
}

function formatMeta(ref: PersonaRef): string {
  const lines: string[] = []
  if (ref.memory_tags.length > 0)
    lines.push(`memory_tags: ${ref.memory_tags.join(", ")}`)
  if (ref.skills.length > 0) lines.push(`skills: ${ref.skills.join(", ")}`)
  if (ref.task_filter !== undefined)
    lines.push(`task_filter: ${JSON.stringify(ref.task_filter)}`)
  if (ref.workflow !== undefined) lines.push(`workflow: ${ref.workflow}`)
  if (ref.effort !== undefined) lines.push(`effort: ${ref.effort}`)
  if (ref.reasoning !== undefined) lines.push(`reasoning: ${ref.reasoning}`)
  return lines.join("\n")
}

export function formatPersonaFile(file: PersonaFile): string {
  return [
    file.name,
    `  ${file.description}`,
    formatMeta(file),
    "",
    file.body,
  ]
    .filter((s) => s !== "")
    .join("\n")
}

export function formatPersona(persona: Persona): string {
  // Activated output is meant to be piped into an LLM — the body is the
  // payload. Emit the body only, not the metadata header.
  return persona.body
}

/**
 * Human formatter for `persona activate`: the rendered body followed by the
 * stdout of a `persona.activated` hook if one ran and produced output. JSON
 * mode serializes the whole wrapper structurally; this formatter only runs
 * in human mode (see `output()` in src/cli/output.ts).
 */
export function formatPersonaActivation(
  result: PersonaActivationOutput,
): string {
  const parts = [formatPersona(result.persona)]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// Wake formatters
// ---------------------------------------------------------------------------

/**
 * Human formatter for `spores wake`. The rendered template IS the output —
 * the template author controls the structure. Hook stdout is appended if
 * present. Design: tnezdev/spores#34.
 */
export function formatWake(result: WakeOutput): string {
  const parts = [result.rendered]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// Artifact formatters
// ---------------------------------------------------------------------------

export function formatArtifactRecord(r: ArtifactRecord): string {
  const tags = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : ""
  const finalized = r.finalized ? " (finalized)" : ""
  const derived = r.derived_from !== undefined ? `\n  derived_from: ${r.derived_from}` : ""
  return [
    `${r.id}${finalized}`,
    `  type:    ${r.type}`,
    `  title:   ${r.title}${tags}`,
    `  version: ${r.version}`,
    `  updated: ${r.updated_at}${derived}`,
  ].join("\n")
}

export function formatArtifactMetadata(m: ArtifactMetadata): string {
  const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : ""
  const finalized = m.finalized ? " (finalized)" : ""
  const size =
    m.size_bytes !== undefined ? `\n  size:    ${m.size_bytes} bytes` : ""
  const derived = m.derived_from !== undefined ? `\n  derived_from: ${m.derived_from}` : ""
  return [
    `${m.id}${finalized}`,
    `  type:     ${m.type}`,
    `  title:    ${m.title}${tags}`,
    `  version:  ${m.version}`,
    `  body_ref: ${m.body_ref}`,
    `  created:  ${m.created_at}`,
    `  updated:  ${m.updated_at}${size}${derived}`,
  ].join("\n")
}

/** Human formatter for `artifact create`. */
export function formatArtifactCreated(result: ArtifactCreatedOutput): string {
  const parts = [`Artifact created:\n${formatArtifactRecord(result.artifact)}`]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `artifact write`. */
export function formatArtifactWritten(result: ArtifactWrittenOutput): string {
  const parts = [`Artifact written:\n${formatArtifactRecord(result.artifact)}`]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `artifact edit`. */
export function formatArtifactEdited(result: ArtifactEditedOutput): string {
  const parts = [`Artifact edited:\n${formatArtifactRecord(result.artifact)}`]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `artifact finalize`. */
export function formatArtifactFinalized(result: ArtifactFinalizedOutput): string {
  const parts = [`Artifact finalized:\n${formatArtifactRecord(result.artifact)}`]
  const hook = result.hook
  if (hook !== undefined && hook.ran && hook.stdout.trim().length > 0) {
    parts.push("\n---\n")
    parts.push(hook.stdout.trimEnd())
  }
  return parts.join("\n")
}

/** Human formatter for `artifact inspect`. */
export function formatArtifactInspected(result: ArtifactInspectedOutput): string {
  return formatArtifactMetadata(result.artifact)
}

/** Human formatter for `artifact list`. */
export function formatArtifactList(refs: ArtifactRef[]): string {
  if (refs.length === 0) return "No artifacts found."
  return table(
    ["ID", "TYPE", "TITLE", "VER", "FINALIZED"],
    refs.map((r) => [
      r.id,
      r.type,
      r.title,
      String(r.version),
      r.finalized ? "yes" : "no",
    ]),
  )
}

// ---------------------------------------------------------------------------
// Capability formatters
// ---------------------------------------------------------------------------

/**
 * Structured result from `capability validate`. Defined here (not in
 * capability.ts) to avoid a circular import: the formatter must reference
 * this type and capability.ts imports from format.ts.
 */
export type CapabilityValidateResult =
  | { subject: string; valid: true; capability: CapabilityDef }
  | { subject: string; valid: false; errors: { field: string; message: string }[] }

/** Human formatter for `capability list`. */
export function formatCapabilityDefs(defs: CapabilityDef[], wide = false): string {
  if (defs.length === 0) return "No capabilities found."
  return table(
    ["NAME", "DESCRIPTION", "EFFECTS"],
    defs.map((d) => {
      const effects = d.policy?.effects?.join(", ") ?? ""
      const desc = d.description ?? ""
      return [d.name, wide ? desc : trunc(desc), effects]
    }),
  )
}

/** Human formatter for `capability show`. */
export function formatCapabilityDef(def: CapabilityDef): string {
  const lines: string[] = []
  lines.push(def.name)
  if (def.description !== undefined) lines.push(`  ${def.description}`)
  if (def.skill !== undefined) lines.push(`  skill: ${def.skill}`)
  const conns = def.requires?.connections
  if (conns !== undefined && conns.length > 0) {
    lines.push("  requires:")
    lines.push("    connections:")
    for (const c of conns) {
      lines.push(`      - provider: ${c.provider}  capabilities: ${c.capabilities.join(", ")}`)
    }
  }
  const policy = def.policy
  if (policy !== undefined) {
    lines.push("  policy:")
    if (policy.effects !== undefined && policy.effects.length > 0) {
      lines.push(`    effects: ${policy.effects.join(", ")}`)
    }
    if (policy.tools !== undefined && policy.tools.length > 0) {
      lines.push(`    tools: ${policy.tools.join(", ")}`)
    }
    if (policy.approval !== undefined) {
      lines.push(`    approval:`)
      lines.push(`      mode: ${policy.approval.mode}`)
      lines.push(`      required_for: ${policy.approval.required_for.join(", ")}`)
    }
    if (policy.dispatch !== undefined) {
      lines.push(`    dispatch: ${JSON.stringify(policy.dispatch)}`)
    }
  }
  const artifacts = def.artifacts
  if (artifacts !== undefined) {
    lines.push("  artifacts:")
    if (artifacts.reads !== undefined && artifacts.reads.length > 0) {
      lines.push(`    reads: ${artifacts.reads.join(", ")}`)
    }
    if (artifacts.writes !== undefined && artifacts.writes.length > 0) {
      lines.push(`    writes: ${artifacts.writes.join(", ")}`)
    }
  }
  return lines.join("\n")
}

/** Human formatter for `capability validate`. */
export function formatCapabilityValidate(result: CapabilityValidateResult): string {
  if (result.valid) {
    return `${result.subject}: valid`
  }
  const errorLines = result.errors.map((e) => `  ${e.field}: ${e.message}`)
  return [`${result.subject}: invalid`, ...errorLines].join("\n")
}

// ---------------------------------------------------------------------------
// Lifecycle formatters
// ---------------------------------------------------------------------------

export type AgenticValidateError = {
  field: string
  message: string
}

export type AgenticValidateCheck = {
  name: "manifest" | "bundle_refs" | "artifacts" | "action_gateway" | "triggers" | "evals"
  status: "passed" | "failed"
  count?: number | undefined
  actions?: number | undefined
  capabilities?: number | undefined
  surfaces?: number | undefined
  schedules?: number | undefined
  hooks?: number | undefined
}

export type AgenticValidateResult = {
  command: "validate"
  valid: boolean
  root: string
  manifest_path: string | null
  bundle: {
    name: string
    version: string
    schema_version: string
  } | null
  checks: AgenticValidateCheck[]
  errors: AgenticValidateError[]
  warnings: AgenticValidateError[]
}

export type AgenticInspectMessage = {
  field: string
  message: string
}

export type AgenticInspectInventoryEntry = {
  id: string
  path: string
  locator: string
  bytes?: number | undefined
}

export type AgenticInspectInventorySection = {
  name: AgenticBundleSectionName
  kind: "markdown" | "data"
  count: number
  entries: AgenticInspectInventoryEntry[]
}

export type AgenticInspectRunState = {
  id: string
  path: string
  summary_path: string | null
  action_log_path: string | null
  actions: {
    count: number
    completed: number
    denied: number
    approval_required: number
  }
  artifacts: {
    count: number
    approval_requests: number
  }
}

export type AgenticInspectState = {
  adapter: string
  dir: string
  exists: boolean
  latest: JsonObject | null
  runs: {
    count: number
    entries: AgenticInspectRunState[]
  }
  totals: {
    actions: number
    completed_actions: number
    denied_actions: number
    approval_required_actions: number
    artifacts: number
    approval_request_artifacts: number
  }
}

export type AgenticInspectResult = {
  command: "inspect"
  ok: boolean
  root: string
  manifest_path: string | null
  bundle: {
    name: string
    version: string
    schema_version: string
    description: string
  } | null
  inventory: {
    sections: AgenticInspectInventorySection[]
    totals: {
      sections: number
      entries: number
      markdown_entries: number
      data_entries: number
    }
  } | null
  state: AgenticInspectState | null
  errors: AgenticInspectMessage[]
  warnings: AgenticInspectMessage[]
}

export type AgenticEvalMessage = {
  field: string
  message: string
}

export type AgenticEvalCheck = {
  name: "artifacts" | "actions" | "approval_required" | "external_write_executed"
  ok: boolean
  expected: string[] | string | boolean
  actual: string[] | string | boolean | null
  missing?: string[] | undefined
}

export type AgenticEvalCaseResult = {
  id: string
  ok: boolean
  fixture: string | null
  checks: AgenticEvalCheck[]
  errors: AgenticEvalMessage[]
}

export type AgenticEvalResult = {
  command: "eval"
  ok: boolean
  root: string
  manifest_path: string | null
  bundle: {
    name: string
    version: string
    schema_version: string
  } | null
  state: {
    adapter: string
    dir: string
    run_id: string
    run_path: string
  } | null
  evals: AgenticEvalCaseResult[]
  errors: AgenticEvalMessage[]
  warnings: AgenticEvalMessage[]
}

export function formatAgenticValidate(result: AgenticValidateResult): string {
  const subject = result.bundle === null
    ? result.root
    : `${result.bundle.name}@${result.bundle.version}`
  const lines = [`${subject}: ${result.valid ? "valid" : "invalid"}`, `root: ${result.root}`]

  if (result.valid) {
    lines.push("checks:")
    lines.push(...result.checks.map((check) => `  - ${formatAgenticValidateCheck(check)}`))
  } else {
    lines.push("errors:")
    if (result.errors.length === 0) {
      lines.push("  - unknown validation failure")
    } else {
      lines.push(...result.errors.map((error) => `  - ${error.field}: ${error.message}`))
    }
  }

  return lines.join("\n")
}

export function formatAgenticInspect(result: AgenticInspectResult): string {
  const subject = result.bundle === null
    ? result.root
    : `${result.bundle.name}@${result.bundle.version}`
  const lines = [`${subject}${result.ok ? "" : ": inspect failed"}`, `root: ${result.root}`]

  if (result.manifest_path !== null) lines.push(`manifest: ${result.manifest_path}`)

  if (result.inventory !== null) {
    lines.push("inventory:")
    lines.push(...result.inventory.sections.map((section) => `  - ${formatAgenticInspectSection(section)}`))
  }

  if (result.state !== null) {
    lines.push("state:")
    lines.push(`  adapter: ${result.state.adapter}`)
    lines.push(`  dir: ${result.state.dir}`)
    lines.push(`  exists: ${result.state.exists ? "yes" : "no"}`)
    if (result.state.exists) {
      const latestRun = result.state.latest?.run_id
      if (typeof latestRun === "string") lines.push(`  latest_run: ${latestRun}`)
      lines.push(`  runs: ${result.state.runs.count}`)
      lines.push(
        `  actions: ${result.state.totals.actions} (completed ${result.state.totals.completed_actions}, approval_required ${result.state.totals.approval_required_actions}, denied ${result.state.totals.denied_actions})`,
      )
      lines.push(
        `  artifacts: ${result.state.totals.artifacts} (approval_request ${result.state.totals.approval_request_artifacts})`,
      )
    }
  }

  if (result.warnings.length > 0) {
    lines.push("warnings:")
    lines.push(...formatAgenticInspectMessages(result.warnings))
  }

  if (!result.ok) {
    lines.push("errors:")
    if (result.errors.length === 0) {
      lines.push("  - unknown inspection failure")
    } else {
      lines.push(...formatAgenticInspectMessages(result.errors))
    }
  }

  return lines.join("\n")
}

export function formatAgenticEval(result: AgenticEvalResult): string {
  const subject = result.bundle === null
    ? result.root
    : `${result.bundle.name}@${result.bundle.version}`
  const lines = [`${subject}: eval ${result.ok ? "passed" : "failed"}`, `root: ${result.root}`]

  if (result.state !== null) lines.push(`run: ${result.state.run_id}`)

  if (result.evals.length > 0) {
    lines.push("evals:")
    lines.push(...result.evals.map((entry) => `  - ${formatAgenticEvalCase(entry)}`))
  }

  if (result.ok) {
    const checks = result.evals.flatMap((entry) => entry.checks.map((check) => formatAgenticEvalCheck(check)))
    if (checks.length > 0) {
      lines.push("checks:")
      lines.push(...checks.map((line) => `  - ${line}`))
    }
  }

  const errors = result.errors.concat(result.evals.flatMap((entry) => entry.errors))
  if (errors.length > 0) {
    lines.push("errors:")
    lines.push(...errors.map((error) => `  - ${error.field}: ${error.message}`))
  }

  if (result.warnings.length > 0) {
    lines.push("warnings:")
    lines.push(...result.warnings.map((warning) => `  - ${warning.field}: ${warning.message}`))
  }

  return lines.join("\n")
}

function formatAgenticInspectSection(section: AgenticInspectInventorySection): string {
  const ids = formatAgenticInspectIds(section.entries.map((entry) => entry.id))
  return ids === "" ? `${section.name}: ${section.count}` : `${section.name}: ${section.count} (${ids})`
}

function formatAgenticInspectIds(ids: string[]): string {
  if (ids.length === 0) return ""
  const shown = ids.slice(0, 8)
  const remaining = ids.length - shown.length
  return remaining === 0 ? shown.join(", ") : `${shown.join(", ")}, ... +${remaining} more`
}

function formatAgenticInspectMessages(messages: AgenticInspectMessage[]): string[] {
  return messages.map((message) => `  - ${message.field}: ${message.message}`)
}

function formatAgenticValidateCheck(check: AgenticValidateCheck): string {
  const label = check.name.replace(/_/g, " ")
  if ((check.name === "artifacts" || check.name === "evals") && check.count !== undefined) {
    return `${label}: ${check.status} (${check.count})`
  }
  if (check.name === "action_gateway") {
    return `${label}: ${check.status} (${check.actions ?? 0} actions, ${check.capabilities ?? 0} capabilities)`
  }
  if (check.name === "triggers") {
    return `${label}: ${check.status} (${check.surfaces ?? 0} ${plural("surface", check.surfaces ?? 0)}, ${check.schedules ?? 0} ${plural("schedule", check.schedules ?? 0)}, ${check.hooks ?? 0} ${plural("hook", check.hooks ?? 0)})`
  }
  return `${label}: ${check.status}`
}

function formatAgenticEvalCase(entry: AgenticEvalCaseResult): string {
  const passed = entry.checks.filter((check) => check.ok).length
  const failed = entry.checks.length - passed
  if (entry.ok) return `${entry.id}: passed (${entry.checks.length} ${plural("check", entry.checks.length)})`
  if (entry.checks.length === 0) return `${entry.id}: failed`
  return `${entry.id}: failed (${passed} passed, ${failed} failed)`
}

function formatAgenticEvalCheck(check: AgenticEvalCheck): string {
  const label = check.name.replace(/_/g, " ")
  const status = check.ok ? "passed" : "failed"
  if (Array.isArray(check.expected) && Array.isArray(check.actual)) {
    return `${label}: ${status} (${check.expected.length} expected, ${check.actual.length} found)`
  }
  return `${label}: ${status} (${String(check.expected)})`
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`
}

// ---------------------------------------------------------------------------
// Runtime formatters
// ---------------------------------------------------------------------------

export function formatRuntimeHelp(help: string): string {
  return help
}

export function formatRuntimeList(result: RuntimeListOutput): string {
  const rows = result.runtimes.map((runtime) => [
    runtime.name,
    runtime.package_name,
    runtime.status,
    runtime.capabilities.join(", "),
  ])
  const body =
    rows.length === 0
      ? "No runtime targets known."
      : table(["NAME", "PACKAGE", "STATUS", "CAPABILITIES"], rows)
  return [body, "", result.note].join("\n")
}

export function formatRuntimeAction(result: RuntimeCommandOutput): string {
  const lines = [
    `${result.runtime.name}: ${result.status}`,
    result.message,
    ...(result.target !== undefined ? [`target: ${result.target}`] : []),
  ]
  if (result.result?.data !== undefined) {
    lines.push(JSON.stringify(result.result.data, null, 2))
  }
  if (result.next_steps.length > 0) {
    lines.push("next steps:")
    lines.push(...result.next_steps.map((step) => `  - ${step}`))
  }
  return lines.join("\n")
}
