import type {
  ActionCapabilityDeclaration,
  ActionDeclaration,
  ActionProposalTemplate,
  ArtifactDeclaration,
  HookDeclaration,
  JsonObject,
  JsonValue,
  ScheduleDeclaration,
  SurfaceDeclaration,
} from "../types.js"

export type TriggerDeclarationValidationError = {
  field: string
  message: string
}

export type TriggerDeclarationValidationResult =
  | { valid: true }
  | { valid: false; errors: [TriggerDeclarationValidationError, ...TriggerDeclarationValidationError[]] }

export type TriggerDeclarationReferences = {
  actions?: readonly ActionDeclaration[] | readonly string[] | undefined
  capabilities?: readonly ActionCapabilityDeclaration[] | readonly string[] | undefined
  artifacts?: readonly ArtifactDeclaration[] | readonly string[] | undefined
}

export type TriggerDeclarations = TriggerDeclarationReferences & {
  surfaces?: readonly unknown[] | undefined
  schedules?: readonly unknown[] | undefined
  hooks?: readonly unknown[] | undefined
}

type ReferenceSets = {
  actionIds?: Set<string> | undefined
  capabilityIds?: Set<string> | undefined
  artifactIds?: Set<string> | undefined
  actionsById: Map<string, ActionDeclaration>
}

export function validateAgenticTriggerDeclarations(
  declarations: TriggerDeclarations,
): TriggerDeclarationValidationResult {
  const errors: TriggerDeclarationValidationError[] = []
  const refs = referenceSets(declarations)

  declarations.surfaces?.forEach((surface, index) => {
    validateSurface(surface, refs, `surfaces[${index}]`, errors)
  })
  declarations.schedules?.forEach((schedule, index) => {
    validateSchedule(schedule, refs, `schedules[${index}]`, errors)
  })
  declarations.hooks?.forEach((hook, index) => {
    validateHook(hook, refs, `hooks[${index}]`, errors)
  })

  return validationResult(errors)
}

export function validateSurfaceDeclaration(
  value: unknown,
  references: TriggerDeclarationReferences = {},
  field = "surface",
): TriggerDeclarationValidationResult {
  const errors: TriggerDeclarationValidationError[] = []
  validateSurface(value, referenceSets(references), field, errors)
  return validationResult(errors)
}

export function validateScheduleDeclaration(
  value: unknown,
  references: TriggerDeclarationReferences = {},
  field = "schedule",
): TriggerDeclarationValidationResult {
  const errors: TriggerDeclarationValidationError[] = []
  validateSchedule(value, referenceSets(references), field, errors)
  return validationResult(errors)
}

export function validateHookDeclaration(
  value: unknown,
  references: TriggerDeclarationReferences = {},
  field = "hook",
): TriggerDeclarationValidationResult {
  const errors: TriggerDeclarationValidationError[] = []
  validateHook(value, referenceSets(references), field, errors)
  return validationResult(errors)
}

function validateSurface(
  value: unknown,
  refs: ReferenceSets,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (!isObject(value)) {
    errors.push({ field, message: "surface declaration must be an object" })
    return
  }

  const surface = value as Partial<SurfaceDeclaration>
  requireNonEmptyString(surface.id, `${field}.id`, errors)
  optionalString(surface.kind, `${field}.kind`, errors)
  requireNonEmptyString(surface.surface, `${field}.surface`, errors)
  optionalString(surface.route, `${field}.route`, errors)
  requireNonEmptyString(surface.principal, `${field}.principal`, errors)
  optionalString(surface.fixture, `${field}.fixture`, errors)
  optionalString(surface.notes, `${field}.notes`, errors)
  optionalJsonObject(surface.metadata, `${field}.metadata`, errors)
  validateProposalTemplate(surface.proposes, refs, `${field}.proposes`, errors)

  if (surface.emits !== undefined) {
    if (!Array.isArray(surface.emits)) {
      errors.push({ field: `${field}.emits`, message: "emits must be an array" })
    } else {
      surface.emits.forEach((emission, index) => {
        validateArtifactEmission(emission, refs, `${field}.emits[${index}]`, errors)
      })
    }
  }
}

function validateSchedule(
  value: unknown,
  refs: ReferenceSets,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (!isObject(value)) {
    errors.push({ field, message: "schedule declaration must be an object" })
    return
  }

  const schedule = value as Partial<ScheduleDeclaration>
  requireNonEmptyString(schedule.id, `${field}.id`, errors)
  optionalString(schedule.kind, `${field}.kind`, errors)
  requireNonEmptyString(schedule.cron, `${field}.cron`, errors)
  optionalString(schedule.timezone, `${field}.timezone`, errors)
  requireNonEmptyString(schedule.principal, `${field}.principal`, errors)
  optionalString(schedule.notes, `${field}.notes`, errors)
  optionalJsonObject(schedule.metadata, `${field}.metadata`, errors)
  validateProposalTemplate(schedule.proposes, refs, `${field}.proposes`, errors)

  if (schedule.selects !== undefined) {
    validateArtifactSelector(schedule.selects, refs, `${field}.selects`, errors)
  }
}

function validateHook(
  value: unknown,
  refs: ReferenceSets,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (!isObject(value)) {
    errors.push({ field, message: "hook declaration must be an object" })
    return
  }

  const hook = value as Partial<HookDeclaration>
  requireNonEmptyString(hook.id, `${field}.id`, errors)
  optionalString(hook.kind, `${field}.kind`, errors)
  optionalString(hook.description, `${field}.description`, errors)
  optionalString(hook.policy_note, `${field}.policy_note`, errors)
  optionalJsonObject(hook.metadata, `${field}.metadata`, errors)
  validateHookMatch(hook.on, refs, `${field}.on`, errors)
  validateProposalTemplate(hook.proposes, refs, `${field}.proposes`, errors)
}

function validateProposalTemplate(
  value: unknown,
  refs: ReferenceSets,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (!isObject(value)) {
    errors.push({ field, message: "proposes must be an object" })
    return
  }

  const proposal = value as Partial<ActionProposalTemplate>
  const action = requireNonEmptyString(proposal.action, `${field}.action`, errors)
  const capability = optionalString(proposal.capability, `${field}.capability`, errors)
  optionalString(proposal.reason, `${field}.reason`, errors)
  optionalString(proposal.principal, `${field}.principal`, errors)
  optionalString(proposal.data_class, `${field}.data_class`, errors)
  optionalStringArray(proposal.input_artifact_ids, `${field}.input_artifact_ids`, errors)
  optionalJsonObject(proposal.payload, `${field}.payload`, errors)

  if (action !== undefined) {
    if (refs.actionIds !== undefined && !refs.actionIds.has(action)) {
      errors.push({ field: `${field}.action`, message: `unknown action: ${action}` })
    }

    const declaredAction = refs.actionsById.get(action)
    if (capability !== undefined && declaredAction?.capability !== undefined && declaredAction.capability !== capability) {
      errors.push({
        field: `${field}.capability`,
        message: `capability ${capability} does not match action ${action} capability ${declaredAction.capability}`,
      })
    }
  }

  if (capability !== undefined && refs.capabilityIds !== undefined && !refs.capabilityIds.has(capability)) {
    errors.push({ field: `${field}.capability`, message: `unknown capability: ${capability}` })
  }
}

function validateArtifactEmission(
  value: unknown,
  refs: ReferenceSets,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (!isObject(value)) {
    errors.push({ field, message: "emission must be an object" })
    return
  }

  const artifact = requireNonEmptyString(value.artifact, `${field}.artifact`, errors)
  optionalString(value.status, `${field}.status`, errors)
  optionalStringArray(value.tags, `${field}.tags`, errors)
  checkArtifactRef(artifact, refs, `${field}.artifact`, errors)
}

function validateArtifactSelector(
  value: unknown,
  refs: ReferenceSets,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (!isObject(value)) {
    errors.push({ field, message: "selects must be an object" })
    return
  }

  const artifact = requireNonEmptyString(value.artifact, `${field}.artifact`, errors)
  optionalString(value.status, `${field}.status`, errors)
  optionalStringArray(value.tags, `${field}.tags`, errors)
  checkArtifactRef(artifact, refs, `${field}.artifact`, errors)
}

function validateHookMatch(
  value: unknown,
  refs: ReferenceSets,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (!isObject(value)) {
    errors.push({ field, message: "on must be an object" })
    return
  }

  const artifactType = requireNonEmptyString(value["artifact.type"], `${field}.artifact.type`, errors)
  optionalString(value["artifact.status"], `${field}.artifact.status`, errors)
  checkArtifactRef(artifactType, refs, `${field}.artifact.type`, errors)
}

function checkArtifactRef(
  artifact: string | undefined,
  refs: ReferenceSets,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (artifact !== undefined && refs.artifactIds !== undefined && !refs.artifactIds.has(artifact)) {
    errors.push({ field, message: `unknown artifact: ${artifact}` })
  }
}

function referenceSets(references: TriggerDeclarationReferences): ReferenceSets {
  return {
    actionIds: references.actions === undefined ? undefined : referenceIdSet(references.actions),
    capabilityIds: references.capabilities === undefined ? undefined : referenceIdSet(references.capabilities),
    artifactIds: references.artifacts === undefined ? undefined : referenceIdSet(references.artifacts),
    actionsById: actionMap(references.actions),
  }
}

function referenceIdSet(values: readonly (string | { id: string })[]): Set<string> {
  const ids = new Set<string>()
  for (const value of values) ids.add(referenceId(value))
  return ids
}

function actionMap(actions: TriggerDeclarationReferences["actions"]): Map<string, ActionDeclaration> {
  const byId = new Map<string, ActionDeclaration>()
  for (const action of actions ?? []) {
    if (typeof action === "string") continue
    if (typeof action.id === "string") byId.set(action.id, action)
  }
  return byId
}

function referenceId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id
}

function validationResult(errors: TriggerDeclarationValidationError[]): TriggerDeclarationValidationResult {
  if (errors.length === 0) return { valid: true }
  return { valid: false, errors: errors as [TriggerDeclarationValidationError, ...TriggerDeclarationValidationError[]] }
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  errors: TriggerDeclarationValidationError[],
): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ field, message: "must be a non-empty string" })
    return undefined
  }
  return value
}

function optionalString(
  value: unknown,
  field: string,
  errors: TriggerDeclarationValidationError[],
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    errors.push({ field, message: "must be a string" })
    return undefined
  }
  return value
}

function optionalStringArray(
  value: unknown,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push({ field, message: "must be an array of strings" })
  }
}

function optionalJsonObject(
  value: unknown,
  field: string,
  errors: TriggerDeclarationValidationError[],
): void {
  if (value === undefined) return
  if (!isJsonObject(value)) {
    errors.push({ field, message: "must be a JSON object" })
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isObject(value)) return false
  return Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonObject(value)
}
