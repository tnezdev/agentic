import { existsSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { validateActionGatewayDeclarations } from "../../action-gateway/helpers.js"
import { validateArtifactDeclaration } from "../../artifact/contracts.js"
import {
  AGENTIC_BUNDLE_MANIFEST_FILENAMES,
  loadAgenticBundle,
  loadAgenticBundleManifest,
  type LoadedAgenticBundle,
  type LoadedAgenticBundleManifest,
} from "../../bundle/filesystem.js"
import { validateAgenticTriggerDeclarations } from "../../bundle/triggers.js"
import type {
  ActionCapabilityDeclaration,
  ActionDeclaration,
  ArtifactDeclaration,
} from "../../types.js"
import type { Command } from "../context.js"
import {
  formatAgenticValidate,
  type AgenticValidateCheck,
  type AgenticValidateError,
  type AgenticValidateResult,
} from "../format.js"
import { output } from "../output.js"

type ValidationResult =
  | { valid: true }
  | { valid: false; errors: readonly AgenticValidateError[] }

export const validateCommand: Command = async (ctx, args) => {
  if (args.length > 1) throw new Error("Usage: agentic validate [path]")

  const root = resolveBundleRoot(ctx.baseDir, args[0])
  const result = await validateBundle(root)
  output(ctx, result, formatAgenticValidate)
  if (!result.valid) process.exitCode = 1
}

async function validateBundle(root: string): Promise<AgenticValidateResult> {
  let loadedManifest: LoadedAgenticBundleManifest
  try {
    loadedManifest = await loadAgenticBundleManifest(root)
  } catch (error) {
    const result = baseResult(root)
    result.checks.push({ name: "manifest", status: "failed" })
    result.errors.push(loadError(error, manifestErrorField(error)))
    return result
  }

  const result = baseResult(root, loadedManifest)
  result.checks.push({ name: "manifest", status: "passed" })

  let bundle: LoadedAgenticBundle
  try {
    bundle = await loadAgenticBundle(root)
  } catch (error) {
    result.checks.push({ name: "bundle_refs", status: "failed" })
    result.errors.push(loadError(error, "bundle_refs"))
    return result
  }

  result.checks.push({ name: "bundle_refs", status: "passed" })

  appendArtifactValidation(result, bundle)
  appendActionGatewayValidation(result, bundle)
  appendTriggerValidation(result, bundle)
  result.valid = result.errors.length === 0
  return result
}

function resolveBundleRoot(baseDir: string, subject: string | undefined): string {
  const base = resolve(baseDir)
  if (subject === undefined) {
    const workspaceBundle = join(base, ".agentic")
    if (hasBundleManifest(workspaceBundle)) return workspaceBundle
    if (hasBundleManifest(base)) return base
    if (existsSync(workspaceBundle)) return workspaceBundle
    return base
  }

  const target = isAbsolute(subject) ? resolve(subject) : resolve(base, subject)
  if (hasBundleManifest(target)) return target

  const workspaceBundle = join(target, ".agentic")
  if (hasBundleManifest(workspaceBundle) || existsSync(workspaceBundle)) return workspaceBundle
  return target
}

function hasBundleManifest(dir: string): boolean {
  return AGENTIC_BUNDLE_MANIFEST_FILENAMES.some((filename) => existsSync(join(dir, filename)))
}

function baseResult(
  root: string,
  loadedManifest?: LoadedAgenticBundleManifest | undefined,
): AgenticValidateResult {
  return {
    command: "validate",
    valid: false,
    root,
    manifest_path: loadedManifest?.path ?? null,
    bundle: loadedManifest === undefined
      ? null
      : {
          name: loadedManifest.manifest.name,
          version: loadedManifest.manifest.version,
          schema_version: loadedManifest.manifest.schema_version,
        },
    checks: [],
    errors: [],
    warnings: [],
  }
}

function appendArtifactValidation(result: AgenticValidateResult, bundle: LoadedAgenticBundle): void {
  const validationErrors: AgenticValidateError[] = []
  for (const artifact of bundle.artifacts) {
    appendErrors(
      validationErrors,
      validateArtifactDeclaration(artifact.data, `artifacts.${artifact.id}`),
    )
  }
  appendCheck(result, {
    name: "artifacts",
    status: validationErrors.length === 0 ? "passed" : "failed",
    count: bundle.artifacts.length,
  })
  result.errors.push(...validationErrors)
}

function appendActionGatewayValidation(result: AgenticValidateResult, bundle: LoadedAgenticBundle): void {
  const validation = validateActionGatewayDeclarations({
    actions: bundle.actions.map((entry) => entry.data as unknown as ActionDeclaration),
    capabilities: bundle.capabilities.map((entry) => entry.data as unknown as ActionCapabilityDeclaration),
  })
  appendCheck(result, {
    name: "action_gateway",
    status: validation.valid ? "passed" : "failed",
    actions: bundle.actions.length,
    capabilities: bundle.capabilities.length,
  })
  appendErrors(result.errors, validation)
}

function appendTriggerValidation(result: AgenticValidateResult, bundle: LoadedAgenticBundle): void {
  const validation = validateAgenticTriggerDeclarations({
    surfaces: bundle.surfaces.map((entry) => entry.data),
    schedules: bundle.schedules.map((entry) => entry.data),
    hooks: bundle.hooks.map((entry) => entry.data),
    artifacts: bundle.artifacts.map((entry) => entry.data as unknown as ArtifactDeclaration),
    actions: bundle.actions.map((entry) => entry.data as unknown as ActionDeclaration),
    capabilities: bundle.capabilities.map((entry) => entry.data as unknown as ActionCapabilityDeclaration),
  })
  appendCheck(result, {
    name: "triggers",
    status: validation.valid ? "passed" : "failed",
    surfaces: bundle.surfaces.length,
    schedules: bundle.schedules.length,
    hooks: bundle.hooks.length,
  })
  appendErrors(result.errors, validation)
}

function appendCheck(result: AgenticValidateResult, check: AgenticValidateCheck): void {
  result.checks.push(check)
}

function appendErrors(errors: AgenticValidateError[], validation: ValidationResult): void {
  if (!validation.valid) errors.push(...validation.errors)
}

function loadError(error: unknown, field: string): AgenticValidateError {
  return {
    field,
    message: error instanceof Error ? error.message : String(error),
  }
}

function manifestErrorField(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith("Missing bundle manifest") ? "bundle" : "manifest"
}
