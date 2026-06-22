import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"

type JsonObject = Record<string, unknown>

type ExtensionAPI = {
  registerTool(definition: JsonObject): void
  on(event: string, handler: (...args: any[]) => unknown): void
}

type RunState = {
  root: string
  runId: string
  runDir: string
  actionDir: string
  artifactDir: string
  actionLogPath: string
  summaryPath: string
  latestPath: string
  sequence: number
  actions: ActionRecord[]
  artifacts: ArtifactRecord[]
}

type ActionRecord = {
  id: string
  type: string
  status: "completed" | "denied" | "approval_required" | "failed"
  principal: string
  created_at: string
  completed_at?: string
  data_class?: string
  capability?: string
  input_artifact_ids?: string[]
  output_artifact_ids?: string[]
  effects?: string[]
  policy?: JsonObject
  digest?: string
  payload?: JsonObject
  error?: string
}

type ArtifactRecord = {
  id: string
  type: string
  title: string
  status: string
  version: number
  finalized: boolean
  data_class: string
  tags: string[]
  body: JsonObject
  derived_from?: string[]
  created_by_action_id: string
  created_at: string
}

const Schema = {
  object(properties: JsonObject, required: string[] = []): JsonObject {
    return { type: "object", properties, required, additionalProperties: false }
  },
  string(description?: string): JsonObject {
    return description === undefined ? { type: "string" } : { type: "string", description }
  },
  number(description?: string): JsonObject {
    return description === undefined ? { type: "number" } : { type: "number", description }
  },
  array(items: JsonObject): JsonObject {
    return { type: "array", items }
  },
  any(description?: string): JsonObject {
    return description === undefined ? {} : { description }
  },
}

const runs = new Map<string, RunState>()

const toolNames = [
  "agentic_bundle_context",
  "agentic_shell_exec",
  "agentic_artifact_write",
  "agentic_action_request",
]

const mutationPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgit\s+(tag|push|commit|merge|rebase|reset|clean|add|restore|checkout|switch|stash)\b/i, reason: "git mutation requires an approval-gated action" },
  { pattern: /\bgh\s+(pr|issue|release)\s+(create|edit|close|delete|merge|reopen|lock|unlock)\b/i, reason: "GitHub mutation requires an approval-gated action" },
  { pattern: /\bnpm\s+publish\b|\bbun\s+publish\b/i, reason: "package publishing is host-owned and approval-gated" },
  { pattern: /\b(rm|mv|cp|chmod|chown|mkdir|touch)\b/i, reason: "filesystem mutation is not available through release-readiness shell.exec" },
  { pattern: /(^|\s)(>|>>)|\btee\b|\bapply_patch\b/i, reason: "shell redirection or patching would bypass artifact/action tools" },
  { pattern: /\bcurl\b.*\b(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i, reason: "external write requests require an approval-gated action" },
]

export default function agenticTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "agentic_bundle_context",
    label: "Agentic Bundle Context",
    description: "Read the repo-local Agentic bundle declarations needed for an agent-first project-stewardship turn.",
    promptSnippet: "Load Agentic bundle declarations and the current Pi/tool contract.",
    promptGuidelines: [
      "Use agentic_bundle_context before assessing release readiness so the report is grounded in bundle declarations.",
    ],
    parameters: Schema.object({
      focus: Schema.string("Optional focus such as release-readiness."),
    }),
    execute: async (_toolCallId: string, params: JsonObject, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) => {
      const run = await ensureRun(ctx.cwd)
      const files = [
        ".agentic/agentic.yaml",
        ".agentic/AGENTS.md",
        ".agentic/bundle/prompts/project-steward-startup.md",
        ".agentic/bundle/prompts/release-readiness-agent.md",
        ".agentic/bundle/skills/release-readiness/SKILL.md",
        ".agentic/bundle/actions/release.assess.yaml",
        ".agentic/bundle/actions/release.cut.yaml",
        ".agentic/bundle/capabilities/release.assess.yaml",
        ".agentic/bundle/capabilities/release.cut.yaml",
        ".agentic/bundle/deploy/local-dogfood.yaml",
      ]
      const sections: string[] = []
      for (const file of files) {
        try {
          sections.push(`## ${file}\n\n${await readFile(join(run.root, file), "utf-8")}`)
        } catch (error) {
          sections.push(`## ${file}\n\nUnavailable: ${errorMessage(error)}`)
        }
      }

      const action = await recordAction(run, {
        type: "tool.bundle_context",
        status: "completed",
        effects: ["filesystem.read"],
        payload: { tool: "agentic_bundle_context", focus: optionalString(params.focus) ?? null },
      })

      return {
        content: [{ type: "text", text: sections.join("\n\n---\n\n") }],
        details: { action_id: action.id, files },
      }
    },
  })

  pi.registerTool({
    name: "agentic_shell_exec",
    label: "Agentic shell.exec",
    description: "Run a constrained release-readiness shell command through Agentic policy and audit recording.",
    promptSnippet: "Run bounded read/check commands in the repo through Agentic policy and audit.",
    promptGuidelines: [
      "Use agentic_shell_exec instead of raw bash for release-readiness inspection.",
      "Do not use agentic_shell_exec for tag, push, publish, GitHub mutation, or file mutation commands.",
    ],
    parameters: Schema.object({
      command: Schema.string("Shell command to run from the repository root."),
      purpose: Schema.string("Why this command is needed for the report."),
      timeout_ms: Schema.number("Timeout in milliseconds, maximum 600000."),
    }, ["command"]),
    execute: async (_toolCallId: string, params: JsonObject, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) => {
      const run = await ensureRun(ctx.cwd)
      const command = requiredString(params.command, "command").trim()
      const purpose = optionalString(params.purpose)
      const policy = classifyCommand(command)
      if (policy.decision !== "allow") {
        const action = await recordAction(run, {
          type: "tool.shell_exec",
          status: "approval_required",
          effects: policy.effects,
          policy: {
            decision: "approval_required",
            code: "approval_required",
            reason: policy.reason,
          },
          payload: { command, purpose: purpose ?? null },
        })
        return {
          content: [{ type: "text", text: `Denied before execution: ${policy.reason}` }],
          details: { action_id: action.id, status: action.status, policy },
          isError: true,
        }
      }

      const result = await runShell(command, run.root, clampTimeout(optionalNumber(params.timeout_ms)), signal)
      const status = result.exit_code === 0 ? "completed" : "failed"
      const action = await recordAction(run, {
        type: "tool.shell_exec",
        status,
        effects: policy.effects,
        policy: {
          decision: "allow",
          code: "allowed",
          reason: policy.reason,
        },
        payload: {
          command,
          purpose: purpose ?? null,
          exit_code: result.exit_code,
        },
        ...(result.exit_code === 0 ? {} : { error: result.stderr || result.stdout || `exit ${result.exit_code}` }),
      })

      return {
        content: [{
          type: "text",
          text: [
            `action_id: ${action.id}`,
            `exit_code: ${result.exit_code}`,
            "stdout:",
            result.stdout || "(empty)",
            "stderr:",
            result.stderr || "(empty)",
          ].join("\n"),
        }],
        details: { action_id: action.id, ...result, policy },
        isError: result.exit_code !== 0,
      }
    },
  })

  pi.registerTool({
    name: "agentic_artifact_write",
    label: "Agentic artifact.write",
    description: "Persist an Agentic bundle-runtime artifact in the repo-local .agentic state directory.",
    promptSnippet: "Write declared Agentic artifacts into .agentic/.data runtime state.",
    promptGuidelines: [
      "Use agentic_artifact_write for reusable outputs such as release-readiness-report instead of leaving them only in the transcript.",
    ],
    parameters: Schema.object({
      type: Schema.string("Declared artifact type, e.g. release-readiness-report."),
      title: Schema.string("Human-readable artifact title."),
      status: Schema.string("Artifact status, e.g. blocked, needs_checks, ready_to_cut."),
      data_class: Schema.string("Data class, usually project_public_state."),
      tags: Schema.array(Schema.string()),
      body: Schema.any("JSON-compatible artifact body."),
    }, ["type", "title", "body"]),
    execute: async (_toolCallId: string, params: JsonObject, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) => {
      const run = await ensureRun(ctx.cwd)
      const body = jsonObject(params.body)
      const artifactType = requiredString(params.type, "type")
      const artifact = await writeArtifact(run, {
        type: artifactType,
        title: requiredString(params.title, "title"),
        status: optionalString(params.status) ?? "draft",
        data_class: optionalString(params.data_class) ?? "project_public_state",
        tags: stringArray(params.tags),
        body,
        created_by_action_id: "pending",
      })
      const action = await recordAction(run, {
        type: "artifact.write",
        status: "completed",
        effects: [`artifact.write:${artifactType}`],
        output_artifact_ids: [artifact.id],
        payload: { artifact_id: artifact.id, artifact_type: artifact.type, artifact_status: artifact.status },
      })
      artifact.created_by_action_id = action.id
      await writeJson(join(run.artifactDir, `${artifact.id}.json`), artifact)
      await refreshRun(run, "running")

      return {
        content: [{ type: "text", text: `Wrote ${artifact.type} artifact ${artifact.id} (${artifact.status}).` }],
        details: { action_id: action.id, artifact },
      }
    },
  })

  pi.registerTool({
    name: "agentic_action_request",
    label: "Agentic action.request",
    description: "Request an Agentic action through the dogfood policy membrane without directly executing host-owned effects.",
    promptSnippet: "Request declared Agentic actions and persist approval-required records.",
    promptGuidelines: [
      "Use agentic_action_request to propose release.cut only after writing a ready_to_cut release-readiness-report artifact.",
      "Never simulate release.cut by running git tag, git push, or npm publish directly.",
    ],
    parameters: Schema.object({
      action: Schema.string("Action id, e.g. release.cut."),
      capability: Schema.string("Capability id, e.g. release.cut."),
      reason: Schema.string("Why the action is being requested."),
      input_artifact_ids: Schema.array(Schema.string()),
      payload: Schema.any(),
    }, ["action", "reason"]),
    execute: async (_toolCallId: string, params: JsonObject, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) => {
      const run = await ensureRun(ctx.cwd)
      const requestedAction = requiredString(params.action, "action")
      const requestedCapability = optionalString(params.capability) ?? requestedAction
      const effects = actionEffects(requestedAction)
      const approvalRequired = requestedAction === "release.cut" || effects.some(isMutatingEffect)
      const policy = approvalRequired
        ? {
            decision: "approval_required",
            code: "approval_required",
            capability: requestedCapability,
            reason: `${requestedAction} requires maintainer approval before host-owned effects execute.`,
          }
        : {
            decision: "allow",
            code: "allowed",
            capability: requestedCapability,
            reason: `${requestedAction} is available through the Pi dogfood adapter.`,
          }

      const action = await recordAction(run, {
        type: requestedAction,
        status: approvalRequired ? "approval_required" : "completed",
        capability: requestedCapability,
        input_artifact_ids: stringArray(params.input_artifact_ids),
        effects,
        policy,
        payload: jsonObject(params.payload),
      })
      let approvalArtifact: ArtifactRecord | undefined
      if (approvalRequired) {
        approvalArtifact = await writeApprovalRequest(run, action, requiredString(params.reason, "reason"))
      }

      return {
        content: [{
          type: "text",
          text: approvalRequired
            ? `Recorded ${requestedAction} as approval_required (${action.id}).`
            : `Recorded ${requestedAction} as completed (${action.id}).`,
        }],
        details: { action, approval_request_artifact: approvalArtifact },
      }
    },
  })

  pi.on("agent_end", async (_event, ctx) => {
    const run = runs.get(await workspaceRoot(ctx.cwd).catch(() => ctx.cwd))
    if (run !== undefined) await refreshRun(run, "completed")
  })
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim() !== "") return value
  throw new Error(`${field} must be a non-empty string`)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

async function ensureRun(cwd: string): Promise<RunState> {
  const root = await workspaceRoot(cwd)
  const existing = runs.get(root)
  if (existing !== undefined) return existing

  const runId = process.env.AGENTIC_PI_RUN_ID ?? `run-pi-${new Date().toISOString().replace(/[:.]/g, "-")}`
  const runDir = join(root, ".agentic", ".data", "runs", runId)
  const actionDir = join(runDir, "actions")
  const artifactDir = join(runDir, "artifacts")
  const run: RunState = {
    root,
    runId,
    runDir,
    actionDir,
    artifactDir,
    actionLogPath: join(runDir, "actions.jsonl"),
    summaryPath: join(runDir, "summary.md"),
    latestPath: join(root, ".agentic", ".data", "latest.json"),
    sequence: 0,
    actions: [],
    artifacts: [],
  }
  await mkdir(actionDir, { recursive: true })
  await mkdir(artifactDir, { recursive: true })
  await writeFile(run.actionLogPath, "", "utf-8")
  runs.set(root, run)
  await refreshRun(run, "running")
  return run
}

async function workspaceRoot(cwd: string): Promise<string> {
  let cursor = resolve(cwd)
  while (true) {
    try {
      await readFile(join(cursor, ".agentic", "agentic.yaml"), "utf-8")
      return cursor
    } catch {
      const parent = dirname(cursor)
      if (parent === cursor) throw new Error(`No .agentic/agentic.yaml found from ${cwd}`)
      cursor = parent
    }
  }
}

async function recordAction(
  run: RunState,
  input: Omit<ActionRecord, "id" | "principal" | "created_at" | "completed_at" | "data_class" | "digest"> & {
    principal?: string
    data_class?: string
  },
): Promise<ActionRecord> {
  const created = new Date().toISOString()
  const action: ActionRecord = {
    id: nextId(run, `act_${input.type.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}`),
    type: input.type,
    status: input.status,
    principal: input.principal ?? "agent:project-steward",
    created_at: created,
    completed_at: created,
    data_class: input.data_class ?? "project_public_state",
    digest: digest({
      type: input.type,
      effects: input.effects ?? [],
      payload: input.payload ?? {},
      input_artifact_ids: input.input_artifact_ids ?? [],
    }),
  }
  if (input.capability !== undefined) action.capability = input.capability
  if (input.input_artifact_ids !== undefined) action.input_artifact_ids = input.input_artifact_ids
  if (input.output_artifact_ids !== undefined) action.output_artifact_ids = input.output_artifact_ids
  if (input.effects !== undefined) action.effects = input.effects
  if (input.policy !== undefined) action.policy = input.policy
  if (input.payload !== undefined) action.payload = input.payload
  if (input.error !== undefined) action.error = input.error

  run.actions.push(action)
  await writeJson(join(run.actionDir, `${action.id}.json`), action)
  await appendFile(run.actionLogPath, `${JSON.stringify(action)}\n`, "utf-8")
  await refreshRun(run, "running")
  return action
}

async function writeArtifact(
  run: RunState,
  input: Omit<ArtifactRecord, "id" | "version" | "finalized" | "created_at">,
): Promise<ArtifactRecord> {
  const artifact: ArtifactRecord = {
    ...input,
    id: nextId(run, `art_${input.type.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "")}`),
    version: 1,
    finalized: true,
    created_at: new Date().toISOString(),
  }
  run.artifacts.push(artifact)
  await writeJson(join(run.artifactDir, `${artifact.id}.json`), artifact)
  await refreshRun(run, "running")
  return artifact
}

async function writeApprovalRequest(run: RunState, action: ActionRecord, reason: string): Promise<ArtifactRecord> {
  return writeArtifact(run, {
    type: "approval-request",
    title: `Approval required: ${action.type}`,
    status: "pending",
    data_class: action.data_class ?? "project_public_state",
    tags: ["approval", action.type],
    ...(action.input_artifact_ids === undefined ? {} : { derived_from: action.input_artifact_ids }),
    created_by_action_id: action.id,
    body: {
      action_id: action.id,
      action_type: action.type,
      action_digest: action.digest ?? digest(action),
      effects: action.effects ?? [],
      input_artifact_ids: action.input_artifact_ids ?? [],
      approver_rule: {
        all_of: [
          "principal.kind == human",
          "principal.roles includes maintainer",
          "grant.action_digest == action.digest",
          `grant.capability == ${action.capability ?? action.type}`,
        ],
      },
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      capability: action.capability ?? action.type,
      reason,
    },
  })
}

async function refreshRun(run: RunState, status: "running" | "completed"): Promise<void> {
  const approvalAction = [...run.actions].reverse().find((action) => action.status === "approval_required")
  const latest: JsonObject = {
    run_id: run.runId,
    context_mode: "bundle",
    status,
    message: status === "completed"
      ? "Pi agent loop completed through Agentic-aware tools."
      : "Pi agent loop is recording Agentic-aware tool calls.",
    bundle: { name: "agentic-project-steward", version: "0.1.0" },
    run_dir: relative(run.root, run.runDir),
    summary_path: relative(run.root, run.summaryPath),
    latest_path: relative(run.root, run.latestPath),
    actions: run.actions.map((action) => ({ id: action.id, type: action.type, status: action.status, capability: action.capability })),
    artifacts: run.artifacts.map((artifact) => ({ id: artifact.id, type: artifact.type, title: artifact.title, status: artifact.status })),
    external_write_executed: false,
  }
  if (approvalAction !== undefined) latest.approval_required_action_id = approvalAction.id
  const approvalArtifact = run.artifacts.find((artifact) => artifact.type === "approval-request")
  if (approvalArtifact !== undefined) latest.approval_request_artifact_id = approvalArtifact.id

  await writeJson(run.latestPath, latest)
  await writeFile(run.summaryPath, renderSummary(run, status), "utf-8")
}

function renderSummary(run: RunState, status: "running" | "completed"): string {
  return `# Pi Agentic Tool Run: ${run.runId}

## Summary

Status: ${status}

This run was produced by @tnezdev/agentic-runtime-local's Pi tool adapter. Pi owned the model loop. Agentic-aware tools recorded shell, artifact, and action requests into the bundle runtime state shape.

## Runtime State

- Run directory: ${relative(run.root, run.runDir)}
- Actions: ${run.actions.length}
- Artifacts: ${run.artifacts.length}
- Approval-required actions: ${run.actions.filter((action) => action.status === "approval_required").length}

## Tools

${toolNames.map((name) => `- ${name}`).join("\n")}
`
}

function classifyCommand(command: string): { decision: "allow" | "approval_required"; reason: string; effects: string[] } {
  for (const entry of mutationPatterns) {
    if (entry.pattern.test(command)) {
      return {
        decision: "approval_required",
        reason: entry.reason,
        effects: ["process.spawn", "external.write"],
      }
    }
  }
  const effects = ["process.spawn", "filesystem.read"]
  if (/\bgh\b|github\.com/i.test(command)) effects.push("network.read:github")
  if (/\bnpm\s+view\b|registry\.npmjs\.org/i.test(command)) effects.push("network.read:npm")
  if (/\bbun\s+(test|run\s+(typecheck|build))\b/i.test(command)) effects.push("process.check")
  return { decision: "allow", reason: "Command classified as read/check oriented.", effects }
}

function actionEffects(action: string): string[] {
  if (action === "release.cut") {
    return ["git.tag:release", "git.push:tag", "ci.trigger:publish", "artifact.write:release-plan"]
  }
  if (action === "release.assess") {
    return ["artifact.write:release-readiness-report", "action.request:release.cut"]
  }
  return ["action.request"]
}

function isMutatingEffect(effect: string): boolean {
  return effect.startsWith("git.") || effect.startsWith("ci.trigger") || effect.startsWith("external.write")
}

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ exit_code: number; stdout: string; stderr: string; timed_out: boolean }> {
  return new Promise((resolveShell) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, timeoutMs)
    const abort = () => {
      timedOut = true
      child.kill("SIGTERM")
    }
    signal?.addEventListener("abort", abort, { once: true })
    child.stdout?.setEncoding("utf-8")
    child.stderr?.setEncoding("utf-8")
    child.stdout?.on("data", (chunk: string) => {
      stdout = appendCaptured(stdout, chunk)
    })
    child.stderr?.on("data", (chunk: string) => {
      stderr = appendCaptured(stderr, chunk)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      resolveShell({ exit_code: 1, stdout, stderr: stderr || errorMessage(error), timed_out: timedOut })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      resolveShell({ exit_code: timedOut ? 124 : code ?? 0, stdout, stderr, timed_out: timedOut })
    })
  })
}

function appendCaptured(current: string, chunk: string): string {
  const next = current + chunk
  if (next.length <= 20000) return next
  return next.slice(next.length - 20000)
}

function clampTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 120000
  return Math.min(Math.max(Math.trunc(value), 1000), 600000)
}

function nextId(run: RunState, prefix: string): string {
  run.sequence += 1
  return `${prefix}_${String(run.sequence).padStart(4, "0")}`
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`
}

function jsonObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
