import { createHash } from "node:crypto"
import type {
  ActionCapabilityDeclaration,
  ActionDataBoundaryPolicy,
  ActionDeclaration,
  ActionDecision,
  ActionDigest,
  ActionIntegrationDeclaration,
  ActionPolicyReason,
  ActionProposal,
  ApprovalRequest,
  ApprovalRequestStatus,
  JsonObject,
  JsonValue,
  ResolvedActionProposal,
} from "../types.js"

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ActionGatewayValidationError = {
  field: string
  message: string
}

export type ActionGatewayValidationResult =
  | { valid: true }
  | { valid: false; errors: [ActionGatewayValidationError, ...ActionGatewayValidationError[]] }

export type ActionGatewayDeclarations = {
  actions: readonly ActionDeclaration[]
  capabilities?: readonly ActionCapabilityDeclaration[] | undefined
}

export function validateActionGatewayDeclarations(
  declarations: ActionGatewayDeclarations,
): ActionGatewayValidationResult {
  const errors: ActionGatewayValidationError[] = []
  const actionIds = new Set<string>()
  const capabilityIds = new Set<string>()

  declarations.actions.forEach((action, index) => {
    if (typeof action.id !== "string" || action.id.trim() === "") {
      errors.push({ field: `actions[${index}].id`, message: "id must be a non-empty string" })
    } else if (actionIds.has(action.id)) {
      errors.push({ field: `actions[${index}].id`, message: `duplicate action id: ${action.id}` })
    } else {
      actionIds.add(action.id)
    }

    if (action.effects !== undefined && !isStringArray(action.effects)) {
      errors.push({ field: `actions[${index}].effects`, message: "effects must be an array of strings" })
    }
  })

  declarations.capabilities?.forEach((capability, index) => {
    if (typeof capability.id !== "string" || capability.id.trim() === "") {
      errors.push({ field: `capabilities[${index}].id`, message: "id must be a non-empty string" })
    } else if (capabilityIds.has(capability.id)) {
      errors.push({ field: `capabilities[${index}].id`, message: `duplicate capability id: ${capability.id}` })
    } else {
      capabilityIds.add(capability.id)
    }

    if (capability.action !== undefined && !actionIds.has(capability.action)) {
      errors.push({
        field: `capabilities[${index}].action`,
        message: `unknown action: ${capability.action}`,
      })
    }
    if (capability.effects !== undefined && !isStringArray(capability.effects)) {
      errors.push({
        field: `capabilities[${index}].effects`,
        message: "effects must be an array of strings",
      })
    }
    if (capability.data_classes !== undefined && !isStringArray(capability.data_classes)) {
      errors.push({
        field: `capabilities[${index}].data_classes`,
        message: "data_classes must be an array of strings",
      })
    }
  })

  declarations.actions.forEach((action, index) => {
    if (action.capability !== undefined && !capabilityIds.has(action.capability)) {
      errors.push({
        field: `actions[${index}].capability`,
        message: `unknown capability: ${action.capability}`,
      })
    }

    const capability = declarations.capabilities?.find((entry) => entry.id === action.capability)
    if (capability?.action !== undefined && capability.action !== action.id) {
      errors.push({
        field: `actions[${index}].capability`,
        message: `capability ${capability.id} is declared for ${capability.action}, not ${action.id}`,
      })
    }
  })

  if (errors.length > 0) {
    return {
      valid: false,
      errors: errors as [ActionGatewayValidationError, ...ActionGatewayValidationError[]],
    }
  }
  return { valid: true }
}

// ---------------------------------------------------------------------------
// Digest and proposal helpers
// ---------------------------------------------------------------------------

export function resolveActionProposal(
  proposal: ActionProposal,
  action: ActionDeclaration,
  actionId: string,
): ResolvedActionProposal {
  const resolved: ResolvedActionProposal = {
    id: proposal.id ?? actionId,
    type: proposal.type,
    principal: proposal.principal,
    data_class: proposal.data_class,
    effects: proposal.effects ?? stringArray(action.effects),
  }
  const capability = proposal.capability ?? optionalString(action.capability)
  if (capability !== undefined) resolved.capability = capability
  if (proposal.surface !== undefined) resolved.surface = proposal.surface
  if (proposal.schedule !== undefined) resolved.schedule = proposal.schedule
  if (proposal.hook !== undefined) resolved.hook = proposal.hook
  if (proposal.input_artifact_ids !== undefined) resolved.input_artifact_ids = proposal.input_artifact_ids
  if (proposal.payload !== undefined) resolved.payload = proposal.payload
  return resolved
}

export function actionDigestMaterial(proposal: ResolvedActionProposal): Record<string, unknown> {
  return {
    id: proposal.id,
    type: proposal.type,
    principal: proposal.principal,
    capability: proposal.capability,
    surface: proposal.surface,
    schedule: proposal.schedule,
    hook: proposal.hook,
    data_class: proposal.data_class,
    input_artifact_ids: proposal.input_artifact_ids ?? [],
    effects: proposal.effects,
    payload: proposal.payload ?? {},
  }
}

export function computeActionDigest(proposal: ResolvedActionProposal): ActionDigest {
  return createHash("sha256").update(stableStringify(actionDigestMaterial(proposal))).digest("hex")
}

export type CreateApprovalRequestInput = {
  proposal: ResolvedActionProposal
  action_digest: ActionDigest
  expires_at: string
  status?: ApprovalRequestStatus | undefined
  approver_rule?: JsonObject | undefined
}

export function createApprovalRequest(input: CreateApprovalRequestInput): ApprovalRequest {
  const request: ApprovalRequest = {
    action_id: input.proposal.id,
    action_type: input.proposal.type,
    action_digest: input.action_digest,
    effects: input.proposal.effects,
    input_artifact_ids: input.proposal.input_artifact_ids ?? [],
    approver_rule: input.approver_rule ?? {},
    expires_at: input.expires_at,
    status: input.status ?? "pending",
  }
  if (input.proposal.capability !== undefined) request.capability = input.proposal.capability
  return request
}

// ---------------------------------------------------------------------------
// Policy helpers
// ---------------------------------------------------------------------------

export type EvaluateActionPolicyInput = {
  principals: readonly string[]
  action: ActionDeclaration
  proposal: ResolvedActionProposal
  capabilities?: readonly ActionCapabilityDeclaration[] | undefined
  integrations?: readonly ActionIntegrationDeclaration[] | undefined
  data_boundary?: ActionDataBoundaryPolicy | undefined
}

export function evaluateActionPolicy(input: EvaluateActionPolicyInput): ActionDecision {
  const { action, proposal } = input

  if (action.id !== proposal.type) {
    return deny(
      "missing_action_declaration",
      `Action declaration ${action.id} does not match proposal type ${proposal.type}.`,
      proposal.capability,
    )
  }

  if (!input.principals.includes(proposal.principal)) {
    return deny(
      "undeclared_principal",
      `Principal ${proposal.principal} is not declared in the bundle manifest.`,
    )
  }

  const dataBoundary = checkDataBoundary(input.data_boundary, proposal.data_class)
  if (dataBoundary !== undefined) return dataBoundary

  const declaredCapability = optionalString(action.capability)
  if (declaredCapability !== undefined && proposal.capability !== declaredCapability) {
    return deny(
      "action_capability_mismatch",
      `Action ${proposal.type} must use declared capability ${declaredCapability}.`,
      proposal.capability,
    )
  }

  if (declaredCapability === undefined && proposal.capability !== undefined) {
    return deny(
      "action_capability_mismatch",
      `Action ${proposal.type} does not declare a capability boundary.`,
      proposal.capability,
    )
  }

  const declaredEffects = stringArray(action.effects)
  const unsupportedEffect = proposal.effects.find((effect) => !declaredEffects.includes(effect))
  if (unsupportedEffect !== undefined) {
    return deny(
      "effect_not_allowed",
      `Action ${proposal.type} does not declare effect ${unsupportedEffect}.`,
      proposal.capability,
    )
  }

  if (proposal.capability !== undefined) {
    return checkCapability(input, proposal.capability)
  }

  if (!proposal.principal.startsWith("service:")) {
    return deny(
      "service_principal_required",
      `Action ${proposal.type} has no capability and must be proposed by a host-owned service principal.`,
    )
  }

  return {
    decision: "allow",
    code: "allowed",
    reason: `Host-owned action ${proposal.type} is available to ${proposal.principal}.`,
  }
}

function checkCapability(
  input: EvaluateActionPolicyInput,
  capabilityId: string,
): ActionDecision {
  const capability = input.capabilities?.find((entry) => entry.id === capabilityId)
  const { proposal } = input
  if (capability === undefined) {
    return deny("capability_not_declared", `Missing capability declaration: ${capabilityId}.`)
  }

  const capabilityAction = optionalString(capability.action)
  if (capabilityAction !== undefined && capabilityAction !== proposal.type) {
    return deny(
      "capability_action_mismatch",
      `Capability ${capabilityId} is declared for ${capabilityAction}, not ${proposal.type}.`,
      capabilityId,
    )
  }

  const allowedPrincipals = stringArray(capability.principals?.allowed)
  if (!allowedPrincipals.includes("*") && !allowedPrincipals.includes(proposal.principal)) {
    return deny(
      "principal_not_allowed",
      `Principal ${proposal.principal} is not allowed for ${capabilityId}.`,
      capabilityId,
    )
  }

  const allowedEffects = stringArray(capability.effects)
  const unsupportedEffect = proposal.effects.find((effect) => !allowedEffects.includes(effect))
  if (unsupportedEffect !== undefined) {
    return deny(
      "effect_not_allowed",
      `Effect ${unsupportedEffect} is not declared by ${capabilityId}.`,
      capabilityId,
    )
  }

  const allowedDataClasses = stringArray(capability.data_classes)
  if (allowedDataClasses.length > 0 && !allowedDataClasses.includes(proposal.data_class)) {
    return deny(
      "data_class_not_allowed",
      `Data class ${proposal.data_class} is not allowed by ${capabilityId}.`,
      capabilityId,
    )
  }

  for (const integrationId of stringArray(capability.integrations)) {
    const integration = input.integrations?.find((entry) => entry.id === integrationId)
    if (integration === undefined) {
      return deny(
        "integration_missing",
        `Capability ${capabilityId} requires missing integration ${integrationId}.`,
        capabilityId,
      )
    }

    const availability = optionalString(integration.availability) ?? "unknown"
    if (availability === "missing" || availability === "unavailable") {
      return deny(
        "integration_unavailable",
        `Integration ${integrationId} is ${availability}.`,
        capabilityId,
      )
    }
  }

  if (capability.approval?.required === true) {
    return {
      decision: "approval_required",
      code: "approval_required",
      capability: capabilityId,
      reason: `${capabilityId} requires a runtime-authenticated approval grant before execution.`,
      required_approval: objectValue(capability.approval.approver_rule),
    }
  }

  return {
    decision: "allow",
    code: "allowed",
    capability: capabilityId,
    reason: `${capabilityId} is available for ${proposal.principal}.`,
  }
}

function checkDataBoundary(
  policy: ActionDataBoundaryPolicy | undefined,
  dataClass: string,
): ActionDecision | undefined {
  if (policy === undefined) return undefined

  const disallowed = stringArray(policy.disallowed)
  if (disallowed.includes(dataClass)) {
    return deny("data_boundary_denied", `Data class ${dataClass} is blocked by policy data-boundary.`)
  }

  const allowed = stringArray(policy.allowed_data_classes)
  if (allowed.length > 0 && !allowed.includes(dataClass)) {
    return deny("data_boundary_denied", `Data class ${dataClass} is not listed in policy data-boundary.`)
  }

  return undefined
}

function deny(code: ActionPolicyReason, reason: string, capability?: string | undefined): ActionDecision {
  const decision: ActionDecision = {
    decision: "deny",
    code,
    reason,
  }
  if (capability !== undefined) decision.capability = capability
  return decision
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`

  const record = value as Record<string, unknown>
  const entries = Object.entries(record)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function stringArray(value: unknown): string[] {
  return isStringArray(value) ? value : []
}

function objectValue(value: JsonValue | undefined): JsonObject {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value
  return {}
}
