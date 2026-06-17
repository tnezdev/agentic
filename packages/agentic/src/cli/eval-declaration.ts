import type { LoadedAgenticBundleData } from "../bundle/filesystem.js"
import type { JsonObject, JsonValue } from "../types.js"

export type ParsedAgenticEvalDeclaration = {
  id: string
  fixture: string | null
  expect: {
    artifacts?: string[] | undefined
    actions?: string[] | undefined
    approval_required?: string | undefined
    external_write_executed?: boolean | undefined
  }
}

export type AgenticEvalDeclarationError = {
  field: string
  message: string
}

export function parseAgenticEvalDeclaration(
  entry: LoadedAgenticBundleData,
  fixtureIds: ReadonlySet<string>,
): ParsedAgenticEvalDeclaration | AgenticEvalDeclarationError[] {
  const errors: AgenticEvalDeclarationError[] = []
  const data = entry.data
  if (!isNonEmptyString(data.id)) {
    errors.push({ field: `evals.${entry.id}.id`, message: "id must be a non-empty string" })
  }
  const expect = data.expect
  if (!isJsonObject(expect)) {
    errors.push({ field: `evals.${entry.id}.expect`, message: "expect must be an object" })
  }

  const fixture = data.fixture
  if (fixture !== undefined && !isNonEmptyString(fixture)) {
    errors.push({ field: `evals.${entry.id}.fixture`, message: "fixture must be a non-empty string" })
  } else if (typeof fixture === "string" && !fixtureIds.has(fixture)) {
    errors.push({ field: `evals.${entry.id}.fixture`, message: `unknown fixture: ${fixture}` })
  }

  if (!isJsonObject(expect)) return errors

  const artifacts = optionalStringArray(expect.artifacts, `evals.${entry.id}.expect.artifacts`, errors)
  const actions = optionalStringArray(expect.actions, `evals.${entry.id}.expect.actions`, errors)
  const approvalRequired = optionalString(expect.approval_required, `evals.${entry.id}.expect.approval_required`, errors)
  const externalWriteExecuted = optionalBoolean(expect.external_write_executed, `evals.${entry.id}.expect.external_write_executed`, errors)

  if (externalWriteExecuted !== undefined && approvalRequired === undefined) {
    errors.push({
      field: `evals.${entry.id}.expect.external_write_executed`,
      message: "external_write_executed requires approval_required",
    })
  }

  if (errors.length > 0) return errors
  const parsedExpect: ParsedAgenticEvalDeclaration["expect"] = {}
  if (artifacts !== undefined) parsedExpect.artifacts = artifacts
  if (actions !== undefined) parsedExpect.actions = actions
  if (approvalRequired !== undefined) parsedExpect.approval_required = approvalRequired
  if (externalWriteExecuted !== undefined) parsedExpect.external_write_executed = externalWriteExecuted
  return {
    id: entry.id,
    fixture: typeof fixture === "string" ? fixture : null,
    expect: parsedExpect,
  }
}

function optionalStringArray(
  value: JsonValue | undefined,
  field: string,
  errors: AgenticEvalDeclarationError[],
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    errors.push({ field, message: "must be an array of non-empty strings" })
    return undefined
  }
  return value
}

function optionalString(
  value: JsonValue | undefined,
  field: string,
  errors: AgenticEvalDeclarationError[],
): string | undefined {
  if (value === undefined) return undefined
  if (!isNonEmptyString(value)) {
    errors.push({ field, message: "must be a non-empty string" })
    return undefined
  }
  return value
}

function optionalBoolean(
  value: JsonValue | undefined,
  field: string,
  errors: AgenticEvalDeclarationError[],
): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") {
    errors.push({ field, message: "must be a boolean" })
    return undefined
  }
  return value
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}
