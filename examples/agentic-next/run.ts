import { rm } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  ActionCapabilityDeclaration,
  ActionDeclaration,
  ActionRecord,
  ArtifactDeclaration,
  HookDeclaration,
  JsonObject,
  JsonValue,
  LoadedAgenticBundle,
  LoadedAgenticBundleData,
  ReadArtifactResult,
  RequestActionResult,
  ScheduleDeclaration,
  SurfaceDeclaration,
} from "../../packages/agentic/src/index.ts"
import {
  loadAgenticBundle,
  validateAgenticTriggerDeclarations,
  validateArtifactData,
  validateArtifactDeclaration,
} from "../../packages/agentic/src/index.ts"
import {
  LocalActionGateway,
  LocalAgenticPorts,
  LocalBundleRunStore,
  createLocalActionGatewayDeclarations,
  createLocalBundleRunId,
  type LocalBundleArtifactRecord,
  type LocalArtifactPort,
} from "../../packages/agentic-runtime-local/src/index.ts"

type ArtifactRecord = LocalBundleArtifactRecord

type DemoResult = {
  run_id: string
  run_dir: string
  summary_path: string
  latest_path: string
  approval_required_action_id: string
  approval_request_artifact_id: string
  actions: Pick<ActionRecord, "id" | "type" | "status" | "capability">[]
  artifacts: Pick<ArtifactRecord, "id" | "type" | "title" | "status">[]
}

type DemoAgenticPorts = LocalAgenticPorts<ArtifactRecord, ArtifactRecord, ArtifactRecord>

const EXAMPLE_ROOT = dirname(fileURLToPath(import.meta.url))
const BUNDLE_ROOT = join(EXAMPLE_ROOT, ".agentic")

async function loadBundle(): Promise<LoadedAgenticBundle> {
  return loadAgenticBundle(BUNDLE_ROOT)
}

function findLoaded(section: LoadedAgenticBundleData[], id: string, kind: string): LoadedAgenticBundleData {
  const match = section.find((entry) => entry.id === id)
  if (match === undefined) throw new Error(`Missing ${kind} declaration: ${id}`)
  return match
}

function findDeclaration<T>(section: LoadedAgenticBundleData[], id: string, kind: string): T {
  return findLoaded(section, id, kind).data as unknown as T
}

function declarationData<T>(section: LoadedAgenticBundleData[]): T[] {
  return section.map((entry) => entry.data as unknown as T)
}

function assertValidArtifactDeclarations(bundle: LoadedAgenticBundle): void {
  for (const artifact of bundle.artifacts) {
    const result = validateArtifactDeclaration(artifact.data, `artifacts.${artifact.id}`)
    if (!result.valid) {
      const details = result.errors.map((error) => `${error.field}: ${error.message}`).join("; ")
      throw new Error(`Invalid artifact declaration ${artifact.id}: ${details}`)
    }
  }
}

function assertValidTriggerDeclarations(bundle: LoadedAgenticBundle): void {
  const result = validateAgenticTriggerDeclarations({
    surfaces: bundle.surfaces.map((entry) => entry.data),
    schedules: bundle.schedules.map((entry) => entry.data),
    hooks: bundle.hooks.map((entry) => entry.data),
    artifacts: declarationData<ArtifactDeclaration>(bundle.artifacts),
    actions: declarationData<ActionDeclaration>(bundle.actions),
    capabilities: declarationData<ActionCapabilityDeclaration>(bundle.capabilities),
  })
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.field}: ${error.message}`).join("; ")
    throw new Error(`Invalid trigger declarations: ${details}`)
  }
}

function assertValidArtifactData(value: JsonObject, label: string): void {
  const result = validateArtifactData(value, label)
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.field}: ${error.message}`).join("; ")
    throw new Error(`Invalid artifact data ${label}: ${details}`)
  }
}

function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function objectValue(value: JsonValue | undefined): JsonObject {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value
  return {}
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function displayPath(path: string): string {
  return relative(process.cwd(), path) || "."
}

function validateCase(packet: JsonObject, guideline: JsonObject): JsonObject {
  const laterality = stringValue(packet.laterality)
  const reportText = stringValue(packet.report_text)?.toLowerCase() ?? ""
  const attachments = Array.isArray(packet.attachments) ? packet.attachments : []
  const expectedViews = typeof guideline.expected_minimum_views === "number"
    ? guideline.expected_minimum_views
    : 2
  const findings: JsonObject[] = []

  if (reportText.includes("right") && laterality !== "right") {
    findings.push({
      id: "finding-laterality-mismatch",
      severity: "high",
      message: "Report text describes the right knee, but packet metadata says left knee.",
      evidence: ["case_packet.report_text", "case_packet.laterality"],
    })
  }

  if (attachments.length < expectedViews) {
    findings.push({
      id: "finding-insufficient-views",
      severity: "medium",
      message: `Knee radiograph QC expects at least ${expectedViews} views; packet includes ${attachments.length}.`,
      evidence: ["case_packet.attachments"],
    })
  }

  return {
    status: findings.length > 0 ? "needs_reviewer" : "passed",
    finding_count: findings.length,
    findings,
    checked_rules: stringArray(guideline.rules),
    summary: findings.length > 0
      ? "Synthetic QC found issues that require reviewer handoff."
      : "Synthetic QC did not find blocking issues.",
  }
}

function renderSummary(bundle: LoadedAgenticBundle, runtime: LocalBundleRunStore, latest: DemoResult): string {
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
  const actionRows = runtime.actions
    .map((action) => {
      const policy = action.policy?.decision ?? "not_checked"
      const reason = action.policy?.reason ?? "none"
      const digest = action.digest === undefined ? "none" : action.digest.slice(0, 12)
      return `| ${action.id} | ${action.type} | ${action.status} | ${action.capability ?? "none"} | ${policy} | ${digest} | ${reason} |`
    })
    .join("\n")
  const artifactRows = runtime.artifacts
    .map((artifact) => `| ${artifact.id} | ${artifact.type} | ${artifact.status} | ${artifact.title} |`)
    .join("\n")

  return `# Agentic Next Demo Run

Run id: ${runtime.runId}
Bundle: ${bundle.manifest.name}@${bundle.manifest.version}

## What Happened

The example runner loaded the authored bundle from \`${displayPath(bundle.manifestPath)}\`, processed the synthetic API surface fixture, ran the schedule-like validation pass, and stopped at an approval gate before any external handoff. Every surface, schedule, hook, approval, and agent action entered the same action gateway before artifacts were written or effects were considered.

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

- Action requiring approval: ${latest.approval_required_action_id}
- Approval request artifact: ${latest.approval_request_artifact_id}
- External write executed: no

The runtime created an exact action digest and approval request. The model or agent cannot approve this by writing prose; a host-owned authenticated approval channel must grant the exact action before execution.

## Inspect

- Latest pointer: ${displayPath(runtime.latestPath)}
- Action log: ${displayPath(runtime.actionLogPath)}
- Action records: ${displayPath(runtime.actionDir)}
- Artifact records: ${displayPath(runtime.artifactDir)}
`
}

function summarizeAction(action: ActionRecord): DemoResult["actions"][number] {
  const summary: DemoResult["actions"][number] = {
    id: action.id,
    type: action.type,
    status: action.status,
  }
  if (action.capability !== undefined) summary.capability = action.capability
  return summary
}

function requireArtifact(artifacts: ArtifactRecord[], type: string): ArtifactRecord {
  const artifact = artifacts.find((entry) => entry.type === type)
  if (artifact === undefined) throw new Error(`Gateway did not produce expected ${type} artifact.`)
  return artifact
}

async function readOutputArtifacts(
  ports: DemoAgenticPorts,
  result: RequestActionResult,
): Promise<ReadArtifactResult<ArtifactRecord>[]> {
  const reads: ReadArtifactResult<ArtifactRecord>[] = []
  for (const artifactId of result.output_artifact_ids) {
    reads.push(await ports.readArtifact({ artifact_id: artifactId }))
  }
  return reads
}

function requireReadArtifact(reads: ReadArtifactResult<ArtifactRecord>[], type: string): ArtifactRecord {
  return requireArtifact(reads.map((read) => read.artifact), type)
}

async function runCaseReviewDemo(options: { clean: boolean }): Promise<DemoResult> {
  const bundle = await loadBundle()
  assertValidArtifactDeclarations(bundle)
  assertValidTriggerDeclarations(bundle)
  const stateDir = resolve(EXAMPLE_ROOT, bundle.manifest.state.dir)
  if (options.clean) await rm(stateDir, { recursive: true, force: true })

  const runtime = new LocalBundleRunStore(stateDir, createLocalBundleRunId())
  await runtime.init()
  const gateway = new LocalActionGateway<ArtifactRecord>(createLocalActionGatewayDeclarations(bundle), {
    nextId: (prefix) => runtime.nextId(prefix),
    recordAction: (input) => runtime.recordAction(input),
    writeApprovalRequest: (input) => runtime.writeArtifact({
      id: input.id,
      type: input.type,
      title: input.title,
      status: input.status,
      data_class: input.data_class,
      tags: ["case-review", ...input.tags],
      body: input.body as unknown as JsonObject,
      derived_from: input.derived_from,
      created_by_action_id: input.created_by_action_id,
    }),
  })

  const surface = findDeclaration<SurfaceDeclaration>(bundle.surfaces, "case-intake-api", "surface")
  const schedule = findDeclaration<ScheduleDeclaration>(bundle.schedules, "nightly-qc-sweep", "schedule")
  const hook = findDeclaration<HookDeclaration>(bundle.hooks, "validation-result.propose-handoff", "hook")
  const requestFixtureId = surface.fixture ?? "case-request-001"
  const requestFixture = findDeclaration<JsonObject>(bundle.fixtures, requestFixtureId, "fixture")
  const guidelineFixture = findDeclaration<JsonObject>(bundle.fixtures, "guideline-excerpt", "fixture")
  const casePacket = objectValue(requestFixture.case_packet)
  assertValidArtifactData(casePacket, `fixtures.${requestFixtureId}.case_packet`)
  const dataClass = stringValue(casePacket.data_class) ?? "unknown"

  const artifactPort: LocalArtifactPort<ArtifactRecord, ArtifactRecord> = {
    readArtifact: (input) => runtime.readArtifact(input),
    writeDraftArtifact: (input) => runtime.writeDraftArtifact(input),
  }
  let packetArtifact: ArtifactRecord | undefined
  let validationArtifact: ArtifactRecord | undefined
  const ports = new LocalAgenticPorts(gateway, artifactPort, {
    handlers: {
      "surface.receive": async ({ action_id }) => {
        const requestArtifact = await runtime.writeArtifact({
          id: runtime.nextId("art_case_review_request"),
          type: "case-review-request",
          title: `Case review request ${stringValue(requestFixture.request_id) ?? "unknown"}`,
          status: "received",
          data_class: dataClass,
          tags: ["case-review", `surface:${surface.id}`],
          body: requestFixture,
          source: { surface: surface.id, fixture: requestFixtureId },
          created_by_action_id: action_id,
        })
        const packet = await runtime.writeArtifact({
          id: runtime.nextId("art_case_packet"),
          type: "case-packet",
          title: `Case packet ${stringValue(casePacket.case_id) ?? "unknown"}`,
          status: "intake_ready",
          data_class: dataClass,
          tags: ["case-review", "queued-for-validation"],
          body: casePacket,
          source: { surface: surface.id, fixture: requestFixtureId },
          derived_from: [requestArtifact.id],
          created_by_action_id: action_id,
        })
        return { artifacts: [requestArtifact, packet] }
      },
      "case.validate": async ({ action_id }) => {
        if (packetArtifact === undefined) throw new Error("case.validate ran before case-packet was available.")
        const validationResult = validateCase(packetArtifact.body, guidelineFixture)
        const validation = await runtime.writeArtifact({
          id: runtime.nextId("art_validation_result"),
          type: "validation-result",
          title: `Validation result for ${stringValue(casePacket.case_id) ?? packetArtifact.id}`,
          status: stringValue(validationResult.status) ?? "unknown",
          data_class: dataClass,
          tags: ["case-review", "validation", `status:${stringValue(validationResult.status) ?? "unknown"}`],
          body: validationResult,
          derived_from: [packetArtifact.id],
          created_by_action_id: action_id,
        })
        return { artifacts: [validation] }
      },
    },
  })

  const receiveResult = await ports.requestAction({
    type: surface.proposes.action,
    principal: surface.proposes.principal ?? surface.principal,
    data_class: surface.proposes.data_class ?? dataClass,
    surface: surface.id,
    ...(surface.proposes.capability === undefined ? {} : { capability: surface.proposes.capability }),
    payload: {
      route: surface.route ?? "unknown",
      fixture: requestFixtureId,
    },
  })
  const receivedArtifacts = await readOutputArtifacts(ports, receiveResult)
  requireReadArtifact(receivedArtifacts, "case-review-request")
  packetArtifact = requireReadArtifact(receivedArtifacts, "case-packet")

  await ports.requestAction({
    type: "schedule.tick",
    principal: schedule.principal,
    data_class: dataClass,
    schedule: schedule.id,
    input_artifact_ids: [packetArtifact.id],
    payload: {
      cron: schedule.cron,
      selected_artifacts: [packetArtifact.id],
    },
  })

  const validateResult = await ports.requestAction({
    type: schedule.proposes.action,
    principal: schedule.proposes.principal ?? "agent:case-reviewer",
    data_class: schedule.proposes.data_class ?? dataClass,
    ...(schedule.proposes.capability === undefined ? {} : { capability: schedule.proposes.capability }),
    input_artifact_ids: [packetArtifact.id],
    payload: {
      guideline_fixture: "guideline-excerpt",
    },
  })
  if (validateResult.status !== "completed") {
    throw new Error(validateResult.action.policy?.reason ?? "Case validation was not allowed.")
  }
  validationArtifact = requireReadArtifact(await readOutputArtifacts(ports, validateResult), "validation-result")

  await ports.requestAction({
    type: "hook.run",
    principal: "service:agentic-runtime",
    data_class: dataClass,
    hook: hook.id,
    input_artifact_ids: [validationArtifact.id],
    payload: {
      trigger: hook.on as unknown as JsonObject,
      proposed_action: hook.proposes.action,
    },
  })

  const handoffPayload: JsonObject = {
    integration: "review-queue",
    queue: "orthopedic-qc",
    case_id: stringValue(casePacket.case_id) ?? "unknown",
    artifact_ids: [packetArtifact.id, validationArtifact.id],
    message: "Synthetic validation findings are ready for reviewer handoff.",
  }
  const handoffResult = await ports.requestAction({
    type: hook.proposes.action,
    principal: hook.proposes.principal ?? "agent:case-reviewer",
    data_class: hook.proposes.data_class ?? dataClass,
    ...(hook.proposes.capability === undefined ? {} : { capability: hook.proposes.capability }),
    input_artifact_ids: [packetArtifact.id, validationArtifact.id],
    payload: handoffPayload,
  })
  const handoffStatus = await ports.checkActionStatus({ action_id: handoffResult.action.id })
  const approvalRequestArtifactId = handoffResult.approval_request_artifact_id
  if (handoffStatus.action.status !== "approval_required" || approvalRequestArtifactId === undefined) {
    throw new Error("Demo expected handoff.release to require approval.")
  }
  const approvalRequestArtifact = await ports.readArtifact({ artifact_id: approvalRequestArtifactId })
  if (approvalRequestArtifact.artifact.type !== "approval-request") {
    throw new Error("Demo expected an approval-request artifact.")
  }

  const latest: DemoResult = {
    run_id: runtime.runId,
    run_dir: displayPath(runtime.runDir),
    summary_path: displayPath(runtime.summaryPath),
    latest_path: displayPath(runtime.latestPath),
    approval_required_action_id: handoffResult.action.id,
    approval_request_artifact_id: approvalRequestArtifact.artifact.id,
    actions: runtime.actions.map(summarizeAction),
    artifacts: runtime.artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      title: artifact.title,
      status: artifact.status,
    })),
  }

  await runtime.writeSummary(renderSummary(bundle, runtime, latest), latest)
  return latest
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2))
  const latest = await runCaseReviewDemo({ clean: flags.has("--clean") })

  if (flags.has("--json")) {
    console.log(JSON.stringify(latest, null, 2))
    return
  }

  console.log(`Agentic Next demo run: ${latest.run_id}`)
  console.log(`Summary: ${latest.summary_path}`)
  console.log(`Latest pointer: ${latest.latest_path}`)
  console.log(`Approval required: ${latest.approval_required_action_id}`)
  console.log(`Approval request artifact: ${latest.approval_request_artifact_id}`)
}

if (import.meta.main) {
  await main()
}

export { loadBundle, runCaseReviewDemo }
