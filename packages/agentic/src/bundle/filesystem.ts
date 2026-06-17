import { readFile } from "node:fs/promises"
import { extname, isAbsolute, join } from "node:path"
import type {
  AgenticBundleManifest,
  AgenticBundleRef,
  JsonObject,
} from "../types.js"
import { parseYaml } from "../workflow/yaml.js"
import { validateAgenticBundleManifest } from "./manifest.js"

export const AGENTIC_BUNDLE_MANIFEST_FILENAMES: readonly string[] = [
  "agentic.yaml",
  "agentic.yml",
  "agentic.json",
] as const

export type LoadedAgenticBundleMarkdown = AgenticBundleRef & {
  locator: string
  content: string
}

export type LoadedAgenticBundleData = AgenticBundleRef & {
  locator: string
  data: JsonObject
}

export type LoadedAgenticBundleManifest = {
  path: string
  manifest: AgenticBundleManifest
}

export type LoadedAgenticBundle = {
  root: string
  manifestPath: string
  manifest: AgenticBundleManifest
  prompts: LoadedAgenticBundleMarkdown[]
  skills: LoadedAgenticBundleMarkdown[]
  artifacts: LoadedAgenticBundleData[]
  actions: LoadedAgenticBundleData[]
  capabilities: LoadedAgenticBundleData[]
  hooks: LoadedAgenticBundleData[]
  surfaces: LoadedAgenticBundleData[]
  schedules: LoadedAgenticBundleData[]
  integrations: LoadedAgenticBundleData[]
  policies: LoadedAgenticBundleData[]
  deploy: LoadedAgenticBundleData[]
  evals: LoadedAgenticBundleData[]
  fixtures: LoadedAgenticBundleData[]
}

export async function loadAgenticBundleManifest(root: string): Promise<LoadedAgenticBundleManifest> {
  for (const filename of AGENTIC_BUNDLE_MANIFEST_FILENAMES) {
    const path = join(root, filename)
    try {
      const manifest = await readAuthoredObject<AgenticBundleManifest>(path)
      const result = validateAgenticBundleManifest(manifest)
      if (!result.valid) {
        const details = result.errors.map((error) => `${error.field}: ${error.message}`).join("; ")
        throw new Error(`Invalid bundle manifest ${path}: ${details}`)
      }
      return { path, manifest }
    } catch (error) {
      if (isNotFound(error)) continue
      throw error
    }
  }

  throw new Error(`Missing bundle manifest. Expected one of: ${AGENTIC_BUNDLE_MANIFEST_FILENAMES.join(", ")}`)
}

export async function loadAgenticBundle(root: string): Promise<LoadedAgenticBundle> {
  const { path: manifestPath, manifest } = await loadAgenticBundleManifest(root)
  return {
    root,
    manifestPath,
    manifest,
    prompts: await loadAgenticBundleMarkdownSection(root, manifest.prompts, "prompts"),
    skills: await loadAgenticBundleMarkdownSection(root, manifest.skills, "skills"),
    artifacts: await loadAgenticBundleDataSection(root, manifest.artifacts, "artifacts"),
    actions: await loadAgenticBundleDataSection(root, manifest.actions, "actions"),
    capabilities: await loadAgenticBundleDataSection(root, manifest.capabilities, "capabilities"),
    hooks: await loadAgenticBundleDataSection(root, manifest.hooks, "hooks"),
    surfaces: await loadAgenticBundleDataSection(root, manifest.surfaces, "surfaces"),
    schedules: await loadAgenticBundleDataSection(root, manifest.schedules, "schedules"),
    integrations: await loadAgenticBundleDataSection(root, manifest.integrations, "integrations"),
    policies: await loadAgenticBundleDataSection(root, manifest.policies, "policies"),
    deploy: await loadAgenticBundleDataSection(root, manifest.deploy, "deploy"),
    evals: await loadAgenticBundleDataSection(root, manifest.evals, "evals"),
    fixtures: await loadAgenticBundleDataSection(root, manifest.fixtures, "fixtures"),
  }
}

export async function loadAgenticBundleMarkdownSection(
  root: string,
  refs: readonly AgenticBundleRef[],
  section = "section",
): Promise<LoadedAgenticBundleMarkdown[]> {
  const loaded: LoadedAgenticBundleMarkdown[] = []
  for (const ref of refs) {
    const path = resolveBundleRef(root, ref.path, `${section}.${ref.id}`)
    try {
      loaded.push({ ...ref, locator: path, content: await readFile(path, "utf-8") })
    } catch (error) {
      if (isNotFound(error)) throw new Error(`Missing bundle markdown file for ${section}.${ref.id}: ${path}`)
      throw error
    }
  }
  return loaded
}

export async function loadAgenticBundleDataSection(
  root: string,
  refs: readonly AgenticBundleRef[],
  section = "section",
): Promise<LoadedAgenticBundleData[]> {
  const loaded: LoadedAgenticBundleData[] = []
  for (const ref of refs) {
    const path = resolveBundleRef(root, ref.path, `${section}.${ref.id}`)
    let data: JsonObject
    try {
      data = await readAuthoredObject<JsonObject>(path)
    } catch (error) {
      if (isNotFound(error)) throw new Error(`Missing bundle data file for ${section}.${ref.id}: ${path}`)
      throw error
    }

    if (data.id !== ref.id) {
      throw new Error(`Declaration id mismatch for ${ref.path}: manifest has ${ref.id}, file has ${String(data.id)}`)
    }
    loaded.push({ ...ref, locator: path, data })
  }
  return loaded
}

export async function readAuthoredObject<T = JsonObject>(path: string): Promise<T> {
  const text = await readFile(path, "utf-8")
  const ext = extname(path)
  if (ext === ".json") {
    try {
      return assertJsonObject(JSON.parse(text), path) as unknown as T
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Invalid JSON data file ${path}: ${error.message}`)
      throw error
    }
  }
  if (ext === ".yaml" || ext === ".yml") {
    return assertJsonObject(parseYaml(text), path) as unknown as T
  }

  throw new Error(`Unsupported authored data file extension for ${path}. Expected .json, .yaml, or .yml.`)
}

function resolveBundleRef(root: string, path: string, field: string): string {
  if (path.trim() === "") throw new Error(`${field}.path must be a non-empty relative path`)
  if (isAbsolute(path) || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new Error(`${field}.path must be relative`)
  }
  const segments = path.split(/[\\/]+/).filter((segment) => segment.length > 0)
  if (segments.includes("..")) throw new Error(`${field}.path must not traverse parent directories`)
  return join(root, path)
}

function assertJsonObject(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Authored data file ${path} must contain a non-null mapping.`)
  }
  return value as JsonObject
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
