import type {
  AgenticBundleSectionName,
  JsonObject,
  JsonValue,
} from "../types.js"

export const AGENTIC_BUNDLE_REF_SECTIONS: readonly AgenticBundleSectionName[] = [
  "prompts",
  "skills",
  "artifacts",
  "actions",
  "capabilities",
  "hooks",
  "surfaces",
  "schedules",
  "integrations",
  "policies",
  "deploy",
  "evals",
  "fixtures",
] as const

export type BundleManifestValidationError = {
  field: string
  message: string
}

export type BundleManifestValidationResult =
  | { valid: true }
  | { valid: false; errors: [BundleManifestValidationError, ...BundleManifestValidationError[]] }

export function validateAgenticBundleManifest(value: unknown): BundleManifestValidationResult {
  const errors: BundleManifestValidationError[] = []
  if (!isObject(value)) {
    errors.push({ field: "manifest", message: "bundle manifest must be an object" })
    return validationResult(errors)
  }

  requireNonEmptyString(value.schema_version, "schema_version", errors)
  requireNonEmptyString(value.name, "name", errors)
  requireNonEmptyString(value.version, "version", errors)
  requireNonEmptyString(value.description, "description", errors)
  validateState(value.state, errors)
  validatePrincipals(value.principals, errors)

  for (const section of AGENTIC_BUNDLE_REF_SECTIONS) {
    validateRefs(value[section], section, errors)
  }

  return validationResult(errors)
}

function validateState(value: unknown, errors: BundleManifestValidationError[]): void {
  if (!isObject(value)) {
    errors.push({ field: "state", message: "state must be an object" })
    return
  }

  requireNonEmptyString(value.adapter, "state.adapter", errors)
  requireNonEmptyString(value.dir, "state.dir", errors)
  if (typeof value.dir === "string") validateRelativePath(value.dir, "state.dir", errors)
}

function validatePrincipals(value: unknown, errors: BundleManifestValidationError[]): void {
  if (!Array.isArray(value)) {
    errors.push({ field: "principals", message: "principals must be an array" })
    return
  }

  const ids = new Set<string>()
  value.forEach((principal, index) => {
    const field = `principals[${index}]`
    if (!isObject(principal)) {
      errors.push({ field, message: "principal must be an object" })
      return
    }

    const id = principal.id
    if (typeof id !== "string" || id.trim() === "") {
      errors.push({ field: `${field}.id`, message: "must be a non-empty string" })
    } else if (ids.has(id)) {
      errors.push({ field: `${field}.id`, message: `duplicate principal id: ${id}` })
    } else {
      ids.add(id)
    }

    optionalString(principal.kind, `${field}.kind`, errors)
    optionalString(principal.description, `${field}.description`, errors)
    optionalStringArray(principal.roles, `${field}.roles`, errors)
    optionalJsonObject(principal.metadata, `${field}.metadata`, errors)
  })
}

function validateRefs(
  value: unknown,
  section: AgenticBundleSectionName,
  errors: BundleManifestValidationError[],
): void {
  if (!Array.isArray(value)) {
    errors.push({ field: section, message: `${section} must be an array` })
    return
  }

  const ids = new Set<string>()
  value.forEach((ref, index) => {
    const field = `${section}[${index}]`
    if (!isObject(ref)) {
      errors.push({ field, message: "bundle ref must be an object" })
      return
    }

    const id = ref.id
    if (typeof id !== "string" || id.trim() === "") {
      errors.push({ field: `${field}.id`, message: "must be a non-empty string" })
    } else if (ids.has(id)) {
      errors.push({ field: `${field}.id`, message: `duplicate ${section} id: ${id}` })
    } else {
      ids.add(id)
    }

    if (typeof ref.path !== "string" || ref.path.trim() === "") {
      errors.push({ field: `${field}.path`, message: "must be a non-empty string" })
    } else {
      validateRelativePath(ref.path, `${field}.path`, errors)
    }
  })
}

function validateRelativePath(
  value: string,
  field: string,
  errors: BundleManifestValidationError[],
): void {
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) {
    errors.push({ field, message: "path must be relative" })
    return
  }

  const segments = value.split(/[\\/]+/).filter((segment) => segment.length > 0)
  if (segments.includes("..")) {
    errors.push({ field, message: "path must not traverse parent directories" })
  }
}

function validationResult(errors: BundleManifestValidationError[]): BundleManifestValidationResult {
  if (errors.length === 0) return { valid: true }
  return { valid: false, errors: errors as [BundleManifestValidationError, ...BundleManifestValidationError[]] }
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  errors: BundleManifestValidationError[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ field, message: "must be a non-empty string" })
  }
}

function optionalString(
  value: unknown,
  field: string,
  errors: BundleManifestValidationError[],
): void {
  if (value !== undefined && typeof value !== "string") {
    errors.push({ field, message: "must be a string" })
  }
}

function optionalStringArray(
  value: unknown,
  field: string,
  errors: BundleManifestValidationError[],
): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push({ field, message: "must be an array of strings" })
  }
}

function optionalJsonObject(
  value: unknown,
  field: string,
  errors: BundleManifestValidationError[],
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
