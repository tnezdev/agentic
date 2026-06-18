import type { Dirent, Stats } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import {
  loadAgenticBundle,
  loadAgenticBundleManifest,
  type LoadedAgenticBundle,
  type LoadedAgenticBundleData,
  type LoadedAgenticBundleManifest,
} from "../../bundle/filesystem.js"
import type { JsonObject } from "../../types.js"
import { resolveBundleRoot, workspaceRootForBundleRoot } from "../bundle-root.js"
import type { Command } from "../context.js"
import { parseAgenticEvalDeclaration, type ParsedAgenticEvalDeclaration } from "../eval-declaration.js"
import {
  formatAgenticEval,
  type AgenticEvalCaseResult,
  type AgenticEvalCheck,
  type AgenticEvalMessage,
  type AgenticEvalResult,
} from "../format.js"
import { output } from "../output.js"

type SelectedRun = {
  runId: string
  runPath: string
}

type RuntimeRecords = {
  actions: JsonObject[]
  artifacts: JsonObject[]
  errors: AgenticEvalMessage[]
}

type DirectoryReadResult =
  | { ok: true; entries: Dirent<string>[] }
  | { ok: false; error: AgenticEvalMessage }

type RuntimeJsonReadResult =
  | { ok: true; value: JsonObject }
  | { ok: false; error: AgenticEvalMessage }

type OptionalRuntimeJsonReadResult =
  | { ok: true; value: JsonObject | null }
  | { ok: false; error: AgenticEvalMessage }

export const evalCommand: Command = async (ctx, args, flags) => {
  if (args.length > 1) throw new Error("Usage: agentic eval [path] [--eval <id>] [--run <run-id>]")

  const evalId = stringFlag(flags, "eval")
  const runId = stringFlag(flags, "run")
  const root = resolveBundleRoot(ctx.baseDir, args[0])
  const result = await evaluateBundle(root, { evalId, runId })
  output(ctx, result, formatAgenticEval)
  if (!result.ok) process.exitCode = 1
}

export async function evaluateBundle(
  root: string,
  selection: { evalId?: string | undefined; runId?: string | undefined },
): Promise<AgenticEvalResult> {
  let loadedManifest: LoadedAgenticBundleManifest
  try {
    loadedManifest = await loadAgenticBundleManifest(root)
  } catch (error) {
    const result = baseResult(root)
    result.errors.push(loadError(error, manifestErrorField(error)))
    return result
  }

  let bundle: LoadedAgenticBundle
  try {
    bundle = await loadAgenticBundle(root)
  } catch (error) {
    const result = baseResult(root, loadedManifest)
    result.errors.push(loadError(error, bundleErrorField(error)))
    return result
  }

  const result = baseResult(bundle.root, loadedManifest)
  const stateDir = resolve(workspaceRootForBundleRoot(bundle.root), bundle.manifest.state.dir)
  if (bundle.manifest.state.adapter !== "filesystem") {
    result.errors.push({
      field: "state.adapter",
      message: "eval only supports filesystem state on day one",
    })
    return result
  }

  const selectedEvals = selectEvalDeclarations(bundle.evals, selection.evalId)
  if (!Array.isArray(selectedEvals)) {
    result.errors.push(selectedEvals)
    return result
  }

  const run = await selectRun(stateDir, selection.runId)
  if ("field" in run) {
    result.errors.push(run)
    return result
  }

  result.state = {
    adapter: bundle.manifest.state.adapter,
    dir: stateDir,
    run_id: run.runId,
    run_path: run.runPath,
  }

  const records = await readRuntimeRecords(run)
  if (records.errors.length > 0) {
    result.errors.push(...records.errors)
    return result
  }

  const fixtureIds = new Set(bundle.fixtures.map((entry) => entry.id))
  result.evals = selectedEvals.map((id) => evaluateDeclaration(id, bundle.evals, fixtureIds, records))
  result.ok = result.errors.length === 0 && result.evals.every((entry) => entry.ok)
  return result
}

function baseResult(
  root: string,
  loadedManifest?: LoadedAgenticBundleManifest | undefined,
): AgenticEvalResult {
  return {
    command: "eval",
    ok: false,
    root,
    manifest_path: loadedManifest?.path ?? null,
    bundle: loadedManifest === undefined
      ? null
      : {
          name: loadedManifest.manifest.name,
          version: loadedManifest.manifest.version,
          schema_version: loadedManifest.manifest.schema_version,
        },
    state: null,
    evals: [],
    errors: [],
    warnings: [],
  }
}

function stringFlag(flags: Record<string, string | true>, name: string): string | undefined {
  const value = flags[name]
  if (value === undefined) return undefined
  if (value === true || value.trim() === "") {
    throw new Error(`Usage: agentic eval [path] --${name} <value>`)
  }
  return value
}

function selectEvalDeclarations(
  entries: LoadedAgenticBundleData[],
  evalId: string | undefined,
): string[] | AgenticEvalMessage {
  if (evalId !== undefined) {
    const entry = entries.find((item) => item.id === evalId)
    if (entry === undefined) {
      return { field: "eval", message: `unknown eval declaration: ${evalId}` }
    }
    return [entry.id]
  }

  if (entries.length === 0) return { field: "evals", message: "no eval declarations found" }
  return entries.map((entry) => entry.id)
}

async function selectRun(stateDir: string, explicitRunId: string | undefined): Promise<SelectedRun | AgenticEvalMessage> {
  const stateDirStat = await maybeStat(stateDir)
  if (stateDirStat === null) return { field: "state", message: `no local runtime state found at ${stateDir}` }
  if (!stateDirStat.isDirectory()) return { field: "state", message: `runtime state path is not a directory: ${stateDir}` }

  const runsDir = join(stateDir, "runs")
  const runsDirStat = await maybeStat(runsDir)
  if (runsDirStat === null) return { field: "state.runs", message: `no local runtime runs found at ${runsDir}` }
  if (!runsDirStat.isDirectory()) return { field: "state.runs", message: `runtime runs path is not a directory: ${runsDir}` }

  if (explicitRunId !== undefined) return selectRunById(runsDir, explicitRunId)

  const latest = await readOptionalRuntimeJson(join(stateDir, "latest.json"), "state.latest")
  if (!latest.ok) return latest.error
  const latestRunId = latest.value?.run_id
  if (typeof latestRunId === "string") return selectRunById(runsDir, latestRunId)

  const entries = await readDirectory(runsDir, "state.runs")
  if (!entries.ok) return entries.error
  const runIds = entries.entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const runId = runIds.at(-1)
  if (runId === undefined) return { field: "state.runs", message: `no run directories found at ${runsDir}` }
  return { runId, runPath: join(runsDir, runId) }
}

async function selectRunById(runsDir: string, runId: string): Promise<SelectedRun | AgenticEvalMessage> {
  const runPath = join(runsDir, runId)
  const runStat = await maybeStat(runPath)
  if (runStat === null) return { field: "state.run", message: `selected run not found: ${runId}` }
  if (!runStat.isDirectory()) return { field: "state.run", message: `selected run is not a directory: ${runId}` }
  return { runId, runPath }
}

async function readRuntimeRecords(run: SelectedRun): Promise<RuntimeRecords> {
  const actions = await readJsonObjects(join(run.runPath, "actions"), `state.runs.${run.runId}.actions`)
  const artifacts = await readJsonObjects(join(run.runPath, "artifacts"), `state.runs.${run.runId}.artifacts`)
  return {
    actions: actions.records,
    artifacts: artifacts.records,
    errors: actions.errors.concat(artifacts.errors),
  }
}

async function readJsonObjects(dir: string, field: string): Promise<{ records: JsonObject[]; errors: AgenticEvalMessage[] }> {
  const entries = await readDirectory(dir, field)
  if (!entries.ok) return { records: [], errors: [entries.error] }

  const records: JsonObject[] = []
  const errors: AgenticEvalMessage[] = []
  for (const entry of entries.entries.filter((item) => item.isFile() && extname(item.name) === ".json")) {
    const path = join(dir, entry.name)
    const record = await readRequiredRuntimeJson(path, `${field}.${basename(path)}`)
    if (!record.ok) {
      errors.push(record.error)
    } else {
      records.push(record.value)
    }
  }
  return { records, errors }
}

function evaluateDeclaration(
  id: string,
  evals: LoadedAgenticBundleData[],
  fixtureIds: Set<string>,
  records: RuntimeRecords,
): AgenticEvalCaseResult {
  const entry = evals.find((item) => item.id === id)
  if (entry === undefined) {
    return {
      id,
      ok: false,
      fixture: null,
      checks: [],
      errors: [{ field: `evals.${id}`, message: `eval declaration not loaded: ${id}` }],
    }
  }

  const parsed = parseAgenticEvalDeclaration(entry, fixtureIds)
  if (Array.isArray(parsed)) {
    return { id, ok: false, fixture: null, checks: [], errors: parsed }
  }

  const checks = evaluateChecks(parsed, records)
  const errors = checks.flatMap((check) => errorsForFailedCheck(parsed.id, check))
  return {
    id: parsed.id,
    ok: errors.length === 0,
    fixture: parsed.fixture,
    checks,
    errors,
  }
}

function evaluateChecks(parsed: ParsedAgenticEvalDeclaration, records: RuntimeRecords): AgenticEvalCheck[] {
  const checks: AgenticEvalCheck[] = []
  const artifactTypes = uniqueStringValues(records.artifacts, "type")
  const actionTypes = uniqueStringValues(records.actions, "type")

  if (parsed.expect.artifacts !== undefined) {
    checks.push(membershipCheck("artifacts", parsed.expect.artifacts, artifactTypes))
  }
  if (parsed.expect.actions !== undefined) {
    checks.push(membershipCheck("actions", parsed.expect.actions, actionTypes))
  }
  if (parsed.expect.approval_required !== undefined) {
    const actual = records.actions.some(
      (record) => record.type === parsed.expect.approval_required && record.status === "approval_required",
    ) ? parsed.expect.approval_required : null
    checks.push({
      name: "approval_required",
      ok: actual !== null,
      expected: parsed.expect.approval_required,
      actual,
    })
  }
  if (parsed.expect.external_write_executed !== undefined) {
    const approvalRequired = parsed.expect.approval_required
    const completed = approvalRequired === undefined
      ? false
      : records.actions.some((record) => record.type === approvalRequired && record.status === "completed")
    checks.push({
      name: "external_write_executed",
      ok: completed === parsed.expect.external_write_executed,
      expected: parsed.expect.external_write_executed,
      actual: completed,
    })
  }

  return checks
}

function membershipCheck(
  name: "artifacts" | "actions",
  expected: string[],
  actual: string[],
): AgenticEvalCheck {
  const missing = expected.filter((item) => !actual.includes(item))
  return { name, ok: missing.length === 0, expected, actual, missing }
}

function errorsForFailedCheck(evalId: string, check: AgenticEvalCheck): AgenticEvalMessage[] {
  if (check.ok) return []
  if ((check.name === "artifacts" || check.name === "actions") && check.missing !== undefined) {
    return [{
      field: `evals.${evalId}.expect.${check.name}`,
      message: `missing ${check.name.slice(0, -1)} types: ${check.missing.join(", ")}`,
    }]
  }
  if (check.name === "approval_required") {
    return [{
      field: `evals.${evalId}.expect.approval_required`,
      message: `missing approval_required action: ${String(check.expected)}`,
    }]
  }
  return [{
    field: `evals.${evalId}.expect.external_write_executed`,
    message: `expected external_write_executed to be ${String(check.expected)}`,
  }]
}

async function readOptionalRuntimeJson(path: string, field: string): Promise<OptionalRuntimeJsonReadResult> {
  let text: string
  try {
    text = await readFile(path, "utf-8")
  } catch (error) {
    if (isNotFound(error)) return { ok: true, value: null }
    return { ok: false, error: loadError(error, field) }
  }
  return parseRuntimeJson(text, field)
}

async function readRequiredRuntimeJson(path: string, field: string): Promise<RuntimeJsonReadResult> {
  let text: string
  try {
    text = await readFile(path, "utf-8")
  } catch (error) {
    return { ok: false, error: loadError(error, field) }
  }
  return parseRuntimeJson(text, field)
}

function parseRuntimeJson(text: string, field: string): RuntimeJsonReadResult {
  try {
    const value = JSON.parse(text) as unknown
    if (isJsonObject(value)) return { ok: true, value }
    return { ok: false, error: { field, message: "runtime JSON file must contain a non-null object" } }
  } catch (error) {
    return { ok: false, error: loadError(error, field) }
  }
}

async function readDirectory(dir: string, field: string): Promise<DirectoryReadResult> {
  try {
    return { ok: true, entries: await readdir(dir, { withFileTypes: true }) }
  } catch (error) {
    if (isNotFound(error)) return { ok: true, entries: [] }
    return { ok: false, error: loadError(error, field) }
  }
}

async function maybeStat(path: string): Promise<Stats | null> {
  try {
    return await stat(path)
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

function uniqueStringValues(records: JsonObject[], field: string): string[] {
  return [...new Set(records.map((record) => record[field]).filter((value): value is string => typeof value === "string"))]
    .sort((a, b) => a.localeCompare(b))
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function loadError(error: unknown, field: string): AgenticEvalMessage {
  return {
    field,
    message: error instanceof Error ? error.message : String(error),
  }
}

function manifestErrorField(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith("Missing bundle manifest") ? "bundle" : "manifest"
}

function bundleErrorField(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith("Missing bundle manifest")) return "bundle"
  if (message.startsWith("Invalid bundle manifest")) return "manifest"
  return "bundle_refs"
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
