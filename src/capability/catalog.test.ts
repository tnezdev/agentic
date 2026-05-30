/**
 * End-to-end tests for the capability declaration catalog (issue #75).
 *
 * Proves that the capability declaration catalog works as a portable
 * primitive by exercising the full public API against the neutral fixture
 * set:
 *
 *   1. Files/source records are loaded
 *   2. Declarations validate
 *   3. list/show style APIs return stable references
 *   4. Pure policy helpers answer expected questions for the neutral examples
 *   5. Skill metadata can reference a capability without executing it
 *
 * Uses InMemorySource to avoid filesystem dependencies.
 */

import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { InMemorySource } from "../sources/in-memory.js"
import type { CapabilityDef, Dispatch } from "../types.js"
import {
  listCapabilitiesFromSource,
  loadCapabilityFromSource,
} from "./filesystem.js"
import {
  capabilityAllowsEffect,
  capabilityAllowsTool,
  capabilityMatchesDispatch,
  capabilityRequiresApprovalFor,
  validateCapability,
} from "./helpers.js"

// ---------------------------------------------------------------------------
// Fixtures loaded from neutral examples
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dir, "fixtures")

function loadFixtureText(filename: string): string {
  return readFileSync(join(FIXTURES_DIR, filename), "utf-8")
}

const FIXTURES: Record<string, string> = {
  "issue_tracker.list_issues": loadFixtureText("issue_tracker.list_issues.json"),
  "issue_tracker.create_issue": loadFixtureText("issue_tracker.create_issue.json"),
  "communication.place_call": loadFixtureText("communication.place_call.json"),
  "web.search": loadFixtureText("web.search.json"),
  "document.create_slide_deck": loadFixtureText("document.create_slide_deck.json"),
}

function makeSource(entries: Record<string, string> = FIXTURES): InMemorySource {
  return new InMemorySource(entries, "catalog-test")
}

function makeDispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    id: "01KNRZBRK1S3WAB2DTYG1TNTB5",
    from: "surface:web",
    to: "pa:default",
    payload: null,
    timestamp: "2026-05-15T05:45:00.000Z",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Source records are loaded
// ---------------------------------------------------------------------------

describe("catalog: source records are loaded", () => {
  it("listCapabilitiesFromSource returns all five neutral fixtures", async () => {
    const source = makeSource()
    const caps = await listCapabilitiesFromSource(source)
    expect(caps).toHaveLength(5)
  })

  it("listCapabilitiesFromSource returns capabilities sorted by name", async () => {
    const source = makeSource()
    const caps = await listCapabilitiesFromSource(source)
    const names = caps.map((c) => c.name)
    expect(names).toEqual([
      "communication.place_call",
      "document.create_slide_deck",
      "issue_tracker.create_issue",
      "issue_tracker.list_issues",
      "web.search",
    ])
  })

  it("loadCapabilityFromSource returns a specific capability by name", async () => {
    const source = makeSource()
    const cap = await loadCapabilityFromSource("web.search", source)
    expect(cap).not.toBeUndefined()
    expect(cap!.name).toBe("web.search")
    expect(cap!.description).toBe(
      "Use when the user asks to search the web for current information.",
    )
  })

  it("loadCapabilityFromSource returns undefined for a missing capability", async () => {
    const source = makeSource()
    const cap = await loadCapabilityFromSource("nonexistent", source)
    expect(cap).toBeUndefined()
  })

  it("each fixture record has a non-empty text body", async () => {
    const source = makeSource()
    for (const name of Object.keys(FIXTURES)) {
      const record = await source.read(name)
      expect(record).not.toBeUndefined()
      expect(record!.text.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Declarations validate
// ---------------------------------------------------------------------------

describe("catalog: declarations validate", () => {
  it("all five neutral fixtures pass validateCapability", () => {
    for (const [name, text] of Object.entries(FIXTURES)) {
      const parsed = JSON.parse(text)
      const result = validateCapability(parsed)
      if (!result.valid) {
        throw new Error(
          `Fixture ${name} failed validation: ${JSON.stringify(result.errors, null, 2)}`,
        )
      }
    }
  })

  it("invalid capability is rejected by validateCapability", () => {
    const result = validateCapability({})
    expect(result.valid).toBe(false)
  })

  it("capability with unknown effect is rejected", () => {
    const result = validateCapability({
      name: "test.bad_effect",
      policy: { effects: ["not.a.real.effect"] },
    })
    expect(result.valid).toBe(false)
  })

  it("malformed JSON from source is skipped by listCapabilitiesFromSource", async () => {
    const source = new InMemorySource({
      "good_cap": FIXTURES["web.search"],
      "bad_json": "{ not valid json",
    })
    const caps = await listCapabilitiesFromSource(source)
    expect(caps).toHaveLength(1)
    expect(caps[0]!.name).toBe("web.search")
  })
})

// ---------------------------------------------------------------------------
// 3. list/show style APIs return stable references
// ---------------------------------------------------------------------------

describe("catalog: list/show APIs return stable references", () => {
  it("loading the same capability twice returns structurally identical results", async () => {
    const source = makeSource()
    const cap1 = await loadCapabilityFromSource("web.search", source)
    const cap2 = await loadCapabilityFromSource("web.search", source)
    expect(cap1).toEqual(cap2)
  })

  it("listed capabilities have all expected name fields matching fixture keys", async () => {
    const source = makeSource()
    const caps = await listCapabilitiesFromSource(source)
    const names = new Set(caps.map((c) => c.name))
    for (const fixtureName of Object.keys(FIXTURES)) {
      expect(names.has(fixtureName)).toBe(true)
    }
  })

  it("loadCapabilityFromSource for each listed name succeeds", async () => {
    const source = makeSource()
    const caps = await listCapabilitiesFromSource(source)
    for (const listed of caps) {
      const loaded = await loadCapabilityFromSource(listed.name, source)
      expect(loaded).not.toBeUndefined()
      expect(loaded!.name).toBe(listed.name)
    }
  })

  it("each loaded capability preserves the full declaration shape", async () => {
    const source = makeSource()
    const cap = await loadCapabilityFromSource("issue_tracker.create_issue", source)
    expect(cap).not.toBeUndefined()
    // Full declaration: skill, requires, policy (dispatch, tools, effects, approval), artifacts
    expect(cap!.skill).toBe("issue-triage")
    expect(cap!.requires!.connections).toHaveLength(1)
    expect(cap!.requires!.connections![0]!.provider).toBe("issue_tracker")
    expect(cap!.policy!.dispatch).not.toBeUndefined()
    expect(cap!.policy!.tools).toEqual(["integration.invoke", "approval.request"])
    expect(cap!.policy!.effects).toEqual(["external.write", "approval.request"])
    expect(cap!.policy!.approval!.required_for).toEqual(["external.write"])
    expect(cap!.policy!.approval!.mode).toBe("before_effect")
    expect(cap!.artifacts!.writes).toEqual(["issue_reference"])
  })
})

// ---------------------------------------------------------------------------
// 4. Policy helpers answer expected questions for the neutral examples
// ---------------------------------------------------------------------------

describe("catalog: policy helpers for neutral examples", () => {
  it("web.search allows external.read effect", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("web.search", source))!
    expect(capabilityAllowsEffect(cap, "external.read")).toBe(true)
  })

  it("web.search does not allow external.write effect", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("web.search", source))!
    expect(capabilityAllowsEffect(cap, "external.write")).toBe(false)
  })

  it("issue_tracker.create_issue allows external.write and approval.request", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("issue_tracker.create_issue", source))!
    expect(capabilityAllowsEffect(cap, "external.write")).toBe(true)
    expect(capabilityAllowsEffect(cap, "approval.request")).toBe(true)
  })

  it("issue_tracker.create_issue requires approval for external.write", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("issue_tracker.create_issue", source))!
    expect(capabilityRequiresApprovalFor(cap, "external.write")).toBe(true)
  })

  it("issue_tracker.create_issue does not require approval for approval.request", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("issue_tracker.create_issue", source))!
    expect(capabilityRequiresApprovalFor(cap, "approval.request")).toBe(false)
  })

  it("communication.place_call allows dispatch from surface:chat and surface:voice", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("communication.place_call", source))!
    expect(capabilityMatchesDispatch(cap, makeDispatch({ from: "surface:chat" }))).toBe(true)
    expect(capabilityMatchesDispatch(cap, makeDispatch({ from: "surface:voice" }))).toBe(true)
  })

  it("communication.place_call rejects dispatch from surface:web", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("communication.place_call", source))!
    expect(capabilityMatchesDispatch(cap, makeDispatch({ from: "surface:web" }))).toBe(false)
  })

  it("web.search matches dispatch from any source (no dispatch constraint)", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("web.search", source))!
    expect(capabilityMatchesDispatch(cap, makeDispatch({ from: "surface:web" }))).toBe(true)
    expect(capabilityMatchesDispatch(cap, makeDispatch({ from: "scheduler" }))).toBe(true)
    expect(capabilityMatchesDispatch(cap, makeDispatch({ from: "surface:voice" }))).toBe(true)
  })

  it("issue_tracker.create_issue allows integration.invoke and approval.request tools", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("issue_tracker.create_issue", source))!
    expect(capabilityAllowsTool(cap, "integration.invoke")).toBe(true)
    expect(capabilityAllowsTool(cap, "approval.request")).toBe(true)
  })

  it("issue_tracker.create_issue does not allow memory.read tool", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("issue_tracker.create_issue", source))!
    expect(capabilityAllowsTool(cap, "memory.read")).toBe(false)
  })

  it("document.create_slide_deck allows artifact.write effect", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("document.create_slide_deck", source))!
    expect(capabilityAllowsEffect(cap, "artifact.write")).toBe(true)
  })

  it("document.create_slide_deck does not allow external.write effect", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("document.create_slide_deck", source))!
    expect(capabilityAllowsEffect(cap, "external.write")).toBe(false)
  })

  it("issue_tracker.list_issues does not require approval for external.read", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("issue_tracker.list_issues", source))!
    expect(capabilityRequiresApprovalFor(cap, "external.read")).toBe(false)
  })

  it("capabilities with no approval policy return false for any effect", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("web.search", source))!
    expect(capabilityRequiresApprovalFor(cap, "external.read")).toBe(false)
    expect(capabilityRequiresApprovalFor(cap, "external.write")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. Skill metadata can reference a capability without executing it
// ---------------------------------------------------------------------------

describe("catalog: skill metadata references capabilities without execution", () => {
  it("capabilities with a skill field expose the reference via the public API", async () => {
    const source = makeSource()
    const listCap = (await loadCapabilityFromSource("issue_tracker.list_issues", source))!
    expect(listCap.skill).toBe("issue-triage")

    const createCap = (await loadCapabilityFromSource("issue_tracker.create_issue", source))!
    expect(createCap.skill).toBe("issue-triage")
  })

  it("capabilities without a skill field have undefined skill", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("web.search", source))!
    expect(cap.skill).toBeUndefined()
  })

  it("listing all capabilities exposes skill references alongside policy info", async () => {
    const source = makeSource()
    const caps = await listCapabilitiesFromSource(source)
    // Two capabilities reference the "issue-triage" skill
    const issueTriageCaps = caps.filter((c) => c.skill === "issue-triage")
    expect(issueTriageCaps).toHaveLength(2)
    expect(issueTriageCaps.map((c) => c.name).sort()).toEqual([
      "issue_tracker.create_issue",
      "issue_tracker.list_issues",
    ])
  })

  it("skill reference is decoupled from policy — skill can be present with any policy shape", async () => {
    const source = makeSource()
    const listCap = (await loadCapabilityFromSource("issue_tracker.list_issues", source))!
    const createCap = (await loadCapabilityFromSource("issue_tracker.create_issue", source))!

    // Both reference same skill, but have different policy shapes
    expect(listCap.skill).toBe(createCap.skill)
    expect(listCap.policy!.effects).not.toEqual(createCap.policy!.effects)
    // list_issues: only external.read, no approval
    expect(capabilityRequiresApprovalFor(listCap, "external.read")).toBe(false)
    // create_issue: external.write + approval.request, approval required for external.write
    expect(capabilityRequiresApprovalFor(createCap, "external.write")).toBe(true)
  })

  it("a skill reference does not imply any execution capability", async () => {
    const source = makeSource()
    const cap = (await loadCapabilityFromSource("issue_tracker.list_issues", source))!
    // The skill field is metadata — it does not guarantee any particular
    // effect beyond what the policy declares
    expect(cap.skill).toBe("issue-triage")
    expect(capabilityAllowsEffect(cap, "external.write")).toBe(false)
    expect(capabilityAllowsEffect(cap, "compute.privileged")).toBe(false)
  })
})
