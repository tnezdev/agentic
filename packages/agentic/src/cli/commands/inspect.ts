import { Buffer } from "node:buffer"
import type { Dirent, Stats } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import {
  loadAgenticBundle,
  loadAgenticBundleManifest,
  type LoadedAgenticBundle,
  type LoadedAgenticBundleData,
  type LoadedAgenticBundleManifest,
  type LoadedAgenticBundleMarkdown,
} from "../../bundle/filesystem.js"
import type { AgenticBundleSectionName, JsonObject } from "../../types.js"
import { resolveBundleRoot, workspaceRootForBundleRoot } from "../bundle-root.js"
import type { Command } from "../context.js"
import {
  formatAgenticInspect,
  type AgenticInspectInventorySection,
  type AgenticInspectMessage,
  type AgenticInspectResult,
  type AgenticInspectRunState,
  type AgenticInspectState,
} from "../format.js"
import { output } from "../output.js"

type MarkdownSectionName = Extract<AgenticBundleSectionName, "prompts" | "skills">
type DataSectionName = Exclude<AgenticBundleSectionName, MarkdownSectionName>

const MARKDOWN_SECTIONS: readonly MarkdownSectionName[] = ["prompts", "skills"]
const DATA_SECTIONS: readonly DataSectionName[] = [
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
]

export const inspectCommand: Command = async (ctx, args) => {
  if (args.length > 1) throw new Error("Usage: agentic inspect [path]")

  const root = resolveBundleRoot(ctx.baseDir, args[0])
  const result = await inspectBundle(root)
  output(ctx, result, formatAgenticInspect)
  if (!result.ok) process.exitCode = 1
}

export async function inspectBundle(root: string): Promise<AgenticInspectResult> {
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

  const warnings: AgenticInspectMessage[] = []
  const state = await inspectState(bundle, warnings)
  return {
    command: "inspect",
    ok: true,
    root: bundle.root,
    manifest_path: bundle.manifestPath,
    bundle: {
      name: bundle.manifest.name,
      version: bundle.manifest.version,
      schema_version: bundle.manifest.schema_version,
      description: bundle.manifest.description,
    },
    inventory: buildInventory(bundle),
    state,
    errors: [],
    warnings,
  }
}

function baseResult(
  root: string,
  loadedManifest?: LoadedAgenticBundleManifest | undefined,
): AgenticInspectResult {
  return {
    command: "inspect",
    ok: false,
    root,
    manifest_path: loadedManifest?.path ?? null,
    bundle: loadedManifest === undefined
      ? null
      : {
          name: loadedManifest.manifest.name,
          version: loadedManifest.manifest.version,
          schema_version: loadedManifest.manifest.schema_version,
          description: loadedManifest.manifest.description,
        },
    inventory: null,
    state: null,
    errors: [],
    warnings: [],
  }
}

function buildInventory(bundle: LoadedAgenticBundle): NonNullable<AgenticInspectResult["inventory"]> {
  const sections: AgenticInspectInventorySection[] = []
  for (const name of MARKDOWN_SECTIONS) {
    sections.push(markdownInventorySection(name, bundle[name]))
  }
  for (const name of DATA_SECTIONS) {
    sections.push(dataInventorySection(name, bundle[name]))
  }

  const markdownEntries = sections
    .filter((section) => section.kind === "markdown")
    .reduce((sum, section) => sum + section.count, 0)
  const dataEntries = sections
    .filter((section) => section.kind === "data")
    .reduce((sum, section) => sum + section.count, 0)

  return {
    sections,
    totals: {
      sections: sections.length,
      entries: markdownEntries + dataEntries,
      markdown_entries: markdownEntries,
      data_entries: dataEntries,
    },
  }
}

function markdownInventorySection(
  name: MarkdownSectionName,
  entries: LoadedAgenticBundleMarkdown[],
): AgenticInspectInventorySection {
  return {
    name,
    kind: "markdown",
    count: entries.length,
    entries: entries.map((entry) => ({
      id: entry.id,
      path: entry.path,
      locator: entry.locator,
      bytes: Buffer.byteLength(entry.content, "utf-8"),
    })),
  }
}

function dataInventorySection(
  name: DataSectionName,
  entries: LoadedAgenticBundleData[],
): AgenticInspectInventorySection {
  return {
    name,
    kind: "data",
    count: entries.length,
    entries: entries.map((entry) => ({
      id: entry.id,
      path: entry.path,
      locator: entry.locator,
    })),
  }
}

async function inspectState(
  bundle: LoadedAgenticBundle,
  warnings: AgenticInspectMessage[],
): Promise<AgenticInspectState> {
  const workspaceRoot = workspaceRootForBundleRoot(bundle.root)
  const stateDir = resolve(workspaceRoot, bundle.manifest.state.dir)
  if (bundle.manifest.state.adapter !== "filesystem") {
    warnings.push({
      field: "state.adapter",
      message: "inspect only supports filesystem state on day one",
    })
    return emptyState(bundle.manifest.state.adapter, stateDir, false)
  }

  const stateDirStat = await maybeStat(stateDir, warnings, "state.dir")
  if (stateDirStat === null) return emptyState(bundle.manifest.state.adapter, stateDir, false)
  if (!stateDirStat.isDirectory()) {
    warnings.push({ field: "state.dir", message: "runtime state path is not a directory" })
    return emptyState(bundle.manifest.state.adapter, stateDir, true)
  }

  const latest = await readRuntimeJson(join(stateDir, "latest.json"), warnings, "state.latest")
  const runEntries = await readDirectory(join(stateDir, "runs"), warnings, "state.runs")
  const runs: AgenticInspectRunState[] = []
  for (const entry of runEntries.filter((item) => item.isDirectory())) {
    runs.push(await inspectRun(join(stateDir, "runs", entry.name), entry.name, warnings))
  }

  sortRuns(runs, latest)
  return stateWithRuns(bundle.manifest.state.adapter, stateDir, true, latest, runs)
}

async function inspectRun(
  runDir: string,
  runId: string,
  warnings: AgenticInspectMessage[],
): Promise<AgenticInspectRunState> {
  const summaryPath = join(runDir, "summary.md")
  const actionLogPath = join(runDir, "actions.jsonl")
  const actionFiles = await listJsonFiles(join(runDir, "actions"), warnings, `state.runs.${runId}.actions`)
  const artifactFiles = await listJsonFiles(join(runDir, "artifacts"), warnings, `state.runs.${runId}.artifacts`)

  let completed = 0
  let denied = 0
  let approvalRequired = 0
  for (const path of actionFiles) {
    const record = await readRuntimeJson(path, warnings, `state.runs.${runId}.actions.${basename(path)}`)
    const status = record?.status
    if (status === "completed") completed++
    if (status === "denied") denied++
    if (status === "approval_required") approvalRequired++
  }

  let approvalRequests = 0
  for (const path of artifactFiles) {
    const record = await readRuntimeJson(path, warnings, `state.runs.${runId}.artifacts.${basename(path)}`)
    if (record?.type === "approval-request") approvalRequests++
  }

  return {
    id: runId,
    path: runDir,
    summary_path: await fileExists(summaryPath) ? summaryPath : null,
    action_log_path: await fileExists(actionLogPath) ? actionLogPath : null,
    actions: {
      count: actionFiles.length,
      completed,
      denied,
      approval_required: approvalRequired,
    },
    artifacts: {
      count: artifactFiles.length,
      approval_requests: approvalRequests,
    },
  }
}

function emptyState(adapter: string, dir: string, exists: boolean): AgenticInspectState {
  return stateWithRuns(adapter, dir, exists, null, [])
}

function stateWithRuns(
  adapter: string,
  dir: string,
  exists: boolean,
  latest: JsonObject | null,
  runs: AgenticInspectRunState[],
): AgenticInspectState {
  return {
    adapter,
    dir,
    exists,
    latest,
    runs: {
      count: runs.length,
      entries: runs,
    },
    totals: runs.reduce(
      (totals, run) => ({
        actions: totals.actions + run.actions.count,
        completed_actions: totals.completed_actions + run.actions.completed,
        denied_actions: totals.denied_actions + run.actions.denied,
        approval_required_actions: totals.approval_required_actions + run.actions.approval_required,
        artifacts: totals.artifacts + run.artifacts.count,
        approval_request_artifacts: totals.approval_request_artifacts + run.artifacts.approval_requests,
      }),
      {
        actions: 0,
        completed_actions: 0,
        denied_actions: 0,
        approval_required_actions: 0,
        artifacts: 0,
        approval_request_artifacts: 0,
      },
    ),
  }
}

function sortRuns(runs: AgenticInspectRunState[], latest: JsonObject | null): void {
  const latestRunId = latest?.run_id
  runs.sort((a, b) => {
    if (typeof latestRunId === "string") {
      if (a.id === latestRunId && b.id !== latestRunId) return -1
      if (b.id === latestRunId && a.id !== latestRunId) return 1
    }
    return b.id.localeCompare(a.id)
  })
}

async function listJsonFiles(
  dir: string,
  warnings: AgenticInspectMessage[],
  field: string,
): Promise<string[]> {
  const entries = await readDirectory(dir, warnings, field)
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".json")
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

async function readDirectory(
  dir: string,
  warnings: AgenticInspectMessage[],
  field: string,
): Promise<Dirent<string>[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    warnings.push({ field, message: error instanceof Error ? error.message : String(error) })
    return []
  }
}

async function readRuntimeJson(
  path: string,
  warnings: AgenticInspectMessage[],
  field: string,
): Promise<JsonObject | null> {
  let text: string
  try {
    text = await readFile(path, "utf-8")
  } catch (error) {
    if (isNotFound(error)) return null
    warnings.push({ field, message: error instanceof Error ? error.message : String(error) })
    return null
  }

  try {
    const value = JSON.parse(text) as unknown
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as JsonObject
    warnings.push({ field, message: "runtime JSON file must contain a non-null object" })
  } catch (error) {
    warnings.push({ field, message: error instanceof Error ? error.message : String(error) })
  }
  return null
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const entry = await stat(path)
    return entry.isFile()
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

async function maybeStat(
  path: string,
  warnings: AgenticInspectMessage[],
  field: string,
): Promise<Stats | null> {
  try {
    return await stat(path)
  } catch (error) {
    if (isNotFound(error)) return null
    warnings.push({ field, message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

function loadError(error: unknown, field: string): AgenticInspectMessage {
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
