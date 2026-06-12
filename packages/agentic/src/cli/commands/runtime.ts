import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parseToml } from "../../config.js"
import { FilesystemArtifactAdapter } from "../../artifact/filesystem.js"
import { FilesystemWorkflowAdapter } from "../../workflow/filesystem.js"
import { FilesystemPersonaAdapter } from "../../personas/filesystem.js"
import { LayeredSource } from "../../sources/layered.js"
import { NestedFileSource } from "../../sources/nested-file.js"
import { resolveGlobalDir, resolveProjectDir } from "../../resolve-dir.js"
import type {
  AgenticRuntimePackage,
  RuntimeCommandName,
  RuntimeCommandOutput,
  RuntimeCommandResult,
  RuntimeConfig,
  RuntimeInitArgs,
  RuntimeListOutput,
  RuntimeRef,
  RuntimeRefStatus,
  RuntimeRunArgs,
  RuntimeStatusArgs,
} from "../../types.js"
import type { Command, Ctx } from "../context.js"
import {
  formatRuntimeAction,
  formatRuntimeHelp,
  formatRuntimeList,
} from "../format.js"
import { output } from "../output.js"

const PACKAGE_DISCOVERY_NOTE =
  "Runtime packages are optional. Use `agentic runtime add <name>` to record a target; install guidance is printed when a package is missing."

type OfficialRuntime = Omit<RuntimeRef, "status" | "error">

type ResolvedRuntime = OfficialRuntime & {
  configured: boolean
  runtime_config: Record<string, string>
}

const OFFICIAL_RUNTIMES: OfficialRuntime[] = [
  {
    name: "local",
    package_name: "@tnezdev/agentic-runtime-local",
    description: "Run Agentic workspaces on the local machine.",
    capabilities: ["init", "run", "status"],
    install_command: "bun add -d @tnezdev/agentic-runtime-local",
  },
]

const RUNTIME_HELP = `Usage: agentic runtime <command> [args]

Runtime packages are optional packages that make Agentic workspaces runnable.
Core Agentic provides this CLI front door; runtime packages own harness and
platform integration.

Commands:
  runtime list              List known runtime targets
  runtime add <name>        Record a runtime target and verify its package
  runtime init [name]       Initialize a configured runtime target
  runtime run [target]      Run a target with the default runtime
  runtime status [name]     Show runtime status through the runtime package`

class MissingRuntimePackageError extends Error {}
class InvalidRuntimePackageError extends Error {}

type RuntimeDiscovery =
  | { ok: true; manifest: AgenticRuntimePackage }
  | { ok: false; reason: "missing" | "invalid"; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function knownRuntimeNames(): string {
  return OFFICIAL_RUNTIMES.map((runtime) => runtime.name).join(", ")
}

function runtimeConfig(ctx: Ctx): RuntimeConfig {
  return ctx.config.runtime ?? { targets: {} }
}

function getOfficialRuntime(name: string): OfficialRuntime {
  const runtime = OFFICIAL_RUNTIMES.find((candidate) => candidate.name === name)
  if (runtime === undefined) {
    throw new Error(
      `Unknown runtime target "${name}". Known official targets: ${knownRuntimeNames()}.`,
    )
  }
  return runtime
}

function defaultRuntimeName(ctx: Ctx): string {
  const config = runtimeConfig(ctx)
  if (config.default !== undefined) return config.default
  const configured = Object.keys(config.targets)
  if (configured.length === 1) return configured[0]!
  return "local"
}

function resolveRuntime(ctx: Ctx, name: string): ResolvedRuntime {
  const official = getOfficialRuntime(name)
  const configured = runtimeConfig(ctx).targets[name]
  return {
    ...official,
    package_name: configured?.package ?? official.package_name,
    configured: configured !== undefined,
    runtime_config: configured?.config ?? {},
  }
}

function runtimeRef(
  runtime: ResolvedRuntime,
  status: RuntimeRefStatus,
  manifest?: AgenticRuntimePackage | undefined,
  error?: string | undefined,
): RuntimeRef {
  return {
    name: runtime.name,
    package_name: manifest?.package_name ?? runtime.package_name,
    description: manifest?.description ?? runtime.description,
    status,
    capabilities: manifest?.capabilities ?? runtime.capabilities,
    install_command: runtime.install_command,
    ...(error !== undefined ? { error } : {}),
  }
}

function runtimeAction(
  command: RuntimeCommandName,
  runtime: RuntimeRef,
  status: RuntimeCommandOutput["status"],
  message: string,
  options?: {
    target?: string | undefined
    next_steps?: string[] | undefined
    result?: RuntimeCommandResult | undefined
  },
): RuntimeCommandOutput {
  const action: RuntimeCommandOutput = {
    command,
    runtime,
    status,
    message,
    next_steps: options?.next_steps ?? [],
  }
  if (options?.target !== undefined) action.target = options.target
  if (options?.result !== undefined) action.result = options.result
  return action
}

function missingPackageSteps(runtime: ResolvedRuntime): string[] {
  return [
    `Runtime package: ${runtime.package_name}`,
    `Install command: ${runtime.install_command}`,
    "Then rerun the runtime command.",
  ]
}

function missingPackageError(runtime: ResolvedRuntime): Error {
  return new Error(
    [
      `Runtime package for "${runtime.name}" is not installed.`,
      ...missingPackageSteps(runtime),
    ].join("\n"),
  )
}

function workspaceConfigDir(baseDir: string): string {
  const agenticDir = join(baseDir, ".agentic")
  const sporesDir = join(baseDir, ".spores")
  if (!existsSync(agenticDir) && existsSync(sporesDir)) return sporesDir
  return agenticDir
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8")
  } catch (err) {
    if (isRecord(err) && err["code"] === "ENOENT") return ""
    throw err
  }
}

function sectionFromDoc(value: unknown): Record<string, string> {
  return isRecord(value) ? (value as Record<string, string>) : {}
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function sectionBlock(
  name: string,
  values: Record<string, string>,
  firstKey: string,
): string {
  const keys = [
    ...(values[firstKey] !== undefined ? [firstKey] : []),
    ...Object.keys(values).filter((key) => key !== firstKey).sort(),
  ]
  return [`[${name}]`, ...keys.map((key) => `${key} = ${tomlString(values[key]!)}`)].join(
    "\n",
  )
}

function removeSections(text: string, sections: Set<string>): string {
  const kept: string[] = []
  let skipping = false

  for (const line of text.split(/\r?\n/)) {
    const sectionMatch = line.trim().match(/^\[([^\]]+)]$/)
    if (sectionMatch) {
      skipping = sections.has(sectionMatch[1]!)
    }
    if (!skipping) kept.push(line)
  }

  return kept.join("\n").trimEnd()
}

function upsertRuntimeConfig(
  text: string,
  name: string,
  packageName: string,
): string {
  const doc = parseToml(text)
  const runtimeSection = {
    ...sectionFromDoc(doc["runtime"]),
    default: name,
  }
  const targetSection = {
    ...sectionFromDoc(doc[`runtime.${name}`]),
    package: packageName,
  }
  const base = removeSections(text, new Set(["runtime", `runtime.${name}`]))
  return [
    base,
    sectionBlock("runtime", runtimeSection, "default"),
    sectionBlock(`runtime.${name}`, targetSection, "package"),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n") + "\n"
}

async function writeRuntimeConfig(
  baseDir: string,
  name: string,
  packageName: string,
): Promise<string> {
  const dir = workspaceConfigDir(baseDir)
  const configPath = join(dir, "config.toml")
  await mkdir(dir, { recursive: true })
  const current = await readTextIfExists(configPath)
  await writeFile(configPath, upsertRuntimeConfig(current, name, packageName), "utf-8")
  return configPath
}

function resolveRuntimePackage(baseDir: string, packageName: string): string {
  try {
    const requireFromWorkspace = createRequire(join(baseDir, "package.json"))
    return requireFromWorkspace.resolve(packageName)
  } catch {
    throw new MissingRuntimePackageError(`Runtime package "${packageName}" is not installed.`)
  }
}

function validateRuntimePackage(
  value: unknown,
  expected: ResolvedRuntime,
): AgenticRuntimePackage {
  if (!isRecord(value)) {
    throw new InvalidRuntimePackageError(
      `Runtime package "${expected.package_name}" must export a runtime manifest object.`,
    )
  }
  if (value["kind"] !== "agentic-runtime") {
    throw new InvalidRuntimePackageError(
      `Runtime package "${expected.package_name}" has invalid kind; expected "agentic-runtime".`,
    )
  }
  if (value["api_version"] !== 1) {
    throw new InvalidRuntimePackageError(
      `Runtime package "${expected.package_name}" has unsupported api_version; expected 1.`,
    )
  }
  if (value["name"] !== expected.name) {
    throw new InvalidRuntimePackageError(
      `Runtime package "${expected.package_name}" declares name "${String(value["name"])}"; expected "${expected.name}".`,
    )
  }
  if (value["package_name"] !== expected.package_name) {
    throw new InvalidRuntimePackageError(
      `Runtime package "${expected.package_name}" declares package_name "${String(value["package_name"])}".`,
    )
  }
  if (!Array.isArray(value["capabilities"]) || !value["capabilities"].every((item) => typeof item === "string")) {
    throw new InvalidRuntimePackageError(
      `Runtime package "${expected.package_name}" must declare string capabilities.`,
    )
  }
  if (!isRecord(value["commands"])) {
    throw new InvalidRuntimePackageError(
      `Runtime package "${expected.package_name}" must declare a commands object.`,
    )
  }

  const commands = value["commands"]
  for (const command of ["init", "run", "status", "dev", "deploy"]) {
    const handler = commands[command]
    if (handler !== undefined && typeof handler !== "function") {
      throw new InvalidRuntimePackageError(
        `Runtime package "${expected.package_name}" command "${command}" must be a function.`,
      )
    }
  }

  return value as AgenticRuntimePackage
}

async function loadRuntimePackage(
  baseDir: string,
  runtime: ResolvedRuntime,
): Promise<AgenticRuntimePackage> {
  const entry = resolveRuntimePackage(baseDir, runtime.package_name)
  let imported: unknown
  try {
    imported = await import(pathToFileURL(entry).href)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new InvalidRuntimePackageError(
      `Could not load runtime package "${runtime.package_name}": ${message}`,
    )
  }

  const moduleRecord = isRecord(imported) ? imported : {}
  const manifest = moduleRecord["runtime"] ?? moduleRecord["default"]
  return validateRuntimePackage(manifest, runtime)
}

async function discoverRuntimePackage(
  baseDir: string,
  runtime: ResolvedRuntime,
): Promise<RuntimeDiscovery> {
  try {
    return { ok: true, manifest: await loadRuntimePackage(baseDir, runtime) }
  } catch (err) {
    if (err instanceof MissingRuntimePackageError) {
      return { ok: false, reason: "missing", message: err.message }
    }
    if (err instanceof InvalidRuntimePackageError) {
      return { ok: false, reason: "invalid", message: err.message }
    }
    throw err
  }
}

function runtimeSkillsSource(baseDir: string): LayeredSource {
  return new LayeredSource([
    new NestedFileSource(resolveProjectDir(baseDir, "skills"), "skill.md"),
    new NestedFileSource(resolveGlobalDir("skills"), "skill.md"),
  ])
}

function runtimeContext(ctx: Ctx, runtime: ResolvedRuntime) {
  return {
    cwd: ctx.baseDir,
    workspace_root: ctx.baseDir,
    runtime_name: runtime.name,
    runtime_package: runtime.package_name,
    json: ctx.json,
    env: process.env,
    config: ctx.config,
    runtime_config: runtime.runtime_config,
    agentic: {
      memory: ctx.adapter,
      workflows: new FilesystemWorkflowAdapter(ctx.baseDir),
      personas: new FilesystemPersonaAdapter(ctx.baseDir),
      skills: runtimeSkillsSource(ctx.baseDir),
      artifacts: new FilesystemArtifactAdapter(ctx.baseDir),
    },
  }
}

function supportedRuntimeCommands(manifest: AgenticRuntimePackage): string[] {
  return Object.entries(manifest.commands)
    .filter(([, handler]) => typeof handler === "function")
    .map(([name]) => name)
    .sort()
}

async function loadRuntimeForDelegation(
  ctx: Ctx,
  runtime: ResolvedRuntime,
): Promise<AgenticRuntimePackage> {
  const discovery = await discoverRuntimePackage(ctx.baseDir, runtime)
  if (!discovery.ok) {
    if (discovery.reason === "missing") throw missingPackageError(runtime)
    throw new Error(discovery.message)
  }
  return discovery.manifest
}

async function delegateRuntimeCommand(
  ctx: Ctx,
  command: "init" | "run" | "status",
  runtime: ResolvedRuntime,
  args: RuntimeInitArgs | RuntimeRunArgs | RuntimeStatusArgs,
): Promise<void> {
  const manifest = await loadRuntimeForDelegation(ctx, runtime)
  const handler = manifest.commands[command]
  if (handler === undefined) {
    const supported = supportedRuntimeCommands(manifest).join(", ") || "none"
    throw new Error(
      `Runtime "${runtime.name}" does not support command "${command}". Supported commands: ${supported}.`,
    )
  }

  const result = await handler(runtimeContext(ctx, runtime), args as never)
  const message = result?.summary ?? `Runtime "${runtime.name}" ${command} completed.`
  output(
    ctx,
    runtimeAction(command, runtimeRef(runtime, "configured", manifest), "delegated", message, {
      target: "target" in args ? args.target : undefined,
      result: result ?? undefined,
    }),
    formatRuntimeAction,
  )
}

export const runtimeHelpCommand: Command = async (ctx) => {
  output(ctx, RUNTIME_HELP, formatRuntimeHelp)
}

export const runtimeListCommand: Command = async (ctx) => {
  const runtimes: RuntimeRef[] = []
  for (const official of OFFICIAL_RUNTIMES) {
    const runtime = resolveRuntime(ctx, official.name)
    const discovery = await discoverRuntimePackage(ctx.baseDir, runtime)
    if (discovery.ok) {
      runtimes.push(
        runtimeRef(
          runtime,
          runtime.configured ? "configured" : "installed",
          discovery.manifest,
        ),
      )
    } else if (discovery.reason === "invalid") {
      runtimes.push(runtimeRef(runtime, "invalid_manifest", undefined, discovery.message))
    } else {
      runtimes.push(runtimeRef(runtime, runtime.configured ? "missing_package" : "available"))
    }
  }

  const result: RuntimeListOutput = {
    runtimes,
    note: PACKAGE_DISCOVERY_NOTE,
  }
  output(ctx, result, formatRuntimeList)
}

export const runtimeAddCommand: Command = async (ctx, args) => {
  const name = args[0]
  if (name === undefined) throw new Error("Usage: agentic runtime add <name>")

  const official = getOfficialRuntime(name)
  const runtime: ResolvedRuntime = {
    ...official,
    configured: true,
    runtime_config: runtimeConfig(ctx).targets[name]?.config ?? {},
  }
  const discovery = await discoverRuntimePackage(ctx.baseDir, runtime)

  if (!discovery.ok && discovery.reason === "invalid") {
    throw new Error(discovery.message)
  }

  const configPath = await writeRuntimeConfig(ctx.baseDir, official.name, official.package_name)

  if (!discovery.ok) {
    const result = runtimeAction(
      "add",
      runtimeRef(runtime, "missing_package"),
      "needs_package",
      `Recorded runtime target "${runtime.name}" in ${configPath}, but the package is not installed yet.`,
      { next_steps: missingPackageSteps(runtime) },
    )
    output(ctx, result, formatRuntimeAction)
    return
  }

  const result = runtimeAction(
    "add",
    runtimeRef(runtime, "configured", discovery.manifest),
    "added",
    `Recorded runtime target "${runtime.name}" in ${configPath}.`,
    {
      result: {
        summary: `Loaded ${discovery.manifest.package_name}.`,
        data: {
          config_path: configPath,
          manifest: {
            name: discovery.manifest.name,
            package_name: discovery.manifest.package_name,
            capabilities: discovery.manifest.capabilities,
          },
        },
      },
    },
  )
  output(ctx, result, formatRuntimeAction)
}

export const runtimeInitCommand: Command = async (ctx, args, flags) => {
  const name = args[0] ?? defaultRuntimeName(ctx)
  const runtime = resolveRuntime(ctx, name)
  await delegateRuntimeCommand(ctx, "init", runtime, {
    args: args[0] === undefined ? [] : args.slice(1),
    flags,
  })
}

export const runtimeRunCommand: Command = async (ctx, args, flags) => {
  const runtime = resolveRuntime(ctx, defaultRuntimeName(ctx))
  await delegateRuntimeCommand(ctx, "run", runtime, {
    target: args[0],
    args: args.slice(1),
    flags,
  })
}

export const runtimeStatusCommand: Command = async (ctx, args, flags) => {
  const runtime = resolveRuntime(ctx, args[0] ?? defaultRuntimeName(ctx))
  const discovery = await discoverRuntimePackage(ctx.baseDir, runtime)
  if (!discovery.ok && discovery.reason === "missing") {
    const configuredState = runtime.configured ? "configured" : "known"
    const result = runtimeAction(
      "status",
      runtimeRef(runtime, "missing_package"),
      "needs_package",
      `Runtime target "${runtime.name}" is ${configuredState}, but the package is not installed yet.`,
      { next_steps: missingPackageSteps(runtime) },
    )
    output(ctx, result, formatRuntimeAction)
    return
  }
  if (!discovery.ok) throw new Error(discovery.message)

  await delegateRuntimeCommand(ctx, "status", runtime, {
    args: args[0] === undefined ? [] : args.slice(1),
    flags,
  })
}
