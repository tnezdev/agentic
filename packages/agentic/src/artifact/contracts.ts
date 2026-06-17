import type { JsonObject, JsonValue } from "../types.js"

export type ArtifactContractValidationError = {
  field: string
  message: string
}

export type ArtifactContractValidationResult =
  | { valid: true }
  | { valid: false; errors: [ArtifactContractValidationError, ...ArtifactContractValidationError[]] }

export function validateArtifactAttachmentRef(
  value: unknown,
  field = "attachment",
): ArtifactContractValidationResult {
  const errors: ArtifactContractValidationError[] = []
  validateAttachmentRef(value, field, errors)
  return validationResult(errors)
}

export function validateArtifactData(value: unknown, field = "artifact_data"): ArtifactContractValidationResult {
  const errors: ArtifactContractValidationError[] = []
  if (!isObject(value)) {
    errors.push({ field, message: "artifact data must be an object" })
    return validationResult(errors)
  }

  const attachments = value.attachments
  if (attachments === undefined) return { valid: true }
  if (!Array.isArray(attachments)) {
    errors.push({ field: `${field}.attachments`, message: "attachments must be an array" })
    return validationResult(errors)
  }

  attachments.forEach((attachment, index) => {
    validateAttachmentRef(attachment, `${field}.attachments[${index}]`, errors)
  })

  return validationResult(errors)
}

export function validateArtifactDeclaration(
  value: unknown,
  field = "artifact_declaration",
): ArtifactContractValidationResult {
  const errors: ArtifactContractValidationError[] = []
  if (!isObject(value)) {
    errors.push({ field, message: "artifact declaration must be an object" })
    return validationResult(errors)
  }

  requireNonEmptyString(value.id, `${field}.id`, errors)
  optionalString(value.kind, `${field}.kind`, errors)
  optionalString(value.description, `${field}.description`, errors)
  optionalStringArray(value.data_classes, `${field}.data_classes`, errors)
  optionalStringArray(value.statuses, `${field}.statuses`, errors)
  optionalStringArray(value.required_fields, `${field}.required_fields`, errors)
  optionalStringArray(value.default_tags, `${field}.default_tags`, errors)
  optionalJsonObject(value.metadata, `${field}.metadata`, errors)

  if (value.attachments !== undefined) {
    if (!isObject(value.attachments)) {
      errors.push({ field: `${field}.attachments`, message: "attachments must be an object" })
    } else {
      if (value.attachments.required !== undefined && typeof value.attachments.required !== "boolean") {
        errors.push({ field: `${field}.attachments.required`, message: "required must be a boolean" })
      }
      optionalStringArray(value.attachments.roles, `${field}.attachments.roles`, errors)
      optionalStringArray(value.attachments.media_types, `${field}.attachments.media_types`, errors)
    }
  }

  return validationResult(errors)
}

function validateAttachmentRef(
  value: unknown,
  field: string,
  errors: ArtifactContractValidationError[],
): void {
  if (!isObject(value)) {
    errors.push({ field, message: "attachment ref must be an object" })
    return
  }

  requireNonEmptyString(value.id, `${field}.id`, errors)
  requireNonEmptyString(value.role, `${field}.role`, errors)
  requireNonEmptyString(value.media_type, `${field}.media_type`, errors)
  requireNonEmptyString(value.ref, `${field}.ref`, errors)
  optionalString(value.name, `${field}.name`, errors)

  if (value.size_bytes !== undefined) {
    const sizeBytes = value.size_bytes
    if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
      errors.push({ field: `${field}.size_bytes`, message: "size_bytes must be a non-negative integer" })
    }
  }

  if (value.sha256 !== undefined) {
    if (typeof value.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(value.sha256)) {
      errors.push({ field: `${field}.sha256`, message: "sha256 must be a 64-character hex string" })
    }
  }

  optionalJsonObject(value.metadata, `${field}.metadata`, errors)
}

function validationResult(errors: ArtifactContractValidationError[]): ArtifactContractValidationResult {
  if (errors.length === 0) return { valid: true }
  return { valid: false, errors: errors as [ArtifactContractValidationError, ...ArtifactContractValidationError[]] }
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  errors: ArtifactContractValidationError[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ field, message: "must be a non-empty string" })
  }
}

function optionalString(
  value: unknown,
  field: string,
  errors: ArtifactContractValidationError[],
): void {
  if (value !== undefined && typeof value !== "string") {
    errors.push({ field, message: "must be a string" })
  }
}

function optionalStringArray(
  value: unknown,
  field: string,
  errors: ArtifactContractValidationError[],
): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push({ field, message: "must be an array of strings" })
  }
}

function optionalJsonObject(
  value: unknown,
  field: string,
  errors: ArtifactContractValidationError[],
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
