import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  capabilityListCommand,
  capabilityShowCommand,
  capabilityValidateCommand,
} from "./capability.js"
import type { Ctx } from "../context.js"
import type { SporesConfig } from "../../types.js"
import { FilesystemAdapter } from "../../memory/filesystem.js"

function makeCtx(baseDir: string): Ctx {
  const config: SporesConfig = {
    adapter: "filesystem",
    memory: { dir: ".spores/memory", defaultTier: "L1", dreamDepth: 1 },
    workflow: {
      graphsDir: ".spores/workflow/graphs",
      runsDir: ".spores/workflow/runs",
    },
    wake: {},
  }
  return {
    adapter: new FilesystemAdapter(baseDir),
    config,
    baseDir,
    json: true,
    wide: false,
  }
}

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const origLog = console.log
  let captured = ""
  console.log = (...args: unknown[]) => {
    captured +=
      args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n"
  }
  return fn()
    .then(() => captured)
    .finally(() => {
      console.log = origLog
    })
}

async function writeCapability(
  baseDir: string,
  name: string,
  json: object,
  subdir: ".agentic" | ".spores" = ".agentic",
): Promise<void> {
  const capDir = join(baseDir, subdir, "capabilities")
  await mkdir(capDir, { recursive: true })
  await writeFile(join(capDir, `${name}.json`), JSON.stringify(json))
}

const ISSUE_CAP = {
  name: "issue_tracker.list_issues",
  description: "List issues from an external issue tracker.",
  skill: "issue-triage",
  requires: {
    connections: [{ provider: "issue_tracker", capabilities: ["issues.read"] }],
  },
  policy: { effects: ["external.read"] },
}

const SEARCH_CAP = {
  name: "web.search",
  description: "Search the web.",
  policy: { effects: ["external.read"] },
}

describe("capability CLI commands", () => {
  let tmpDir: string
  let ctx: Ctx

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "spores-capability-cli-"))
    ctx = makeCtx(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------------
  // capability list
  // ---------------------------------------------------------------------------

  it("capability list returns empty array when no capabilities exist", async () => {
    const out = await captureStdout(() => capabilityListCommand(ctx, [], {}))
    const defs = JSON.parse(out)
    expect(Array.isArray(defs)).toBe(true)
    expect(defs.length).toBe(0)
  })

  it("capability list returns all capabilities sorted by name", async () => {
    await writeCapability(tmpDir, "web.search", SEARCH_CAP)
    await writeCapability(tmpDir, "issue_tracker.list_issues", ISSUE_CAP)
    const out = await captureStdout(() => capabilityListCommand(ctx, [], {}))
    const defs = JSON.parse(out)
    expect(defs.length).toBe(2)
    expect(defs[0].name).toBe("issue_tracker.list_issues")
    expect(defs[1].name).toBe("web.search")
  })

  it("capability list skips malformed JSON files", async () => {
    await writeCapability(tmpDir, "good", SEARCH_CAP)
    const capDir = join(tmpDir, ".agentic", "capabilities")
    await writeFile(join(capDir, "bad.json"), "not-json")
    const out = await captureStdout(() => capabilityListCommand(ctx, [], {}))
    const defs = JSON.parse(out)
    expect(defs.length).toBe(1)
    expect(defs[0].name).toBe("web.search")
  })

  // ---------------------------------------------------------------------------
  // capability show
  // ---------------------------------------------------------------------------

  it("capability show requires a name argument", async () => {
    await expect(capabilityShowCommand(ctx, [], {})).rejects.toThrow(/Usage/)
  })

  it("capability show loads a capability by name", async () => {
    await writeCapability(tmpDir, "issue_tracker.list_issues", ISSUE_CAP)
    const out = await captureStdout(() =>
      capabilityShowCommand(ctx, ["issue_tracker.list_issues"], {}),
    )
    const def = JSON.parse(out)
    expect(def.name).toBe("issue_tracker.list_issues")
    expect(def.description).toBe("List issues from an external issue tracker.")
    expect(def.skill).toBe("issue-triage")
  })

  it("capability show throws not-found for unknown capability", async () => {
    await expect(
      capabilityShowCommand(ctx, ["no.such.cap"], {}),
    ).rejects.toThrow(/Capability not found/)
  })

  it("capability show includes policy and connections in JSON output", async () => {
    await writeCapability(tmpDir, "issue_tracker.list_issues", ISSUE_CAP)
    const out = await captureStdout(() =>
      capabilityShowCommand(ctx, ["issue_tracker.list_issues"], {}),
    )
    const def = JSON.parse(out)
    expect(def.policy?.effects).toContain("external.read")
    expect(def.requires?.connections?.[0]?.provider).toBe("issue_tracker")
  })

  // ---------------------------------------------------------------------------
  // capability validate — by name
  // ---------------------------------------------------------------------------

  it("capability validate requires a name-or-file argument", async () => {
    await expect(capabilityValidateCommand(ctx, [], {})).rejects.toThrow(/Usage/)
  })

  it("capability validate reports valid for a well-formed capability name", async () => {
    await writeCapability(tmpDir, "web.search", SEARCH_CAP)
    const out = await captureStdout(() =>
      capabilityValidateCommand(ctx, ["web.search"], {}),
    )
    const result = JSON.parse(out)
    expect(result.valid).toBe(true)
    expect(result.subject).toBe("web.search")
    expect(result.capability).toBeDefined()
  })

  it("capability validate throws not-found for unknown capability name", async () => {
    await expect(
      capabilityValidateCommand(ctx, ["no.such.cap"], {}),
    ).rejects.toThrow(/Capability not found/)
  })

  it("capability validate reports errors for an invalid declaration by name", async () => {
    const capDir = join(tmpDir, ".agentic", "capabilities")
    await mkdir(capDir, { recursive: true })
    // name field is missing — should fail validation
    await writeFile(join(capDir, "bad-cap.json"), JSON.stringify({ description: "oops" }))
    const out = await captureStdout(() =>
      capabilityValidateCommand(ctx, ["bad-cap"], {}),
    )
    const result = JSON.parse(out)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].field).toBe("name")
  })

  // ---------------------------------------------------------------------------
  // capability validate — by file path
  // ---------------------------------------------------------------------------

  it("capability validate accepts a file path ending in .json", async () => {
    const filePath = join(tmpDir, "my-cap.json")
    await writeFile(filePath, JSON.stringify(ISSUE_CAP))
    const out = await captureStdout(() =>
      capabilityValidateCommand(ctx, [filePath], {}),
    )
    const result = JSON.parse(out)
    expect(result.valid).toBe(true)
    expect(result.subject).toBe(filePath)
  })

  it("capability validate reports invalid JSON for a malformed file", async () => {
    const filePath = join(tmpDir, "bad.json")
    await writeFile(filePath, "not valid json")
    const out = await captureStdout(() =>
      capabilityValidateCommand(ctx, [filePath], {}),
    )
    const result = JSON.parse(out)
    expect(result.valid).toBe(false)
    expect(result.errors[0].message).toContain("not valid JSON")
  })

  it("capability validate throws for a missing file path", async () => {
    const filePath = join(tmpDir, "nonexistent.json")
    await expect(
      capabilityValidateCommand(ctx, [filePath], {}),
    ).rejects.toThrow(/File not found/)
  })

  it("capability validate reports validation errors for an invalid file", async () => {
    const filePath = join(tmpDir, "invalid-cap.json")
    await writeFile(
      filePath,
      JSON.stringify({
        name: "test.cap",
        policy: { effects: ["unknown_effect_xyz"] },
      }),
    )
    const out = await captureStdout(() =>
      capabilityValidateCommand(ctx, [filePath], {}),
    )
    const result = JSON.parse(out)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e: { field: string }) => e.field.startsWith("policy.effects"))).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Human-mode formatters (smoke test)
  // ---------------------------------------------------------------------------

  it("capability list produces human-readable table in non-JSON mode", async () => {
    await writeCapability(tmpDir, "web.search", SEARCH_CAP)
    const humanCtx = { ...ctx, json: false }
    const out = await captureStdout(() => capabilityListCommand(humanCtx, [], {}))
    expect(out).toContain("NAME")
    expect(out).toContain("web.search")
  })

  it("capability show produces human-readable output in non-JSON mode", async () => {
    await writeCapability(tmpDir, "web.search", SEARCH_CAP)
    const humanCtx = { ...ctx, json: false }
    const out = await captureStdout(() =>
      capabilityShowCommand(humanCtx, ["web.search"], {}),
    )
    expect(out).toContain("web.search")
    expect(out).toContain("Search the web.")
  })

  it("capability validate shows valid line in non-JSON mode", async () => {
    await writeCapability(tmpDir, "web.search", SEARCH_CAP)
    const humanCtx = { ...ctx, json: false }
    const out = await captureStdout(() =>
      capabilityValidateCommand(humanCtx, ["web.search"], {}),
    )
    expect(out).toContain("web.search")
    expect(out).toContain("valid")
  })
})
