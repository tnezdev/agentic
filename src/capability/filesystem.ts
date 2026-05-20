import { join } from "node:path"
import { resolveProjectDir, resolveGlobalDir } from "../resolve-dir.js"
import type { CapabilityDef } from "../types.js"
import type { Source } from "../sources/source.js"
import { LayeredSource } from "../sources/layered.js"
import { FlatFileSource } from "../sources/flat-file.js"
import { validateCapability } from "./helpers.js"

// ---------------------------------------------------------------------------
// JSON parser — dependency-free
// ---------------------------------------------------------------------------

/**
 * Parse a capability declaration from raw JSON text. Returns `undefined` for
 * malformed JSON or a declaration that fails structural validation — matching
 * the "return undefined rather than throw" convention of the skill loader.
 */
function parseCapability(text: string): CapabilityDef | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const result = validateCapability(parsed)
  if (!result.valid) return undefined
  return parsed as CapabilityDef
}

// ---------------------------------------------------------------------------
// Source-based API — works with any pluggable Source
// ---------------------------------------------------------------------------

/**
 * List all capabilities exposed by the given source. Skips records whose
 * JSON is malformed or fails validation — those are surfaced quietly rather
 * than throwing, matching `loadCapabilityFromSource`'s "return undefined for
 * malformed" semantics.
 */
export async function listCapabilitiesFromSource(
  source: Source,
): Promise<CapabilityDef[]> {
  const names = await source.list()
  const defs: CapabilityDef[] = []

  for (const name of names) {
    const record = await source.read(name)
    if (record === undefined) continue

    const def = parseCapability(record.text)
    if (def !== undefined) defs.push(def)
  }

  return defs.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Load a single capability by name from a source. Returns `undefined` if
 * the name is not found or the declaration is malformed.
 */
export async function loadCapabilityFromSource(
  name: string,
  source: Source,
): Promise<CapabilityDef | undefined> {
  const record = await source.read(name)
  if (record === undefined) return undefined
  return parseCapability(record.text)
}

// ---------------------------------------------------------------------------
// Convenience API — filesystem layering of project + global capabilities
// ---------------------------------------------------------------------------

function globalCapabilitiesDir(): string {
  return resolveGlobalDir("capabilities")
}

function projectCapabilitiesDir(baseDir: string): string {
  return resolveProjectDir(baseDir, "capabilities")
}

function defaultFilesystemSource(baseDir: string): Source {
  return new LayeredSource([
    new FlatFileSource(projectCapabilitiesDir(baseDir), ".json"),
    new FlatFileSource(globalCapabilitiesDir(), ".json"),
  ])
}

/**
 * List all available capabilities. Project capabilities
 * (`.agentic/capabilities/`) override global capabilities
 * (`~/.agentic/capabilities/`) when names conflict. `.spores/` directories
 * are used as a fallback for legacy projects.
 */
export async function listCapabilities(baseDir: string): Promise<CapabilityDef[]> {
  return listCapabilitiesFromSource(defaultFilesystemSource(baseDir))
}

/**
 * Load a capability by name. Returns `undefined` if not found.
 * Project capabilities take precedence over global capabilities.
 */
export async function loadCapability(
  name: string,
  baseDir: string,
): Promise<CapabilityDef | undefined> {
  return loadCapabilityFromSource(name, defaultFilesystemSource(baseDir))
}
