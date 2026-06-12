import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig, parseToml, DEFAULTS } from "./config.js"

describe("parseToml", () => {
  it("parses top-level keys", () => {
    const doc = parseToml('adapter = "filesystem"')
    expect(doc["adapter"]).toBe("filesystem")
  })

  it("parses sections", () => {
    const doc = parseToml('[memory]\ndir = ".spores/memory"')
    expect((doc["memory"] as Record<string, string>)["dir"]).toBe(
      ".spores/memory",
    )
  })

  it("parses dotted sections", () => {
    const doc = parseToml(
      '[runtime.local]\npackage = "@tnezdev/agentic-runtime-local"',
    )
    expect((doc["runtime.local"] as Record<string, string>)["package"]).toBe(
      "@tnezdev/agentic-runtime-local",
    )
  })

  it("ignores comments and blank lines", () => {
    const doc = parseToml('# comment\n\nadapter = "test"')
    expect(doc["adapter"]).toBe("test")
  })
})

describe("loadConfig", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-config-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true })
  })

  it("returns defaults when no config files exist", async () => {
    const config = await loadConfig(tmpDir)
    expect(config.adapter).toBe(DEFAULTS.adapter)
    expect(config.memory.defaultTier).toBe(DEFAULTS.memory.defaultTier)
    expect(config.memory.dreamDepth).toBe(DEFAULTS.memory.dreamDepth)
  })

  it("project .spores config overrides defaults (legacy fallback)", async () => {
    await mkdir(join(tmpDir, ".spores"), { recursive: true })
    await writeFile(
      join(tmpDir, ".spores", "config.toml"),
      '[memory]\ndream_depth = "5"',
    )
    const config = await loadConfig(tmpDir)
    expect(config.memory.dreamDepth).toBe(5)
    expect(config.adapter).toBe(DEFAULTS.adapter)
  })

  it("project .agentic config overrides defaults", async () => {
    await mkdir(join(tmpDir, ".agentic"), { recursive: true })
    await writeFile(
      join(tmpDir, ".agentic", "config.toml"),
      '[memory]\ndream_depth = "7"',
    )
    const config = await loadConfig(tmpDir)
    expect(config.memory.dreamDepth).toBe(7)
  })

  it("loads runtime config and opaque runtime target keys", async () => {
    await mkdir(join(tmpDir, ".agentic"), { recursive: true })
    await writeFile(
      join(tmpDir, ".agentic", "config.toml"),
      '[runtime]\ndefault = "local"\n\n[runtime.local]\npackage = "@tnezdev/agentic-runtime-local"\nharness = "pi"\n',
    )

    const config = await loadConfig(tmpDir)
    expect(config.runtime!.default).toBe("local")
    expect(config.runtime!.targets["local"]!.package).toBe(
      "@tnezdev/agentic-runtime-local",
    )
    expect(config.runtime!.targets["local"]!.config).toEqual({ harness: "pi" })
  })

  it(".agentic config wins over .spores config when both exist", async () => {
    await mkdir(join(tmpDir, ".agentic"), { recursive: true })
    await writeFile(
      join(tmpDir, ".agentic", "config.toml"),
      '[memory]\ndream_depth = "9"',
    )
    await mkdir(join(tmpDir, ".spores"), { recursive: true })
    await writeFile(
      join(tmpDir, ".spores", "config.toml"),
      '[memory]\ndream_depth = "3"',
    )
    const config = await loadConfig(tmpDir)
    expect(config.memory.dreamDepth).toBe(9)
  })
})
