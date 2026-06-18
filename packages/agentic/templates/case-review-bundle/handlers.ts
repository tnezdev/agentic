type JsonObject = Record<string, unknown>

type BundleEntry = {
  id: string
  data: JsonObject
}

type SurfaceDeclaration = JsonObject & {
  id: string
  emits?: Array<{ artifact?: string; status?: string; tags?: string[] }>
  fixture?: string
}

type LocalBundleArtifactRecord = {
  id: string
  type: string
  title: string
  status: string
  data_class: string
  tags: string[]
  body: JsonObject
  source?: JsonObject
  derived_from?: string[]
  created_by_action_id: string
}

type LocalBundleArtifactInput = Omit<LocalBundleArtifactRecord, "created_at" | "finalized" | "version">

type HandlerContext = {
  bundle: {
    surfaces: BundleEntry[]
    fixtures: BundleEntry[]
  }
  store: {
    nextId(prefix: string): string
    writeArtifact(input: LocalBundleArtifactInput): Promise<LocalBundleArtifactRecord>
    readArtifact(input: { artifact_id: string }): Promise<{ artifact: LocalBundleArtifactRecord }>
  }
}

type ActionProposal = {
  data_class: string
  payload?: JsonObject
  input_artifact_ids?: string[]
}

type ActionHandlerInput = {
  action_id: string
  proposal: ActionProposal
}

type ProposalPayloadContext = {
  input_artifacts: LocalBundleArtifactRecord[]
}

type LocalActionHandler<T> = (input: ActionHandlerInput) => Promise<T>

function findDeclaration<T>(section: BundleEntry[], id: string, kind: string): T {
  const match = section.find((entry) => entry.id === id)
  if (match === undefined) throw new Error(`Missing ${kind} declaration: ${id}`)
  return match.data as T
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function objectValue(value: unknown): JsonObject {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value
  return {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function assertRequiredFields(value: JsonObject, fields: string[], label: string): void {
  const missing = fields.filter((field) => value[field] === undefined)
  if (missing.length > 0) throw new Error(`Invalid artifact data ${label}: missing ${missing.join(", ")}`)
}

function requireSurfaceEmission(
  surface: SurfaceDeclaration,
  artifact: string,
): { status?: string; tags?: string[] } {
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
  context: HandlerContext,
): LocalActionHandler<{ artifacts: LocalBundleArtifactRecord[] }> {
  const surface = findDeclaration<SurfaceDeclaration>(context.bundle.surfaces, "case-intake-api", "surface")
  const requestEmission = requireSurfaceEmission(surface, "case-review-request")
  const packetEmission = requireSurfaceEmission(surface, "case-packet")

  return async ({ action_id, proposal }) => {
    const fixtureId = stringValue(proposal.payload?.fixture) ?? surface.fixture ?? "case-request-001"
    const requestFixture = findDeclaration<JsonObject>(context.bundle.fixtures, fixtureId, "fixture")
    const casePacket = objectValue(requestFixture.case_packet)
    assertRequiredFields(casePacket, ["case_id", "data_class", "report_text", "attachments"], `fixtures.${fixtureId}.case_packet`)
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
  context: HandlerContext,
): LocalActionHandler<{ artifacts: LocalBundleArtifactRecord[] }> {
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
  integration?: string
  queue?: string
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

export function createHandoffPayload(context: ProposalPayloadContext): JsonObject {
  return createCaseReviewHandoffPayload({
    packet: requireInputArtifact(context.input_artifacts, "case-packet"),
    validation: requireInputArtifact(context.input_artifacts, "validation-result"),
  })
}

export function releaseHandoff(
  context: HandlerContext,
): LocalActionHandler<{ artifacts: LocalBundleArtifactRecord[]; payload: JsonObject }> {
  return async ({ action_id, proposal }) => {
    const packetArtifactId = proposal.input_artifact_ids?.[0]
    const validationArtifactId = proposal.input_artifact_ids?.[1]
    if (packetArtifactId === undefined || validationArtifactId === undefined) {
      throw new Error("external.handoff requires case-packet and validation-result input artifacts.")
    }
    const packet = (await context.store.readArtifact({ artifact_id: packetArtifactId })).artifact
    const validation = (await context.store.readArtifact({ artifact_id: validationArtifactId })).artifact
    const queue = stringValue(proposal.payload?.queue) ?? "orthopedic-qc"
    const integration = stringValue(proposal.payload?.integration) ?? "review-queue"
    const body: JsonObject = {
      case_id: stringValue(packet.body.case_id) ?? "unknown",
      validation_result_id: validation.id,
      message: stringValue(proposal.payload?.message) ?? "Synthetic validation findings are ready for reviewer handoff.",
      target_queue: queue,
      external_delivery: {
        integration,
        status: "mock-delivered",
      },
    }
    assertRequiredFields(body, ["case_id", "validation_result_id", "message", "target_queue"], "handoff-note")
    const handoff = await context.store.writeArtifact({
      id: context.store.nextId("art_handoff_note"),
      type: "handoff-note",
      title: `Handoff note for ${stringValue(packet.body.case_id) ?? packet.id}`,
      status: "released",
      data_class: stringValue(packet.body.data_class) ?? packet.data_class,
      tags: ["case-review", "handoff", "released", `queue:${queue}`],
      body,
      derived_from: [packet.id, validation.id],
      created_by_action_id: action_id,
    })
    return {
      artifacts: [handoff],
      payload: {
        external_write_executed: true,
        integration,
        queue,
        handoff_note_artifact_id: handoff.id,
      },
    }
  }
}
