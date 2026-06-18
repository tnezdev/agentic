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
  validateArtifactDeclaration,
} from "../../packages/agentic/src/index.ts"
import {
  LocalBundleRunStore,
  createLocalBundlePorts,
  createLocalBundleRunId,
  loadLocalBundleHandlers,
  requestLocalBundleHookAction,
  requestLocalBundleScheduleAction,
  requestLocalBundleSurfaceAction,
  type LocalBundleArtifactRecord,
  type LocalBundlePorts,
} from "../../packages/agentic-runtime-local/src/index.ts"
import { createCaseReviewHandoffPayload } from "./handlers.ts"

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

type DemoAgenticPorts = LocalBundlePorts

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

function displayPath(path: string): string {
  return relative(process.cwd(), path) || "."
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

  const surface = findDeclaration<SurfaceDeclaration>(bundle.surfaces, "case-intake-api", "surface")
  const schedule = findDeclaration<ScheduleDeclaration>(bundle.schedules, "nightly-qc-sweep", "schedule")
  const hook = findDeclaration<HookDeclaration>(bundle.hooks, "validation-result.propose-handoff", "hook")
  const requestFixtureId = surface.fixture ?? "case-request-001"
  const handlers = await loadLocalBundleHandlers(bundle, runtime, {
    deployId: "local-demo",
    workspaceRoot: EXAMPLE_ROOT,
  })

  let packetArtifact: ArtifactRecord | undefined
  let validationArtifact: ArtifactRecord | undefined
  const ports = createLocalBundlePorts(bundle, runtime, {
    approvalRequestTags: ["case-review"],
    handlers,
  })

  const receiveResult = await requestLocalBundleSurfaceAction(ports, surface, {
    payload: {
      route: surface.route ?? "unknown",
      fixture: requestFixtureId,
    },
  })
  const receivedArtifacts = await readOutputArtifacts(ports, receiveResult)
  requireReadArtifact(receivedArtifacts, "case-review-request")
  packetArtifact = requireReadArtifact(receivedArtifacts, "case-packet")
  const dataClass = packetArtifact.data_class

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

  const validateResult = await requestLocalBundleScheduleAction(ports, schedule, {
    input_artifact_ids: [packetArtifact.id],
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

  const handoffPayload: JsonObject = createCaseReviewHandoffPayload({
    packet: packetArtifact,
    validation: validationArtifact,
  })
  const handoffResult = await requestLocalBundleHookAction(ports, hook, {
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
