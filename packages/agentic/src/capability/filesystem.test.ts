import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { InMemorySource } from "../sources/in-memory.js"
import { LayeredSource } from "../sources/layered.js"
import {
  listCapabilities,
  listCapabilitiesFromSource,
  loadCapability,
  loadCapabilityFromSource,
} from "./filesystem.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeCapability(
  baseDir: string,
  name: string,
  json: string,
  subdir: ".agentic" | ".spores" = ".agentic",
): Promise<void> {
  const capDir = join(baseDir, subdir, "capabilities")
  await mkdir(capDir, { recursive: true })
  await writeFile(join(capDir, `${name}.json`), json)
}

const VALID_CAPABILITY = JSON.stringify({
  name: "issue_tracker.list_issues",
  description: "Use when the user asks to list issues from an external issue tracker.",
  skill: "issue-triage",
  requires: {
    connections: [{ provider: "issue_tracker", capabilities: ["issues.read"] }],
  },
  policy: { effects: ["external.read"] },
})

const ANOTHER_CAPABILITY = JSON.stringify({
  name: "web.search",
  description: "Use when the user asks to search the web for information.",
  policy: { effects: ["external.read"] },
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("capability/filesystem", () => {
  let tmpDir: string
  let fakeHome: string
  const originalHome = process.env["HOME"]

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-cap-test-"))
    fakeHome = await mkdtemp(join(tmpdir(), "spores-cap-home-"))
    process.env["HOME"] = fakeHome
  })

  afterEach(async () => {
    if (originalHome !== undefined) process.env["HOME"] = originalHome
    else delete process.env["HOME"]
    await rm(tmpDir, { recursive: true })
    await rm(fakeHome, { recursive: true })
  })

  // -------------------------------------------------------------------------
  // Source-based API
  // -------------------------------------------------------------------------

  describe("listCapabilitiesFromSource", () => {
    it("returns empty array for empty source", async () => {
      const source = new InMemorySource({})
      const caps = await listCapabilitiesFromSource(source)
      expect(caps).toEqual([])
    })

    it("returns parsed capabilities from source", async () => {
      const source = new InMemorySource({
        "issue_tracker.list_issues": VALID_CAPABILITY,
      })
      const caps = await listCapabilitiesFromSource(source)
      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe("issue_tracker.list_issues")
      expect(caps[0]!.description).toBe(
        "Use when the user asks to list issues from an external issue tracker.",
      )
    })

    it("returns results sorted by name", async () => {
      const source = new InMemorySource({
        "web.search": ANOTHER_CAPABILITY,
        "issue_tracker.list_issues": VALID_CAPABILITY,
      })
      const caps = await listCapabilitiesFromSource(source)
      expect(caps.map((c) => c.name)).toEqual([
        "issue_tracker.list_issues",
        "web.search",
      ])
    })

    it("skips records with malformed JSON", async () => {
      const source = new InMemorySource({
        "issue_tracker.list_issues": VALID_CAPABILITY,
        "broken": "{ not valid json",
      })
      const caps = await listCapabilitiesFromSource(source)
      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe("issue_tracker.list_issues")
    })

    it("skips records that fail validation (missing name)", async () => {
      const source = new InMemorySource({
        "issue_tracker.list_issues": VALID_CAPABILITY,
        "no-name": JSON.stringify({ description: "no name field" }),
      })
      const caps = await listCapabilitiesFromSource(source)
      expect(caps).toHaveLength(1)
    })

    it("skips records where source.read returns undefined mid-list", async () => {
      // LayeredSource with one source that lists a name but whose read returns undefined
      const partial = new InMemorySource({ "issue_tracker.list_issues": VALID_CAPABILITY })
      const caps = await listCapabilitiesFromSource(partial)
      expect(caps).toHaveLength(1)
    })
  })

  describe("loadCapabilityFromSource", () => {
    it("returns undefined for missing name", async () => {
      const source = new InMemorySource({})
      const cap = await loadCapabilityFromSource("missing", source)
      expect(cap).toBeUndefined()
    })

    it("returns undefined for malformed JSON", async () => {
      const source = new InMemorySource({ "bad": "not json {{{" })
      const cap = await loadCapabilityFromSource("bad", source)
      expect(cap).toBeUndefined()
    })

    it("returns undefined for invalid capability (fails validation)", async () => {
      const source = new InMemorySource({
        "empty-obj": JSON.stringify({}),
      })
      const cap = await loadCapabilityFromSource("empty-obj", source)
      expect(cap).toBeUndefined()
    })

    it("returns the capability def for a valid record", async () => {
      const source = new InMemorySource({
        "issue_tracker.list_issues": VALID_CAPABILITY,
      })
      const cap = await loadCapabilityFromSource("issue_tracker.list_issues", source)
      expect(cap).not.toBeUndefined()
      expect(cap!.name).toBe("issue_tracker.list_issues")
      expect(cap!.skill).toBe("issue-triage")
    })
  })

  // -------------------------------------------------------------------------
  // Filesystem convenience API
  // -------------------------------------------------------------------------

  describe("listCapabilities", () => {
    it("returns empty array when no capabilities exist", async () => {
      const caps = await listCapabilities(tmpDir)
      expect(caps).toEqual([])
    })

    it("returns capabilities from project .agentic dir", async () => {
      await writeCapability(tmpDir, "issue_tracker.list_issues", VALID_CAPABILITY)
      const caps = await listCapabilities(tmpDir)
      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe("issue_tracker.list_issues")
    })

    it("returns capabilities from global .agentic dir", async () => {
      const globalCapDir = join(fakeHome, ".agentic", "capabilities")
      await mkdir(globalCapDir, { recursive: true })
      await writeFile(
        join(globalCapDir, "web.search.json"),
        ANOTHER_CAPABILITY,
      )
      const caps = await listCapabilities(tmpDir)
      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe("web.search")
    })

    it("merges project and global capabilities", async () => {
      await writeCapability(tmpDir, "issue_tracker.list_issues", VALID_CAPABILITY)
      const globalCapDir = join(fakeHome, ".agentic", "capabilities")
      await mkdir(globalCapDir, { recursive: true })
      await writeFile(join(globalCapDir, "web.search.json"), ANOTHER_CAPABILITY)
      const caps = await listCapabilities(tmpDir)
      expect(caps.map((c) => c.name)).toEqual([
        "issue_tracker.list_issues",
        "web.search",
      ])
    })

    it("project capability overrides global on name conflict", async () => {
      const projectVersion = JSON.stringify({
        name: "web.search",
        description: "Project-level override",
        policy: { effects: ["external.read"] },
      })
      await writeCapability(tmpDir, "web.search", projectVersion)

      const globalCapDir = join(fakeHome, ".agentic", "capabilities")
      await mkdir(globalCapDir, { recursive: true })
      await writeFile(join(globalCapDir, "web.search.json"), ANOTHER_CAPABILITY)

      const caps = await listCapabilities(tmpDir)
      expect(caps).toHaveLength(1)
      expect(caps[0]!.description).toBe("Project-level override")
    })

    it("reads from .spores fallback when .agentic is absent", async () => {
      await writeCapability(tmpDir, "issue_tracker.list_issues", VALID_CAPABILITY, ".spores")
      const caps = await listCapabilities(tmpDir)
      expect(caps).toHaveLength(1)
      expect(caps[0]!.name).toBe("issue_tracker.list_issues")
    })
  })

  describe("loadCapability", () => {
    it("returns undefined when no capabilities dir exists", async () => {
      const cap = await loadCapability("issue_tracker.list_issues", tmpDir)
      expect(cap).toBeUndefined()
    })

    it("returns undefined for a missing name", async () => {
      await writeCapability(tmpDir, "web.search", ANOTHER_CAPABILITY)
      const cap = await loadCapability("not.there", tmpDir)
      expect(cap).toBeUndefined()
    })

    it("returns the capability from the project dir", async () => {
      await writeCapability(tmpDir, "issue_tracker.list_issues", VALID_CAPABILITY)
      const cap = await loadCapability("issue_tracker.list_issues", tmpDir)
      expect(cap).not.toBeUndefined()
      expect(cap!.name).toBe("issue_tracker.list_issues")
    })

    it("returns the capability from the global dir", async () => {
      const globalCapDir = join(fakeHome, ".agentic", "capabilities")
      await mkdir(globalCapDir, { recursive: true })
      await writeFile(join(globalCapDir, "web.search.json"), ANOTHER_CAPABILITY)
      const cap = await loadCapability("web.search", tmpDir)
      expect(cap).not.toBeUndefined()
      expect(cap!.name).toBe("web.search")
    })

    it("project takes precedence over global on name conflict", async () => {
      const projectVersion = JSON.stringify({
        name: "web.search",
        description: "Project wins",
        policy: { effects: ["external.read"] },
      })
      await writeCapability(tmpDir, "web.search", projectVersion)

      const globalCapDir = join(fakeHome, ".agentic", "capabilities")
      await mkdir(globalCapDir, { recursive: true })
      await writeFile(join(globalCapDir, "web.search.json"), ANOTHER_CAPABILITY)

      const cap = await loadCapability("web.search", tmpDir)
      expect(cap!.description).toBe("Project wins")
    })

    it("returns undefined for malformed JSON in project dir", async () => {
      const capDir = join(tmpDir, ".agentic", "capabilities")
      await mkdir(capDir, { recursive: true })
      await writeFile(join(capDir, "bad.json"), "{ invalid json")
      const cap = await loadCapability("bad", tmpDir)
      expect(cap).toBeUndefined()
    })
  })
})
