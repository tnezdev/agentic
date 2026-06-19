import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import {
  FilesystemArtifactAdapter,
  loadAgenticBundle,
  type ActionRecord,
  type ApprovalRequest,
  type HookDeclaration,
  type LoadedAgenticBundleData,
  type ScheduleDeclaration,
  type SurfaceDeclaration,
} from "@tnezdev/agentic"
import type { RuntimeContext } from "@tnezdev/agentic/runtime"
import {
  createLocalActionGatewayDeclarations,
  createLocalBundlePorts,
  createFilesystemArtifactPort,
  loadLocalBundleHandlers,
  loadLocalBundleRuntimeBindings,
  LocalActionGateway,
  LocalAgenticPorts,
  LocalBundleRunStore,
  createLocalAdminConsoleHandler,
  requestLocalBundleHookAction,
  requestLocalBundleScheduleAction,
  requestLocalBundleSurfaceAction,
  runtime,
  type LocalActionGatewayStore,
} from "./index.js"

const TASK_ID = "01KTC500000000000000000001"
const PROFILE_ARTIFACT_ID = "01KAC500000000000000000001"
const CONTINUITY_ARTIFACT_ID = "01KAC500000000000000000002"
const CASE_REVIEW_BUNDLE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/case-review-bundle/.agentic",
)
const CASE_REVIEW_BUNDLE_TEMPLATE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../agentic/templates/case-review-bundle",
)

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, "utf-8")
}

async function writeSecondBrainWorkspace(baseDir: string): Promise<void> {
  await writeText(
    join(baseDir, ".agentic", "personas", "researcher.md"),
    `---
name: researcher
description: Activate when turning an open question into a concise second-brain research brief
memory_tags: [second-brain, research]
skills: [research-brief]
task_filter:
  tags: [research]
  status: ready
workflow: research-loop
---

# Researcher

Use durable Agentic primitives.
You are working from {{cwd}} at {{timestamp}} on {{hostname}}.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "skills", "research-brief", "skill.md"),
    `---
name: research-brief
description: Activate when an agent needs to convert a research question into a cited second-brain brief
tags: [second-brain, research]
---

# Research Brief

Write a concise durable brief.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "workflows", "research-loop.json"),
    JSON.stringify(
      {
        id: "research-loop",
        name: "Second-brain research loop",
        version: "1.0",
        nodes: [
          { id: "frame-question", label: "Frame question" },
          { id: "write-brief", label: "Write brief" },
        ],
        edges: [{ from: "frame-question", to: "write-brief" }],
      },
      null,
      2,
    ),
  )
  await writeText(
    join(baseDir, ".agentic", "tasks", `${TASK_ID}.json`),
    JSON.stringify(
      {
        id: TASK_ID,
        description: "Research lightweight reading queue practices",
        status: "ready",
        tags: ["second-brain", "research"],
        annotations: [],
        created_at: "2026-06-05T16:00:00.000Z",
        updated_at: "2026-06-05T16:00:00.000Z",
      },
      null,
      2,
    ),
  )
}

async function writeArtifactAssistantWorkspace(baseDir: string): Promise<void> {
  await writeText(
    join(baseDir, ".agentic", "personas", "assistant.md"),
    `---
name: assistant
description: Activate when starting a personal assistant session from durable artifacts
memory_tags: [personal-assistant, continuity]
skills: [session-brief]
---

# Assistant

Load durable artifacts before acting.
You are working from {{cwd}} at {{timestamp}} on {{hostname}}.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "skills", "session-brief", "skill.md"),
    `---
name: session-brief
description: Activate when synthesizing a startup briefing from assistant artifacts
tags: [personal-assistant, continuity]
---

# Session Brief

Read mounted artifacts, brief the user, and wait for confirmation before doing follow-on work.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "artifacts", PROFILE_ARTIFACT_ID, "meta.json"),
    JSON.stringify(
      {
        id: PROFILE_ARTIFACT_ID,
        type: "user-profile",
        title: "Alex Profile",
        body_ref: `${PROFILE_ARTIFACT_ID}/v1.md`,
        version: 1,
        finalized: true,
        tags: ["personal-assistant", "session-start-context"],
        created_at: "2026-06-16T13:00:00.000Z",
        updated_at: "2026-06-16T13:00:00.000Z",
      },
      null,
      2,
    ),
  )
  await writeText(
    join(baseDir, ".agentic", "artifacts", PROFILE_ARTIFACT_ID, "v1.md"),
    "# Alex Profile\n\nAlex wants a conversational assistant that reconstructs context before acting.\n",
  )
  await writeText(
    join(baseDir, ".agentic", "artifacts", CONTINUITY_ARTIFACT_ID, "meta.json"),
    JSON.stringify(
      {
        id: CONTINUITY_ARTIFACT_ID,
        type: "continuity-brief",
        title: "Alex Continuity",
        body_ref: `${CONTINUITY_ARTIFACT_ID}/v1.md`,
        version: 1,
        finalized: true,
        tags: ["personal-assistant", "session-start-context"],
        created_at: "2026-06-16T13:00:00.000Z",
        updated_at: "2026-06-16T13:00:00.000Z",
      },
      null,
      2,
    ),
  )
  await writeText(
    join(baseDir, ".agentic", "artifacts", CONTINUITY_ARTIFACT_ID, "v1.md"),
    "# Alex Continuity\n\nOpen work: choose the next assistant portability experiment.\n",
  )
}

async function writeMinimalBundleWorkspace(baseDir: string): Promise<void> {
  await writeText(
    join(baseDir, ".agentic", "agentic.json"),
    JSON.stringify(
      {
        schema_version: "agentic-bundle.example.v0",
        name: "minimal-bundle",
        version: "0.1.0",
        description: "Minimal authored bundle for local runtime tests.",
        state: { adapter: "filesystem", dir: ".agentic/.data" },
        principals: [{ id: "service:test", kind: "service" }],
        prompts: [],
        skills: [],
        artifacts: [],
        actions: [],
        capabilities: [],
        hooks: [],
        surfaces: [],
        schedules: [],
        integrations: [],
        policies: [],
        deploy: [],
        evals: [],
        fixtures: [],
      },
      null,
      2,
    ),
  )
}

async function writeStewardPersonaAndWorkflow(baseDir: string): Promise<void> {
  await writeText(
    join(baseDir, ".agentic", "personas", "second-brain-steward.md"),
    `---
name: second-brain-steward
description: Activate when reviewing second-brain tasks and artifacts
memory_tags: [second-brain, stewardship]
skills: []
task_filter:
  tags: [stewardship]
  status: ready
workflow: weekly-review
---

# Steward

Review durable Agentic state.
`,
  )
  await writeText(
    join(baseDir, ".agentic", "workflows", "weekly-review.json"),
    JSON.stringify(
      {
        id: "weekly-review",
        name: "Weekly review",
        version: "1.0",
        nodes: [{ id: "review", label: "Review" }],
        edges: [],
      },
      null,
      2,
    ),
  )
}

async function writeFakePi(binDir: string): Promise<string> {
  const path = join(binDir, "pi")
  await writeText(
    path,
    `#!/bin/sh
printf '%s\n' "$@" > "$PI_ARGS_FILE"
printf '%s\n' "$PWD" > "$PI_CWD_FILE"
if [ -n "$PI_STDOUT_FILE" ]; then
  printf 'fake pi completed\n' > "$PI_STDOUT_FILE"
else
  printf 'fake pi completed\n'
fi
`,
  )
  await chmod(path, 0o755)
  return path
}

function dataOf(
  result: Awaited<ReturnType<NonNullable<typeof runtime.commands.run>>>,
): Record<string, unknown> {
  return result?.data as Record<string, unknown>
}

type GatewayArtifact = {
  id: string
  type: string
  title: string
  status: string
  body: ApprovalRequest
  created_by_action_id: string
}

function createGatewayStore(): {
  actions: ActionRecord[]
  artifacts: GatewayArtifact[]
  store: LocalActionGatewayStore<GatewayArtifact>
} {
  let sequence = 0
  const actions: ActionRecord[] = []
  const artifacts: GatewayArtifact[] = []
  return {
    actions,
    artifacts,
    store: {
      nextId(prefix: string): string {
        sequence += 1
        return `${prefix}_${String(sequence).padStart(4, "0")}`
      },
      async recordAction(input: Omit<ActionRecord, "created_at" | "completed_at">): Promise<ActionRecord> {
        const action: ActionRecord = {
          ...input,
          created_at: "2026-06-17T00:00:00.000Z",
          completed_at: "2026-06-17T00:00:00.000Z",
        }
        actions.push(action)
        return action
      },
      async writeApprovalRequest(input): Promise<GatewayArtifact> {
        const artifact: GatewayArtifact = {
          id: input.id,
          type: input.type,
          title: input.title,
          status: input.status,
          body: input.body,
          created_by_action_id: input.created_by_action_id,
        }
        artifacts.push(artifact)
        return artifact
      },
    },
  }
}

function loadedDeclaration<T>(entries: LoadedAgenticBundleData[], id: string): T {
  const entry = entries.find((item) => item.id === id)
  if (entry === undefined) throw new Error(`Missing loaded declaration: ${id}`)
  return entry.data as unknown as T
}

describe("local action gateway declarations", () => {
  it("derives action gateway declarations from the case-review bundle", async () => {
    const bundle = await loadAgenticBundle(CASE_REVIEW_BUNDLE_ROOT)
    const declarations = createLocalActionGatewayDeclarations(bundle)

    expect(declarations.principals).toEqual([
      "service:demo-api",
      "service:nightly-scheduler",
      "service:agentic-runtime",
      "agent:case-reviewer",
      "user:reviewer.alba",
    ])
    expect(declarations.actions.map((action) => action.id)).toEqual([
      "surface.receive",
      "schedule.tick",
      "case.validate",
      "hook.run",
      "approval.request",
      "external.handoff",
    ])
    expect(declarations.capabilities?.map((capability) => capability.id)).toEqual([
      "case.validate",
      "handoff.release",
    ])
    expect(declarations.integrations?.map((integration) => integration.id)).toEqual(["review-queue"])
    expect(declarations.integrations?.[0]).toMatchObject({
      id: "review-queue",
      availability: "declared-for-demo",
    })
    expect(declarations.actions.find((action) => action.id === "external.handoff")).toMatchObject({
      capability: "handoff.release",
      effects: ["external.write:review-queue", "artifact.write:handoff-note"],
    })
    expect(declarations.data_boundary).toMatchObject({
      allowed_data_classes: ["synthetic_regulated_demo"],
      disallowed: ["real_phi", "real_patient_data", "private_customer_data"],
    })
  })
})

describe("local bundle trigger helpers", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentic-bundle-trigger-helper-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("routes declared surface, schedule, and hook proposals through bundle ports", async () => {
    const bundle = await loadAgenticBundle(CASE_REVIEW_BUNDLE_ROOT)
    const store = new LocalBundleRunStore(join(tmpDir, ".agentic", ".data"), "run-test")
    await store.init()
    const ports = createLocalBundlePorts(bundle, store)
    const surface = loadedDeclaration<SurfaceDeclaration>(bundle.surfaces, "case-intake-api")
    const schedule = loadedDeclaration<ScheduleDeclaration>(bundle.schedules, "nightly-qc-sweep")
    const hook = loadedDeclaration<HookDeclaration>(bundle.hooks, "validation-result.propose-handoff")

    const receive = await requestLocalBundleSurfaceAction(ports, surface, {
      data_class: "synthetic_regulated_demo",
      payload: { fixture: "case-request-001" },
    })
    const validate = await requestLocalBundleScheduleAction(ports, schedule, {
      principal: "agent:case-reviewer",
      data_class: "synthetic_regulated_demo",
      input_artifact_ids: ["art_case_packet_0001"],
      payload: { guideline_fixture: "guideline-excerpt" },
    })
    const handoff = await requestLocalBundleHookAction(ports, hook, {
      principal: "agent:case-reviewer",
      data_class: "synthetic_regulated_demo",
      input_artifact_ids: ["art_case_packet_0001", "art_validation_result_0001"],
      payload: { integration: "review-queue", queue: "orthopedic-qc" },
    })

    expect(receive.action).toMatchObject({
      type: "surface.receive",
      status: "completed",
      principal: "service:demo-api",
      surface: "case-intake-api",
    })
    expect(validate.action).toMatchObject({
      type: "case.validate",
      status: "completed",
      principal: "agent:case-reviewer",
      capability: "case.validate",
      schedule: "nightly-qc-sweep",
    })
    expect(handoff.action).toMatchObject({
      type: "external.handoff",
      status: "approval_required",
      principal: "agent:case-reviewer",
      capability: "handoff.release",
      hook: "validation-result.propose-handoff",
    })
    expect(handoff.approval_request_artifact_id).toBeString()
    expect(handoff.approval_request).toMatchObject({
      action_id: handoff.action.id,
      action_digest: handoff.action.digest,
      capability: "handoff.release",
      status: "pending",
    })
    expect(store.actions.map((action) => action.type)).toEqual([
      "surface.receive",
      "case.validate",
      "approval.request",
      "external.handoff",
    ])
    expect(store.artifacts).toHaveLength(1)
    expect(store.artifacts[0]).toMatchObject({
      type: "approval-request",
      status: "pending",
      created_by_action_id: store.actions[2]?.id,
    })
  })

  it("loads explicit local bundle handlers from deploy config", async () => {
    const bundle = await loadAgenticBundle(CASE_REVIEW_BUNDLE_ROOT)
    const store = new LocalBundleRunStore(join(tmpDir, ".agentic", ".data"), "run-test")
    await store.init()
    const bindings = await loadLocalBundleRuntimeBindings(bundle, store, {
      deployId: "local-demo",
      workspaceRoot: resolve(CASE_REVIEW_BUNDLE_ROOT, ".."),
    })
    const handlers = bindings.handlers
    const ports = createLocalBundlePorts(bundle, store, { handlers })
    const surface = loadedDeclaration<SurfaceDeclaration>(bundle.surfaces, "case-intake-api")
    const schedule = loadedDeclaration<ScheduleDeclaration>(bundle.schedules, "nightly-qc-sweep")

    expect(Object.keys(handlers).sort()).toEqual(["case.validate", "external.handoff", "surface.receive"])
    expect(Object.keys(bindings.proposalPayloads)).toEqual(["validation-result.propose-handoff"])
    const receive = await requestLocalBundleSurfaceAction(ports, surface, {
      payload: { fixture: "case-request-001" },
    })
    expect(receive.output_artifact_ids).toHaveLength(2)
    const packet = store.artifacts.find((artifact) => artifact.type === "case-packet")
    expect(packet).toMatchObject({
      status: "intake_ready",
      data_class: "synthetic_regulated_demo",
    })

    const validate = await requestLocalBundleScheduleAction(ports, schedule, {
      input_artifact_ids: [packet!.id],
    })

    expect(validate.status).toBe("completed")
    const validation = store.artifacts.find((artifact) => artifact.type === "validation-result")
    expect(validation).toMatchObject({
      status: "needs_reviewer",
      derived_from: [packet!.id],
    })
    expect(validate.output_artifact_ids).toEqual([validation!.id])
  })

  it("keeps local handler modules inside the workspace root", async () => {
    const bundle = await loadAgenticBundle(CASE_REVIEW_BUNDLE_ROOT)
    const store = new LocalBundleRunStore(join(tmpDir, ".agentic", ".data"), "run-test")
    await store.init()

    await expect(loadLocalBundleHandlers(bundle, store, {
      deployId: "local-demo",
      workspaceRoot: bundle.root,
    })).rejects.toThrow("must stay inside workspace root")
  })
})

describe("local action gateway", () => {
  const declarations = {
    principals: ["agent:case-reviewer", "service:agentic-runtime"],
    actions: [
      {
        id: "approval.request",
        effects: ["artifact.write:approval-request"],
      },
      {
        id: "case.validate",
        capability: "case.validate",
        effects: ["artifact.read:case-packet", "artifact.write:validation-result"],
      },
      {
        id: "external.handoff",
        capability: "handoff.release",
        effects: ["external.write:review-queue"],
      },
    ],
    capabilities: [
      {
        id: "case.validate",
        action: "case.validate",
        effects: ["artifact.read:case-packet", "artifact.write:validation-result"],
        data_classes: ["synthetic_regulated_demo"],
        principals: { allowed: ["agent:case-reviewer"] },
        approval: { required: false },
      },
      {
        id: "handoff.release",
        action: "external.handoff",
        effects: ["external.write:review-queue"],
        data_classes: ["synthetic_regulated_demo"],
        principals: { allowed: ["agent:case-reviewer"] },
        approval: {
          required: true,
          approver_rule: { all_of: ["grant.action_digest == action.digest"] },
        },
      },
    ],
    data_boundary: { allowed_data_classes: ["synthetic_regulated_demo"] },
  }

  it("records approval-required requestAction results and exact approval request artifacts", async () => {
    const { actions, artifacts, store } = createGatewayStore()
    const gateway = new LocalActionGateway(declarations, store, {
      approvalExpiresAt: () => "2026-06-18T00:00:00.000Z",
    })

    const result = await gateway.requestAction({
      type: "external.handoff",
      principal: "agent:case-reviewer",
      data_class: "synthetic_regulated_demo",
      input_artifact_ids: ["art_packet_001"],
      payload: { queue: "orthopedic-qc" },
    })

    expect(result.action.status).toBe("approval_required")
    expect(result.status).toBe("approval_required")
    expect(result.action.digest).toHaveLength(64)
    expect(result.approval_request_artifact_id).toBe(artifacts[0]?.id)
    expect(result.approval_request).toMatchObject({
      action_id: result.action.id,
      action_digest: result.action.digest,
      capability: "handoff.release",
      status: "pending",
    })
    expect(actions.map((action) => action.type)).toEqual(["approval.request", "external.handoff"])
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]!.body).toMatchObject({
      action_id: result.action.id,
      action_digest: result.action.digest,
      capability: "handoff.release",
      status: "pending",
    })

    const status = await gateway.checkActionStatus({ action_id: result.action.id })
    expect(status.action).toEqual(result.action)
    expect(status.approval_request).toEqual(result.approval_request)
  })

  it("exposes action request and status through the local Agentic ports", async () => {
    const { store } = createGatewayStore()
    const gateway = new LocalActionGateway(declarations, store)
    const ports = new LocalAgenticPorts(gateway, {
      async readArtifact() {
        throw new Error("not used")
      },
      async writeDraftArtifact() {
        throw new Error("not used")
      },
    }, {
      handlers: {
        "case.validate": async () => ({
          output_artifact_ids: ["art_validation_001"],
          payload: { status: "passed" },
        }),
      },
    })

    const requested = await ports.requestAction({
      type: "case.validate",
      principal: "agent:case-reviewer",
      data_class: "synthetic_regulated_demo",
      input_artifact_ids: ["art_packet_001"],
    })

    expect(requested.status).toBe("completed")
    expect(requested.output_artifact_ids).toEqual(["art_validation_001"])
    expect(requested.action.payload).toEqual({ status: "passed" })

    const status = await ports.checkActionStatus({ action_id: requested.action.id })
    expect(status.action).toEqual(requested.action)
  })

  it("records failed allowed handler actions before rethrowing", async () => {
    const { store, actions } = createGatewayStore()
    const gateway = new LocalActionGateway(declarations, store)

    await expect(gateway.submit({
      type: "case.validate",
      principal: "agent:case-reviewer",
      data_class: "synthetic_regulated_demo",
      input_artifact_ids: ["art_packet_001"],
    }, async () => {
      throw new Error("case.validate handler exploded")
    })).rejects.toThrow("case.validate handler exploded")

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      type: "case.validate",
      status: "failed",
      principal: "agent:case-reviewer",
      policy: {
        decision: "allow",
      },
      error: "case.validate handler exploded",
    })
  })

  it("does not execute denied action handlers", async () => {
    const { store } = createGatewayStore()
    const gateway = new LocalActionGateway(declarations, store)
    let executed = false

    const result = await gateway.submit({
      type: "case.validate",
      principal: "agent:unknown",
      data_class: "synthetic_regulated_demo",
    }, async () => {
      executed = true
      return {}
    })

    expect(result.action.status).toBe("denied")
    expect(result.action.policy).toMatchObject({
      decision: "deny",
      code: "undeclared_principal",
    })
    expect(executed).toBe(false)
  })
})

describe("local bundle run store", () => {
  let tmpDir: string
  let store: LocalBundleRunStore

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentic-bundle-run-store-test-"))
    store = new LocalBundleRunStore(join(tmpDir, ".agentic", ".data"), "run-test")
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("initializes the inspectable bundle run state layout", async () => {
    await store.init()

    expect(await readdir(store.runDir)).toContain("actions.jsonl")
    expect(await readdir(store.runDir)).toContain("approval-decisions.jsonl")
    expect(await readdir(store.runDir)).toContain("actions")
    expect(await readdir(store.runDir)).toContain("artifacts")
    expect(await readdir(store.runDir)).toContain("approval-decisions")
    expect(await readFile(store.actionLogPath, "utf-8")).toBe("")
    expect(await readFile(store.approvalDecisionLogPath, "utf-8")).toBe("")
  })

  it("writes artifact records and draft artifact updates", async () => {
    await store.init()

    const artifact = await store.writeArtifact({
      id: "art_case_packet_0001",
      type: "case-packet",
      title: "Case Packet",
      status: "intake_ready",
      data_class: "synthetic_regulated_demo",
      tags: ["case-review"],
      body: { case_id: "case-001" },
      created_by_action_id: "act_surface_receive_0001",
    })
    expect(artifact.version).toBe(1)
    expect(artifact.finalized).toBe(true)
    expect(typeof artifact.created_at).toBe("string")

    const persisted = JSON.parse(
      await readFile(join(store.artifactDir, "art_case_packet_0001.json"), "utf-8"),
    )
    expect(persisted).toMatchObject({
      id: "art_case_packet_0001",
      type: "case-packet",
      title: "Case Packet",
      body: { case_id: "case-001" },
    })

    const draft = await store.writeDraftArtifact({
      type: "validation-result",
      title: "Validation Result",
      body: { data_class: "synthetic_regulated_demo", status: "draft" },
      tags: ["validation"],
    })
    expect(draft.artifact.id).toBe("art_validation_result_0001")
    expect(draft.artifact.finalized).toBe(false)

    const updated = await store.writeDraftArtifact({
      artifact_id: draft.artifact.id,
      body: { data_class: "synthetic_regulated_demo", status: "ready" },
    })
    expect(updated.artifact.version).toBe(2)
    expect((await store.readArtifact({ artifact_id: draft.artifact.id })).body).toEqual({
      data_class: "synthetic_regulated_demo",
      status: "ready",
    })
  })

  it("records actions, summary markdown, and latest pointer", async () => {
    await store.init()

    const action = await store.recordAction({
      id: "act_case_validate_0001",
      type: "case.validate",
      status: "completed",
      principal: "agent:case-reviewer",
      output_artifact_ids: ["art_validation_result_0001"],
      payload: { status: "passed" },
    })
    expect(action.created_at).toBeString()
    expect(action.completed_at).toBeString()
    expect(await store.readAction(action.id)).toEqual(action)

    const actionRecord = JSON.parse(
      await readFile(join(store.actionDir, "act_case_validate_0001.json"), "utf-8"),
    )
    expect(actionRecord).toMatchObject({
      id: "act_case_validate_0001",
      type: "case.validate",
      status: "completed",
    })
    expect(await readFile(store.actionLogPath, "utf-8")).toContain("act_case_validate_0001")

    await store.writeSummary("# Summary\n", {
      run_id: store.runId,
      run_dir: store.runDir,
    })
    expect(await readFile(store.summaryPath, "utf-8")).toBe("# Summary\n")
    expect(JSON.parse(await readFile(store.latestPath, "utf-8"))).toMatchObject({
      run_id: "run-test",
      run_dir: store.runDir,
    })
  })

  it("records durable approval decisions", async () => {
    await store.init()

    const decision = await store.recordApprovalDecision({
      id: await store.nextApprovalDecisionId(),
      approval_request_id: "art_approval_request_0001",
      action_id: "act_external_handoff_0001",
      action_digest: "digest-123",
      principal: "user:reviewer.alba",
      decision: "rejected",
      expires_at: "2026-06-18T00:00:00.000Z",
      capability: "handoff.release",
      comment: "Needs revision.",
    })

    expect(decision.id).toBe("approval_decision_0001")
    expect(decision.decided_at).toBeString()
    expect(await store.readApprovalDecisionByAction("act_external_handoff_0001")).toEqual(decision)

    const persisted = JSON.parse(
      await readFile(join(store.approvalDecisionDir, "approval_decision_0001.json"), "utf-8"),
    )
    expect(persisted).toMatchObject({
      id: "approval_decision_0001",
      action_id: "act_external_handoff_0001",
      decision: "rejected",
      principal: "user:reviewer.alba",
    })
    expect(await readFile(store.approvalDecisionLogPath, "utf-8")).toContain("approval_decision_0001")
  })
})

describe("local runtime package", () => {
  let tmpDir: string
  let ctx: RuntimeContext

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "agentic-runtime-local-test-"))
    ctx = {
      cwd: tmpDir,
      workspace_root: tmpDir,
      runtime_name: "local",
      runtime_package: "@tnezdev/agentic-runtime-local",
      json: true,
      env: {},
      config: {
        adapter: "filesystem",
        memory: {
          dir: ".agentic/memory",
          defaultTier: "L1",
          dreamDepth: 3,
        },
        workflow: {
          graphsDir: ".agentic/workflows",
          runsDir: ".agentic/runs",
        },
        wake: {},
        runtime: {
          targets: {},
        },
      },
      runtime_config: {},
      agentic: {} as RuntimeContext["agentic"],
    }
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("exports a valid local runtime manifest", () => {
    expect(runtime.kind).toBe("agentic-runtime")
    expect(runtime.api_version).toBe(1)
    expect(runtime.name).toBe("local")
    expect(runtime.package_name).toBe("@tnezdev/agentic-runtime-local")
    expect(runtime.capabilities).toEqual(["init", "run", "approve", "reject", "status"])
    expect(runtime.commands.init).toBeFunction()
    expect(runtime.commands.run).toBeFunction()
    expect(runtime.commands.approve).toBeFunction()
    expect(runtime.commands.reject).toBeFunction()
    expect(runtime.commands.status).toBeFunction()
  })

  it("initializes local runtime glue idempotently", async () => {
    const first = await runtime.commands.init!(ctx, { args: [], flags: {} })
    const second = await runtime.commands.init!(ctx, { args: [], flags: {} })

    expect(first?.summary).toContain("Initialized")
    expect(second?.summary).toContain("already initialized")

    const state = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "runtime", "local", "runtime.json"), "utf-8"),
    )
    expect(state).toEqual({
      version: 1,
      runtime: "local",
      package_name: "@tnezdev/agentic-runtime-local",
      targets_dir: "targets",
      invocations_dir: "invocations",
    })
  })

  it("reports status before and after init", async () => {
    const before = await runtime.commands.status!(ctx, { args: [], flags: {} })
    expect(before?.data).toMatchObject({ initialized: false })

    await runtime.commands.init!(ctx, { args: [], flags: {} })
    const after = await runtime.commands.status!(ctx, { args: [], flags: {} })

    expect(after?.summary).toContain("initialized")
    expect(after?.data).toMatchObject({
      initialized: true,
      targets_dir_exists: true,
    })
  })

  it("reads and writes draft artifacts through the filesystem artifact port", async () => {
    const artifacts = new FilesystemArtifactAdapter(tmpDir)
    const { store } = createGatewayStore()
    const gateway = new LocalActionGateway({ principals: [], actions: [] }, store)
    const ports = new LocalAgenticPorts(gateway, createFilesystemArtifactPort(artifacts))

    const created = await ports.writeDraftArtifact({
      type: "brief",
      title: "Draft Brief",
      body: "# Draft Brief\n\nTBD.\n",
      tags: ["draft"],
    })
    expect(created.artifact.finalized).toBe(false)
    expect(created.artifact.version).toBe(1)

    const read = await ports.readArtifact({ artifact_id: created.artifact.id })
    expect(read.artifact.title).toBe("Draft Brief")
    expect(read.body).toBe("# Draft Brief\n\nTBD.\n")

    const updated = await ports.writeDraftArtifact({
      artifact_id: created.artifact.id,
      body: "# Draft Brief\n\nReady for review.\n",
    })
    expect(updated.artifact.version).toBe(2)

    const reread = await ports.readArtifact({ artifact_id: created.artifact.id })
    expect(reread.body).toBe("# Draft Brief\n\nReady for review.\n")
  })

  it("auto-initializes local runtime glue before running", async () => {
    await writeSecondBrainWorkspace(tmpDir)

    const result = await runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: {},
    })

    expect(result?.summary).toContain("Prepared local Agentic run")
    const state = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "runtime", "local", "runtime.json"), "utf-8"),
    )
    expect(state.runtime).toBe("local")
  })

  it("auto-detects authored bundle workspaces and writes dry bundle state", async () => {
    await writeMinimalBundleWorkspace(tmpDir)
    await writeText(join(tmpDir, ".agentic", ".data", "stale.txt"), "stale state\n")

    const result = await runtime.commands.run!(ctx, {
      args: [],
      flags: { clean: true },
    })
    const data = dataOf(result)
    const runId = data["run_id"] as string
    const invocationId = data["invocation_id"] as string

    expect(result?.summary).toContain("Prepared local Agentic bundle minimal-bundle")
    expect(data).toMatchObject({
      context_mode: "bundle",
      workflow_id: null,
      workflow_run_id: null,
      artifact_id: null,
      bundle: {
        name: "minimal-bundle",
        version: "0.1.0",
      },
      run_id: runId,
      run_dir: `.agentic/.data/runs/${runId}`,
      summary_path: `.agentic/.data/runs/${runId}/summary.md`,
      latest_path: ".agentic/.data/latest.json",
    })
    expect(await readdir(join(tmpDir, ".agentic", ".data"))).not.toContain("stale.txt")
    expect(await readdir(join(tmpDir, ".agentic", ".data", "runs", runId))).toContain("actions.jsonl")
    expect(await readFile(join(tmpDir, ".agentic", ".data", "runs", runId, "actions.jsonl"), "utf-8"))
      .toBe("")

    const latest = JSON.parse(await readFile(join(tmpDir, ".agentic", ".data", "latest.json"), "utf-8"))
    expect(latest).toMatchObject({
      run_id: runId,
      context_mode: "bundle",
      status: "prepared",
      message: "Bundle execution is prepared; no local trigger sequence was executed.",
    })
    const summary = await readFile(join(tmpDir, ".agentic", ".data", "runs", runId, "summary.md"), "utf-8")
    expect(summary).toContain("No local trigger sequence was executed")

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: invocationId,
      target: ".",
      workspace_root: tmpDir,
      status: "completed",
      artifact_ids: [],
    })
  })

  it("writes inspectable bundle failure state for missing local handler exports", async () => {
    const workspace = join(tmpDir, "case-review-bundle")
    await cp(CASE_REVIEW_BUNDLE_TEMPLATE, workspace, { recursive: true })
    await writeText(
      join(workspace, ".agentic", "deploy", "local-demo.yaml"),
      `id: local-demo
kind: deploy_target
description: Local filesystem deployment for inspecting the bundle/runtime boundary.
state:
  adapter: filesystem
  dir: .agentic/.data
runtime:
  local:
    handlers:
      module: ../handlers.ts
      actions:
        surface.receive: missingReceiveSurface
        case.validate: validateCase
      proposal_payloads:
        validation-result.propose-handoff: createHandoffPayload
materializes:
  - surfaces
  - schedules
  - hooks
  - capabilities
`,
    )

    await expect(runtime.commands.run!(ctx, {
      target: "case-review-bundle",
      args: [],
      flags: { clean: true },
    })).rejects.toThrow("Local bundle handler surface.receive references missing export missingReceiveSurface")

    const latest = JSON.parse(await readFile(join(workspace, ".agentic", ".data", "latest.json"), "utf-8"))
    expect(latest).toMatchObject({
      context_mode: "bundle",
      status: "failed",
      message: "Bundle execution failed before completion.",
      error: "Local bundle handler surface.receive references missing export missingReceiveSurface.",
      actions: [],
      artifacts: [],
    })
    expect(latest.runtime_invocation_id).toBeString()

    const summary = await readFile(
      join(workspace, ".agentic", ".data", "runs", latest.run_id, "summary.md"),
      "utf-8",
    )
    expect(summary).toContain("failed before completing the local trigger sequence")
    expect(summary).toContain("missingReceiveSurface")

    const invocation = JSON.parse(
      await readFile(
        join(workspace, ".agentic", "runtime", "local", "invocations", `${latest.runtime_invocation_id}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: latest.runtime_invocation_id,
      target: "case-review-bundle",
      workspace_root: workspace,
      status: "failed",
      artifact_ids: [],
      error: "Local bundle handler surface.receive references missing export missingReceiveSurface.",
    })
  })

  it("writes inspectable bundle failure state for throwing local handlers", async () => {
    const workspace = join(tmpDir, "case-review-bundle")
    await cp(CASE_REVIEW_BUNDLE_TEMPLATE, workspace, { recursive: true })
    await writeText(
      join(workspace, "handlers.ts"),
      `export async function receiveSurface() {
  return async () => {
    throw new Error("surface.receive handler exploded")
  }
}

export async function validateCase() {
  return async () => ({})
}

export function createHandoffPayload() {
  return {}
}

export async function releaseHandoff() {
  return async () => ({})
}
`,
    )

    await expect(runtime.commands.run!(ctx, {
      target: "case-review-bundle",
      args: [],
      flags: { clean: true },
    })).rejects.toThrow("surface.receive handler exploded")

    const latest = JSON.parse(await readFile(join(workspace, ".agentic", ".data", "latest.json"), "utf-8"))
    expect(latest).toMatchObject({
      context_mode: "bundle",
      status: "failed",
      message: "Bundle execution failed before completion.",
      error: "surface.receive handler exploded",
      actions: [
        {
          type: "surface.receive",
          status: "failed",
          error: "surface.receive handler exploded",
        },
      ],
      artifacts: [],
    })
    expect(latest.runtime_invocation_id).toBeString()

    const runDir = join(workspace, ".agentic", ".data", "runs", latest.run_id)
    const summary = await readFile(join(runDir, "summary.md"), "utf-8")
    expect(summary).toContain("failed before completing the local trigger sequence")
    expect(summary).toContain("surface.receive handler exploded")

    const actionsLog = await readFile(join(runDir, "actions.jsonl"), "utf-8")
    expect(actionsLog).toContain('"status":"failed"')
    expect(actionsLog).toContain("surface.receive handler exploded")

    const invocation = JSON.parse(
      await readFile(
        join(workspace, ".agentic", "runtime", "local", "invocations", `${latest.runtime_invocation_id}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: latest.runtime_invocation_id,
      target: "case-review-bundle",
      workspace_root: workspace,
      status: "failed",
      artifact_ids: [],
      error: "surface.receive handler exploded",
    })
  })

  it("records approval rejections without executing external effects", async () => {
    const workspace = join(tmpDir, "case-review-bundle")
    await cp(CASE_REVIEW_BUNDLE_TEMPLATE, workspace, { recursive: true })

    const runResult = await runtime.commands.run!(ctx, {
      target: "case-review-bundle",
      args: [],
      flags: { clean: true },
    })
    const runData = dataOf(runResult)
    const runId = runData["run_id"] as string
    const actionId = runData["approval_required_action_id"] as string

    const rejectResult = await runtime.commands.reject!(ctx, {
      target: "case-review-bundle",
      action_id: actionId,
      principal: "user:reviewer.alba",
      comment: "Needs revision before handoff.",
      args: [],
      flags: {},
    })
    const rejectData = rejectResult?.data as Record<string, unknown>

    expect(rejectResult?.summary).toContain(`Rejected approval for action ${actionId}`)
    expect(rejectData).toMatchObject({
      run_id: runId,
      approval_decision_id: "approval_decision_0001",
      approval_request_id: runData["approval_request_artifact_id"],
      action_id: actionId,
      capability: "handoff.release",
      principal: "user:reviewer.alba",
      decision: "rejected",
      comment: "Needs revision before handoff.",
      external_write_executed: false,
    })

    const runDir = join(workspace, ".agentic", ".data", "runs", runId)
    const decision = JSON.parse(
      await readFile(join(runDir, "approval-decisions", "approval_decision_0001.json"), "utf-8"),
    )
    expect(decision).toMatchObject({
      approval_request_id: runData["approval_request_artifact_id"],
      action_id: actionId,
      decision: "rejected",
      principal: "user:reviewer.alba",
    })
    expect(await readFile(join(runDir, "approval-decisions.jsonl"), "utf-8"))
      .toContain("approval_decision_0001")

    const latest = JSON.parse(await readFile(join(workspace, ".agentic", ".data", "latest.json"), "utf-8"))
    expect(latest).toMatchObject({
      run_id: runId,
      approval_decision_id: "approval_decision_0001",
      approval_status: "rejected",
      external_write_executed: false,
    })
    expect(latest.approval_decisions).toEqual([
      {
        id: "approval_decision_0001",
        action_id: actionId,
        decision: "rejected",
        principal: "user:reviewer.alba",
        capability: "handoff.release",
      },
    ])
    expect(latest.artifacts.map((artifact: { type: string }) => artifact.type)).not.toContain("handoff-note")
    expect(latest.actions.find((action: { id: string }) => action.id === actionId)).toMatchObject({
      status: "approval_required",
    })

    const summary = await readFile(join(runDir, "summary.md"), "utf-8")
    expect(summary).toContain("## Approval Decisions")
    expect(summary).toContain("approval_decision_0001")
    expect(summary).toContain("rejected")

    const secondReject = await runtime.commands.reject!(ctx, {
      target: "case-review-bundle",
      action_id: actionId,
      principal: "user:reviewer.alba",
      args: [],
      flags: {},
    })
    expect(secondReject?.summary).toContain("already rejected")
    const decisionFiles = (await readdir(join(runDir, "approval-decisions")))
      .filter((entry) => entry.endsWith(".json"))
    expect(decisionFiles).toEqual(["approval_decision_0001.json"])
  })

  it("approves and resumes stored approval-gated actions", async () => {
    const workspace = join(tmpDir, "case-review-bundle")
    await cp(CASE_REVIEW_BUNDLE_TEMPLATE, workspace, { recursive: true })

    const runResult = await runtime.commands.run!(ctx, {
      target: "case-review-bundle",
      args: [],
      flags: { clean: true },
    })
    const runData = dataOf(runResult)
    const runId = runData["run_id"] as string
    const actionId = runData["approval_required_action_id"] as string

    const approveResult = await runtime.commands.approve!(ctx, {
      target: "case-review-bundle",
      action_id: actionId,
      principal: "user:reviewer.alba",
      comment: "Approved for handoff.",
      args: [],
      flags: {},
    })
    const approveData = approveResult?.data as Record<string, unknown>

    expect(approveResult?.summary).toContain(`Granted approval for action ${actionId}`)
    expect(approveData).toMatchObject({
      run_id: runId,
      approval_decision_id: "approval_decision_0001",
      approval_request_id: runData["approval_request_artifact_id"],
      action_id: actionId,
      capability: "handoff.release",
      principal: "user:reviewer.alba",
      decision: "granted",
      comment: "Approved for handoff.",
      external_write_executed: true,
    })
    expect(approveData.output_artifact_ids).toEqual(["art_handoff_note_0001"])

    const runDir = join(workspace, ".agentic", ".data", "runs", runId)
    const latest = JSON.parse(await readFile(join(workspace, ".agentic", ".data", "latest.json"), "utf-8"))
    expect(latest).toMatchObject({
      run_id: runId,
      approval_decision_id: "approval_decision_0001",
      approval_status: "granted",
      external_write_executed: true,
    })
    expect(latest.artifacts.map((artifact: { type: string }) => artifact.type)).toContain("handoff-note")
    expect(latest.actions.find((action: { id: string }) => action.id === actionId)).toMatchObject({
      status: "completed",
    })

    const handoff = JSON.parse(
      await readFile(join(runDir, "artifacts", "art_handoff_note_0001.json"), "utf-8"),
    )
    expect(handoff).toMatchObject({
      type: "handoff-note",
      status: "released",
      created_by_action_id: actionId,
      body: {
        target_queue: "orthopedic-qc",
        external_delivery: {
          integration: "review-queue",
          status: "mock-delivered",
        },
      },
    })

    const secondApprove = await runtime.commands.approve!(ctx, {
      target: "case-review-bundle",
      action_id: actionId,
      principal: "user:reviewer.alba",
      args: [],
      flags: {},
    })
    expect(secondApprove?.summary).toContain("already granted")
    const handoffFiles = (await readdir(join(runDir, "artifacts"))).filter((entry) => entry.includes("handoff_note"))
    expect(handoffFiles).toEqual(["art_handoff_note_0001.json"])
  })

  it("renders a minimal approval inbox for local admin review", async () => {
    const workspace = join(tmpDir, "case-review-bundle")
    await cp(CASE_REVIEW_BUNDLE_TEMPLATE, workspace, { recursive: true })

    const runResult = await runtime.commands.run!(ctx, {
      target: "case-review-bundle",
      args: [],
      flags: { clean: true },
    })
    const runData = dataOf(runResult)
    const actionId = runData["approval_required_action_id"] as string
    const handler = createLocalAdminConsoleHandler(ctx, {
      target: "case-review-bundle",
      csrfToken: "test-token",
    })

    const response = await handler(new Request("http://127.0.0.1/approvals"))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain("Agentic Local Admin")
    expect(html).toContain("Approval Inbox")
    expect(html).toContain(actionId)
    expect(html).toContain("handoff.release")

    const detailResponse = await handler(new Request(`http://127.0.0.1/approvals/${actionId}`))
    const detailHtml = await detailResponse.text()
    expect(detailResponse.status).toBe(200)
    expect(detailHtml).toContain("Approve And Resume")
    expect(detailHtml).toContain("user:reviewer.alba")
    expect(detailHtml).toContain("test-token")
  })

  it("renders run overview and action pages for local admin observability", async () => {
    const workspace = join(tmpDir, "case-review-bundle")
    await cp(CASE_REVIEW_BUNDLE_TEMPLATE, workspace, { recursive: true })

    const runResult = await runtime.commands.run!(ctx, {
      target: "case-review-bundle",
      args: [],
      flags: { clean: true },
    })
    const runData = dataOf(runResult)
    const runId = runData["run_id"] as string
    const actionId = runData["approval_required_action_id"] as string
    const artifactId = runData["approval_request_artifact_id"] as string
    const handler = createLocalAdminConsoleHandler(ctx, {
      target: "case-review-bundle",
      csrfToken: "test-token",
    })

    const overviewResponse = await handler(new Request("http://127.0.0.1/"))
    const overviewHtml = await overviewResponse.text()
    expect(overviewResponse.status).toBe(200)
    expect(overviewHtml).toContain("Run Overview")
    expect(overviewHtml).toContain("Recent Actions")
    expect(overviewHtml).toContain(actionId)

    const runResponse = await handler(new Request("http://127.0.0.1/runs/latest"))
    expect(runResponse.status).toBe(200)
    expect(await runResponse.text()).toContain(runId)

    const actionsResponse = await handler(new Request("http://127.0.0.1/actions"))
    const actionsHtml = await actionsResponse.text()
    expect(actionsResponse.status).toBe(200)
    expect(actionsHtml).toContain("Action Log")
    expect(actionsHtml).toContain("handoff.release")

    const detailResponse = await handler(new Request(`http://127.0.0.1/actions/${actionId}`))
    const detailHtml = await detailResponse.text()
    expect(detailResponse.status).toBe(200)
    expect(detailHtml).toContain("Action Detail")
    expect(detailHtml).toContain("Policy Decision")
    expect(detailHtml).toContain(`/approvals/${actionId}`)

    const artifactsResponse = await handler(new Request("http://127.0.0.1/artifacts"))
    const artifactsHtml = await artifactsResponse.text()
    expect(artifactsResponse.status).toBe(200)
    expect(artifactsHtml).toContain("Artifact Browser")
    expect(artifactsHtml).toContain(artifactId)

    const artifactDetailResponse = await handler(new Request(`http://127.0.0.1/artifacts/${artifactId}`))
    const artifactDetailHtml = await artifactDetailResponse.text()
    expect(artifactDetailResponse.status).toBe(200)
    expect(artifactDetailHtml).toContain("Artifact record")
    expect(artifactDetailHtml).toContain("Raw Artifact JSON")
    expect(artifactDetailHtml).toContain(`/actions/${actionId}`)
    expect(artifactDetailHtml).toContain(`/approvals/${actionId}`)

    const apiRunResponse = await handler(new Request("http://127.0.0.1/api/runs/latest"))
    const apiRun = JSON.parse(await apiRunResponse.text()) as Record<string, unknown>
    expect(apiRunResponse.status).toBe(200)
    expect(apiRun.run).toMatchObject({ id: runId })
    expect(apiRun.summary_markdown).toEqual(expect.stringContaining("# Local Bundle Run"))

    const apiActionResponse = await handler(new Request(`http://127.0.0.1/api/actions/${actionId}`))
    const apiAction = JSON.parse(await apiActionResponse.text()) as Record<string, unknown>
    expect(apiActionResponse.status).toBe(200)
    expect(apiAction).toMatchObject({ id: actionId, capability: "handoff.release" })

    const apiArtifactResponse = await handler(new Request(`http://127.0.0.1/api/artifacts/${artifactId}`))
    const apiArtifact = JSON.parse(await apiArtifactResponse.text()) as Record<string, unknown>
    expect(apiArtifactResponse.status).toBe(200)
    expect(apiArtifact).toMatchObject({ id: artifactId, type: "approval-request" })

    const integrationsResponse = await handler(new Request("http://127.0.0.1/integrations"))
    const integrationsHtml = await integrationsResponse.text()
    expect(integrationsResponse.status).toBe(200)
    expect(integrationsHtml).toContain("Integration Declarations")
    expect(integrationsHtml).toContain("review-queue")
    expect(integrationsHtml).toContain("handoff.release")

    const capabilitiesResponse = await handler(new Request("http://127.0.0.1/capabilities"))
    const capabilitiesHtml = await capabilitiesResponse.text()
    expect(capabilitiesResponse.status).toBe(200)
    expect(capabilitiesHtml).toContain("Capability Inspector")
    expect(capabilitiesHtml).toContain("case.validate")
    expect(capabilitiesHtml).toContain("handoff.release")

    const capabilityDetailResponse = await handler(new Request("http://127.0.0.1/capabilities/handoff.release"))
    const capabilityDetailHtml = await capabilityDetailResponse.text()
    expect(capabilityDetailResponse.status).toBe(200)
    expect(capabilityDetailHtml).toContain("Capability policy")
    expect(capabilityDetailHtml).toContain("approval_required")
    expect(capabilityDetailHtml).toContain("review-queue")
    expect(capabilityDetailHtml).toContain("Bundle Policies")

    const apiIntegrationsResponse = await handler(new Request("http://127.0.0.1/api/integrations"))
    const apiIntegrations = JSON.parse(await apiIntegrationsResponse.text()) as {
      integrations: Array<Record<string, unknown>>
    }
    expect(apiIntegrationsResponse.status).toBe(200)
    expect(apiIntegrations.integrations[0]).toMatchObject({
      id: "review-queue",
      status: "declared",
      provider: "demo-review-queue",
      required_by_capabilities: ["handoff.release"],
    })
    expect(apiIntegrations.integrations[0]?.secret_refs).toEqual(["REVIEW_QUEUE_TOKEN (required)"])

    const apiCapabilityResponse = await handler(new Request("http://127.0.0.1/api/capabilities/handoff.release"))
    const apiCapability = JSON.parse(await apiCapabilityResponse.text()) as Record<string, unknown>
    expect(apiCapabilityResponse.status).toBe(200)
    expect(apiCapability).toMatchObject({
      id: "handoff.release",
      status: "approval_required",
      missing_integrations: [],
      unavailable_integrations: [],
    })
    expect(apiCapability.integrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "review-queue" }),
    ]))
    expect(apiCapability.policies).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "data-boundary" }),
    ]))
  })

  it("protects local admin approval POSTs with a CSRF token", async () => {
    const workspace = join(tmpDir, "case-review-bundle")
    await cp(CASE_REVIEW_BUNDLE_TEMPLATE, workspace, { recursive: true })

    const runResult = await runtime.commands.run!(ctx, {
      target: "case-review-bundle",
      args: [],
      flags: { clean: true },
    })
    const runData = dataOf(runResult)
    const runId = runData["run_id"] as string
    const actionId = runData["approval_required_action_id"] as string
    const handler = createLocalAdminConsoleHandler(ctx, {
      target: "case-review-bundle",
      csrfToken: "test-token",
    })

    const forbidden = await handler(new Request(`http://127.0.0.1/approvals/${actionId}/approve`, {
      method: "POST",
      body: new URLSearchParams({ principal: "user:reviewer.alba" }),
    }))
    expect(forbidden.status).toBe(403)
    expect((await readdir(join(workspace, ".agentic", ".data", "runs", runId, "approval-decisions")))
      .filter((entry) => entry.endsWith(".json"))).toEqual([])

    const approved = await handler(new Request(`http://127.0.0.1/approvals/${actionId}/approve`, {
      method: "POST",
      body: new URLSearchParams({
        _csrf: "test-token",
        principal: "user:reviewer.alba",
        comment: "Approved in local admin.",
      }),
    }))

    expect(approved.status).toBe(303)
    expect(approved.headers.get("location")).toBe(`/approvals/${actionId}`)

    const latest = JSON.parse(await readFile(join(workspace, ".agentic", ".data", "latest.json"), "utf-8"))
    expect(latest).toMatchObject({
      run_id: runId,
      approval_status: "granted",
      external_write_executed: true,
    })
    expect(latest.actions.find((action: { id: string }) => action.id === actionId)).toMatchObject({
      status: "completed",
    })
    expect(latest.artifacts.map((artifact: { type: string }) => artifact.type)).toContain("handoff-note")
  })

  it("rejects approval grants from non-human principals", async () => {
    const workspace = join(tmpDir, "case-review-bundle")
    await cp(CASE_REVIEW_BUNDLE_TEMPLATE, workspace, { recursive: true })

    const runResult = await runtime.commands.run!(ctx, {
      target: "case-review-bundle",
      args: [],
      flags: { clean: true },
    })
    const runData = dataOf(runResult)

    await expect(runtime.commands.approve!(ctx, {
      target: "case-review-bundle",
      action_id: runData["approval_required_action_id"] as string,
      principal: "agent:case-reviewer",
      args: [],
      flags: {},
    })).rejects.toThrow("Approval principal must be human")
  })

  it("uses ready task metadata for no-arg run selection", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await writeStewardPersonaAndWorkflow(tmpDir)

    const taskPath = join(tmpDir, ".agentic", "tasks", `${TASK_ID}.json`)
    const task = JSON.parse(await readFile(taskPath, "utf-8")) as Record<string, unknown>
    task.metadata = { persona: "researcher", workflow: "research-loop" }
    await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, "utf-8")

    const result = await runtime.commands.run!(ctx, {
      args: [],
      flags: {},
    })
    const data = dataOf(result)

    expect(data).toMatchObject({
      workflow_id: "research-loop",
      persona: "researcher",
      task: {
        id: TASK_ID,
      },
    })
  })

  it("fails clearly when no-arg run is ambiguous", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await writeStewardPersonaAndWorkflow(tmpDir)

    await expect(runtime.commands.run!(ctx, {
      args: [],
      flags: {},
    })).rejects.toThrow("multiple personas are available")
  })

  it("prepares a workflow run and writes an inspectable artifact", async () => {
    await writeSecondBrainWorkspace(tmpDir)

    const result = await runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: {},
    })
    const data = dataOf(result)
    const artifactId = data["artifact_id"] as string
    const workflowRunId = data["workflow_run_id"] as string
    const invocationId = data["invocation_id"] as string

    expect(result?.summary).toContain("Prepared local Agentic run")
    expect(data).toMatchObject({
      invocation_id: invocationId,
      invocation_path: `.agentic/runtime/local/invocations/${invocationId}.json`,
      target: "research-loop",
      initialized: true,
      workflow_id: "research-loop",
      persona: "researcher",
      skills: ["research-brief"],
      task: {
        id: TASK_ID,
        description: "Research lightweight reading queue practices",
      },
    })

    const meta = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "artifacts", artifactId, "meta.json"), "utf-8"),
    )
    expect(meta.type).toBe("local-runtime-run")
    expect(meta.finalized).toBe(true)
    expect(meta.tags).toContain(`invocation:${invocationId}`)
    expect(meta.tags).toContain("workflow:research-loop")

    const body = await readFile(
      join(tmpDir, ".agentic", "artifacts", artifactId, "v1.md"),
      "utf-8",
    )
    expect(body).toContain(artifactId)
    expect(body).toContain(workflowRunId)
    expect(body).toContain(invocationId)
    expect(body).toContain(`.agentic/runtime/local/invocations/${invocationId}.json`)
    expect(body).toContain("Research lightweight reading queue practices")
    expect(body).toContain(`--base-dir '${tmpDir}'`)

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: invocationId,
      runtime: "local",
      runtime_package: "@tnezdev/agentic-runtime-local",
      target: "research-loop",
      workspace_root: tmpDir,
      status: "completed",
      workflow_run_id: workflowRunId,
      artifact_ids: [artifactId],
    })
    expect(invocation.harness_ref).toBeUndefined()
    expect(typeof invocation.started_at).toBe("string")
    expect(typeof invocation.ended_at).toBe("string")

    const workflowRun = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "runs", `${workflowRunId}.json`), "utf-8"),
    )
    expect(workflowRun.graph_id).toBe("research-loop")
    expect(workflowRun.history[0]).toMatchObject({
      node_id: "frame-question",
      from_status: "pending",
      to_status: "in_progress",
      identity: "local-runtime",
      metadata: {
        invocation_id: invocationId,
        artifact_id: artifactId,
      },
    })

    const status = await runtime.commands.status!(ctx, { args: [], flags: {} })
    expect(status?.data).toMatchObject({
      invocation_count: 1,
      last_invocation: {
        id: invocationId,
        status: "completed",
        workflow_run_id: workflowRunId,
        artifact_ids: [artifactId],
        harness_ref: undefined,
      },
    })
  })

  it("can prepare persona, skills, and artifacts without task or workflow state", async () => {
    await writeArtifactAssistantWorkspace(tmpDir)

    const result = await runtime.commands.run!(ctx, {
      args: [],
      flags: {
        context: "artifacts",
        persona: "assistant",
        "artifact-tags": "session-start-context",
      },
    })
    const data = dataOf(result)
    const artifactId = data["artifact_id"] as string
    const invocationId = data["invocation_id"] as string

    expect(result?.summary).toContain("Prepared local Agentic run")
    expect(data).toMatchObject({
      context_mode: "artifacts",
      workflow_id: null,
      workflow_run_id: null,
      persona: "assistant",
      skills: ["session-brief"],
      task: null,
      input_artifacts: [
        { id: PROFILE_ARTIFACT_ID, type: "user-profile", title: "Alex Profile", version: 1 },
        { id: CONTINUITY_ARTIFACT_ID, type: "continuity-brief", title: "Alex Continuity", version: 1 },
      ],
    })

    const meta = JSON.parse(
      await readFile(join(tmpDir, ".agentic", "artifacts", artifactId, "meta.json"), "utf-8"),
    )
    expect(meta.type).toBe("local-runtime-run")
    expect(meta.tags).toContain("context:artifacts")
    expect(meta.tags).not.toContain("workflow:research-loop")

    const body = await readFile(
      join(tmpDir, ".agentic", "artifacts", artifactId, "v1.md"),
      "utf-8",
    )
    expect(body).toContain("Context mode: artifacts")
    expect(body).toContain("Workflow run id: none created")
    expect(body).toContain(PROFILE_ARTIFACT_ID)
    expect(body).toContain(CONTINUITY_ARTIFACT_ID)
    expect(body).not.toContain("agentic workflow status")

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: invocationId,
      status: "completed",
      artifact_ids: [artifactId],
    })
    expect(invocation.workflow_run_id).toBeUndefined()
  })

  it("can invoke Pi as an optional local harness", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const binDir = join(tmpDir, "bin")
    const piArgsFile = join(tmpDir, "pi-args.txt")
    const piCwdFile = join(tmpDir, "pi-cwd.txt")
    await writeFakePi(binDir)

    const result = await runtime.commands.run!({
      ...ctx,
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PI_ARGS_FILE: piArgsFile,
        PI_CWD_FILE: piCwdFile,
      },
    }, {
      target: "research-loop",
      args: [],
      flags: { harness: "pi" },
    })
    const data = dataOf(result)
    const invocationId = data["invocation_id"] as string
    const artifactId = data["artifact_id"] as string
    const workflowRunId = data["workflow_run_id"] as string

    expect(result?.summary).toContain("through Pi session")
    expect(data["harness"]).toEqual({ provider: "pi", id: invocationId })
    expect(data["harness_result"]).toMatchObject({
      provider: "pi",
      mode: "print",
      session_id: invocationId,
      session_dir: ".agentic/runtime/local/pi-sessions",
      system_prompt_path: `.agentic/runtime/local/invocations/${invocationId}.pi-system.md`,
      user_prompt_path: `.agentic/runtime/local/invocations/${invocationId}.pi-user.md`,
      exit_code: 0,
      stdout: "fake pi completed\n",
    })

    const piArgs = (await readFile(piArgsFile, "utf-8")).split("\n")
    expect(piArgs).toContain("--print")
    expect(piArgs).toContain("--mode")
    expect(piArgs).toContain("text")
    expect(piArgs).toContain("--session-id")
    expect(piArgs).toContain(invocationId)
    expect(piArgs).toContain("--session-dir")
    expect(piArgs).toContain(join(tmpDir, ".agentic", "runtime", "local", "pi-sessions"))
    expect(piArgs).toContain("--append-system-prompt")
    expect(piArgs).toContain(join(
      tmpDir,
      ".agentic",
      "runtime",
      "local",
      "invocations",
      `${invocationId}.pi-system.md`,
    ))
    expect(piArgs).toContain(`@${join(
      tmpDir,
      ".agentic",
      "runtime",
      "local",
      "invocations",
      `${invocationId}.pi-user.md`,
    )}`)
    expect((await readFile(piCwdFile, "utf-8")).trim().endsWith(tmpDir)).toBe(true)

    const systemPrompt = await readFile(
      join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.pi-system.md`),
      "utf-8",
    )
    expect(systemPrompt).toContain("You are Pi running behind the Agentic local runtime")
    expect(systemPrompt).toContain("researcher")
    expect(systemPrompt).toContain("research-brief")
    expect(systemPrompt).toContain(workflowRunId)
    expect(systemPrompt).toContain(artifactId)
    expect(systemPrompt).toContain(`working from ${tmpDir}`)
    expect(systemPrompt).not.toContain("{{cwd}}")
    expect(systemPrompt).not.toContain("{{timestamp}}")
    expect(systemPrompt).not.toContain("{{hostname}}")

    const userPrompt = await readFile(
      join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.pi-user.md`),
      "utf-8",
    )
    expect(userPrompt).toContain("Research lightweight reading queue practices")

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.json`),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      id: invocationId,
      status: "completed",
      workflow_run_id: workflowRunId,
      artifact_ids: [artifactId],
      harness_ref: {
        provider: "pi",
        id: invocationId,
      },
    })

    const body = await readFile(
      join(tmpDir, ".agentic", "artifacts", artifactId, "v1.md"),
      "utf-8",
    )
    expect(body).toContain("Provider: pi")
    expect(body).toContain(`Session id: ${invocationId}`)
  })

  it("can attach Pi as an interactive local harness", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const binDir = join(tmpDir, "bin")
    const piArgsFile = join(tmpDir, "pi-args.txt")
    const piCwdFile = join(tmpDir, "pi-cwd.txt")
    const piStdoutFile = join(tmpDir, "pi-stdout.txt")
    await writeFakePi(binDir)

    const result = await runtime.commands.run!({
      ...ctx,
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PI_ARGS_FILE: piArgsFile,
        PI_CWD_FILE: piCwdFile,
        PI_STDOUT_FILE: piStdoutFile,
      },
    }, {
      target: "research-loop",
      args: [],
      flags: { harness: "pi", interactive: true },
    })
    const data = dataOf(result)
    const invocationId = data["invocation_id"] as string

    expect(result?.summary).toContain("through Pi session")
    expect(data["harness_result"]).toMatchObject({
      provider: "pi",
      mode: "interactive",
      session_id: invocationId,
      session_dir: ".agentic/runtime/local/pi-sessions",
      system_prompt_path: `.agentic/runtime/local/invocations/${invocationId}.pi-system.md`,
      user_prompt_path: `.agentic/runtime/local/invocations/${invocationId}.pi-user.md`,
      exit_code: 0,
      stdout: "",
      stderr: "",
    })

    const piArgs = (await readFile(piArgsFile, "utf-8")).split("\n")
    expect(piArgs).not.toContain("--print")
    expect(piArgs).not.toContain("--mode")
    expect(piArgs).not.toContain("text")
    expect(piArgs).toContain("--session-id")
    expect(piArgs).toContain(invocationId)
    expect(piArgs).toContain("--session-dir")
    expect(piArgs).toContain(join(tmpDir, ".agentic", "runtime", "local", "pi-sessions"))
    expect(piArgs).toContain("--append-system-prompt")
    expect(piArgs).toContain(join(
      tmpDir,
      ".agentic",
      "runtime",
      "local",
      "invocations",
      `${invocationId}.pi-system.md`,
    ))
    expect(piArgs).toContain(`@${join(
      tmpDir,
      ".agentic",
      "runtime",
      "local",
      "invocations",
      `${invocationId}.pi-user.md`,
    )}`)
    expect((await readFile(piCwdFile, "utf-8")).trim().endsWith(tmpDir)).toBe(true)
    expect(await readFile(piStdoutFile, "utf-8")).toBe("fake pi completed\n")
  })

  it("prompts interactive Pi to brief and wait in artifact context mode", async () => {
    await writeArtifactAssistantWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })

    const binDir = join(tmpDir, "bin")
    const piArgsFile = join(tmpDir, "pi-args.txt")
    const piCwdFile = join(tmpDir, "pi-cwd.txt")
    const piStdoutFile = join(tmpDir, "pi-stdout.txt")
    await writeFakePi(binDir)

    const result = await runtime.commands.run!({
      ...ctx,
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PI_ARGS_FILE: piArgsFile,
        PI_CWD_FILE: piCwdFile,
        PI_STDOUT_FILE: piStdoutFile,
      },
    }, {
      args: [],
      flags: {
        context: "artifacts",
        persona: "assistant",
        "artifact-tags": "session-start-context",
        harness: "pi",
        interactive: true,
      },
    })
    const data = dataOf(result)
    const invocationId = data["invocation_id"] as string

    expect(data).toMatchObject({
      context_mode: "artifacts",
      workflow_id: null,
      workflow_run_id: null,
    })
    expect(data["harness_result"]).toMatchObject({
      provider: "pi",
      mode: "interactive",
      session_id: invocationId,
    })

    const piArgs = (await readFile(piArgsFile, "utf-8")).split("\n")
    expect(piArgs).not.toContain("--print")
    expect(piArgs).toContain("Agentic assistant")

    const systemPrompt = await readFile(
      join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.pi-system.md`),
      "utf-8",
    )
    expect(systemPrompt).toContain("Context mode: artifacts")
    expect(systemPrompt).toContain("No workflow is selected")
    expect(systemPrompt).toContain("No task projection was mounted")
    expect(systemPrompt).toContain("Alex wants a conversational assistant")
    expect(systemPrompt).toContain("choose the next assistant portability experiment")
    expect(systemPrompt).not.toContain("No ready task matched")
    expect(systemPrompt).not.toContain("{{cwd}}")

    const userPrompt = await readFile(
      join(tmpDir, ".agentic", "runtime", "local", "invocations", `${invocationId}.pi-user.md`),
      "utf-8",
    )
    expect(userPrompt).toContain("Start a personal-assistant session from the mounted Agentic artifacts")
    expect(userPrompt).toContain("stop and wait for the user")
    expect(userPrompt).not.toContain("Work the selected task")
    expect(userPrompt).not.toContain("workflow run")
  })

  it("requires the Pi harness for interactive mode", async () => {
    await writeSecondBrainWorkspace(tmpDir)

    await expect(runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: { interactive: true },
    })).rejects.toThrow("requires `--harness pi`")
  })

  it("records failed invocations after a run starts", async () => {
    await writeSecondBrainWorkspace(tmpDir)
    await runtime.commands.init!(ctx, { args: [], flags: {} })
    await rm(join(tmpDir, ".agentic", "skills", "research-brief"), {
      recursive: true,
      force: true,
    })

    await expect(runtime.commands.run!(ctx, {
      target: "research-loop",
      args: [],
      flags: {},
    })).rejects.toThrow('Skill "research-brief"')

    const files = await readdir(join(tmpDir, ".agentic", "runtime", "local", "invocations"))
    expect(files).toHaveLength(1)

    const invocation = JSON.parse(
      await readFile(
        join(tmpDir, ".agentic", "runtime", "local", "invocations", files[0]!),
        "utf-8",
      ),
    )
    expect(invocation).toMatchObject({
      runtime: "local",
      runtime_package: "@tnezdev/agentic-runtime-local",
      target: "research-loop",
      workspace_root: tmpDir,
      status: "failed",
      artifact_ids: [],
    })
    expect(invocation.error).toContain('Skill "research-brief"')
    expect(typeof invocation.started_at).toBe("string")
    expect(typeof invocation.ended_at).toBe("string")
  })

  it("can run a nested Agentic workspace target", async () => {
    const workspace = join(tmpDir, "examples", "second-brain")
    await writeSecondBrainWorkspace(workspace)
    await runtime.commands.init!({ ...ctx, cwd: workspace, workspace_root: workspace }, {
      args: [],
      flags: {},
    })

    const result = await runtime.commands.run!(ctx, {
      target: "examples/second-brain",
      args: [],
      flags: {},
    })
    const data = dataOf(result)

    expect(data).toMatchObject({
      target: "examples/second-brain",
      workspace: "examples/second-brain",
      workflow_id: "research-loop",
      persona: "researcher",
    })
  })
})
