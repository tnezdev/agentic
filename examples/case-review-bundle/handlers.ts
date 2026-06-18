import type {
  JsonObject,
  JsonValue,
  LoadedAgenticBundleData,
  SurfaceArtifactEmission,
  SurfaceDeclaration,
} from "../../packages/agentic/src/index.ts"
import { validateArtifactData } from "../../packages/agentic/src/index.ts"
import type {
  LocalActionHandler,
  LocalBundleArtifactRecord,
  LocalBundleHandlerFactoryContext,
  LocalBundleProposalPayloadFactoryContext,
} from "../../packages/agentic-runtime-local/src/index.ts"

function findDeclaration<T>(section: LoadedAgenticBundleData[], id: string, kind: string): T {
  const match = section.find((entry) => entry.id === id)
  if (match === undefined) throw new Error(`Missing ${kind} declaration: ${id}`)
  return match.data as unknown as T
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

function assertValidArtifactData(value: JsonObject, label: string): void {
  const result = validateArtifactData(value, label)
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.field}: ${error.message}`).join("; ")
    throw new Error(`Invalid artifact data ${label}: ${details}`)
  }
}

function requireSurfaceEmission(
  surface: SurfaceDeclaration,
  artifact: string,
): SurfaceArtifactEmission {
  const emission = surface.emits?.find((entry) => entry.artifact === artifact)
  if (emission === undefined) throw new Error(`surface ${surface.id} does not emit ${artifact}.`)
  return emission
}

function validateCasePacket(packet: JsonObject, guideline: JsonObject): JsonObject {
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

export function receiveSurface(
  context: LocalBundleHandlerFactoryContext,
): LocalActionHandler<LocalBundleArtifactRecord> {
  const surface = findDeclaration<SurfaceDeclaration>(context.bundle.surfaces, "case-intake-api", "surface")
  const requestEmission = requireSurfaceEmission(surface, "case-review-request")
  const packetEmission = requireSurfaceEmission(surface, "case-packet")

  return async ({ action_id, proposal }) => {
    const fixtureId = stringValue(proposal.payload?.fixture) ?? surface.fixture ?? "case-request-001"
    const requestFixture = findDeclaration<JsonObject>(context.bundle.fixtures, fixtureId, "fixture")
    const casePacket = objectValue(requestFixture.case_packet)
    assertValidArtifactData(casePacket, `fixtures.${fixtureId}.case_packet`)
    const dataClass = stringValue(casePacket.data_class) ?? proposal.data_class

    const requestArtifact = await context.store.writeArtifact({
      id: context.store.nextId("art_case_review_request"),
      type: "case-review-request",
      title: `Case review request ${stringValue(requestFixture.request_id) ?? "unknown"}`,
      status: requestEmission.status ?? "received",
      data_class: dataClass,
      tags: ["case-review", `surface:${surface.id}`, ...(requestEmission.tags ?? [])],
      body: requestFixture,
      source: { surface: surface.id, fixture: fixtureId },
      created_by_action_id: action_id,
    })
    const packet = await context.store.writeArtifact({
      id: context.store.nextId("art_case_packet"),
      type: "case-packet",
      title: `Case packet ${stringValue(casePacket.case_id) ?? "unknown"}`,
      status: packetEmission.status ?? "intake_ready",
      data_class: dataClass,
      tags: ["case-review", "queued-for-validation", ...(packetEmission.tags ?? [])],
      body: casePacket,
      source: { surface: surface.id, fixture: fixtureId },
      derived_from: [requestArtifact.id],
      created_by_action_id: action_id,
    })
    return { artifacts: [requestArtifact, packet] }
  }
}

export function validateCase(
  context: LocalBundleHandlerFactoryContext,
): LocalActionHandler<LocalBundleArtifactRecord> {
  return async ({ action_id, proposal }) => {
    const packetArtifactId = proposal.input_artifact_ids?.[0]
    if (packetArtifactId === undefined) throw new Error("case.validate requires a case-packet input artifact.")
    const packetArtifact = (await context.store.readArtifact({ artifact_id: packetArtifactId })).artifact
    if (packetArtifact.type !== "case-packet") throw new Error(`case.validate expected case-packet, got ${packetArtifact.type}.`)

    const guidelineFixtureId = stringValue(proposal.payload?.guideline_fixture) ?? "guideline-excerpt"
    const guidelineFixture = findDeclaration<JsonObject>(context.bundle.fixtures, guidelineFixtureId, "fixture")
    const validationResult = validateCasePacket(packetArtifact.body, guidelineFixture)
    const status = stringValue(validationResult.status) ?? "unknown"

    const validation = await context.store.writeArtifact({
      id: context.store.nextId("art_validation_result"),
      type: "validation-result",
      title: `Validation result for ${stringValue(packetArtifact.body.case_id) ?? packetArtifact.id}`,
      status,
      data_class: stringValue(packetArtifact.body.data_class) ?? packetArtifact.data_class,
      tags: ["case-review", "validation", `status:${status}`],
      body: validationResult,
      derived_from: [packetArtifact.id],
      created_by_action_id: action_id,
    })
    return { artifacts: [validation] }
  }
}

export function createCaseReviewHandoffPayload(input: {
  packet: LocalBundleArtifactRecord
  validation: LocalBundleArtifactRecord
  integration?: string | undefined
  queue?: string | undefined
}): JsonObject {
  return {
    integration: input.integration ?? "review-queue",
    queue: input.queue ?? stringValue(input.packet.body.destination) ?? "orthopedic-qc",
    case_id: stringValue(input.packet.body.case_id) ?? "unknown",
    artifact_ids: [input.packet.id, input.validation.id],
    message: "Synthetic validation findings are ready for reviewer handoff.",
  }
}

function requireInputArtifact(
  artifacts: LocalBundleArtifactRecord[],
  type: string,
): LocalBundleArtifactRecord {
  const artifact = artifacts.find((entry) => entry.type === type)
  if (artifact === undefined) throw new Error(`Handoff payload requires ${type} input artifact.`)
  return artifact
}

export function createHandoffPayload(context: LocalBundleProposalPayloadFactoryContext): JsonObject {
  return createCaseReviewHandoffPayload({
    packet: requireInputArtifact(context.input_artifacts, "case-packet"),
    validation: requireInputArtifact(context.input_artifacts, "validation-result"),
  })
}
