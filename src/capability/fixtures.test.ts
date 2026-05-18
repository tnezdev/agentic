/**
 * Fixtures for the capability declaration vocabulary.
 *
 * Two layers of coverage:
 *
 * 1. Type-level assignment checks (issue #69) — compile-time only. Each
 *    fixture is a valid `CapabilityDef` literal checked by the TypeScript
 *    compiler. If a fixture fails to typecheck, the declaration vocabulary is
 *    missing a concept or is too narrow.
 *
 * 2. Runtime fixture validation (issue #74) — each neutral example is stored
 *    as a JSON file under src/capability/fixtures/ and loaded at test time as
 *    `unknown`. Passing the result through `validateCapability()` proves that
 *    the validator accepts the canonical declaration shapes and that the JSON
 *    files have not drifted from the type vocabulary.
 *
 * Neutral examples from docs/capability-contracts.md:
 *   - issue_tracker.list_issues
 *   - issue_tracker.create_issue
 *   - communication.place_call
 *   - web.search
 *   - document.create_slide_deck
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"
import type { CapabilityDef } from "../types.js"
import { CAPABILITY_EFFECTS, POLICY_ERRORS } from "../types.js"
import { validateCapability } from "./helpers.js"

// ---------------------------------------------------------------------------
// Type-level assignment check — each fixture must satisfy CapabilityDef
// ---------------------------------------------------------------------------

const _listIssues: CapabilityDef = {
  name: "issue_tracker.list_issues",
  description:
    "Use when the user asks to list issues from an external issue tracker.",
  skill: "issue-triage",
  requires: {
    connections: [
      {
        provider: "issue_tracker",
        capabilities: ["issues.read"],
      },
    ],
  },
  policy: {
    effects: ["external.read"],
  },
}

const _createIssue: CapabilityDef = {
  name: "issue_tracker.create_issue",
  description:
    "Use when the user asks to create an issue in an external issue tracker.",
  skill: "issue-triage",
  requires: {
    connections: [
      {
        provider: "issue_tracker",
        capabilities: ["issues.write"],
      },
    ],
  },
  policy: {
    dispatch: {
      from: ["surface:web", "surface:chat"],
    },
    tools: ["integration.invoke", "approval.request"],
    effects: ["external.write", "approval.request"],
    approval: {
      required_for: ["external.write"],
      mode: "before_effect",
    },
  },
  artifacts: {
    writes: ["issue_reference"],
  },
}

const _placeCall: CapabilityDef = {
  name: "communication.place_call",
  description:
    "Use when the user asks to place an outbound call to another person.",
  policy: {
    dispatch: {
      from: ["surface:chat", "surface:voice"],
    },
    effects: ["external.write", "user.notify", "approval.request"],
    approval: {
      required_for: ["external.write"],
      mode: "before_effect",
    },
  },
}

const _webSearch: CapabilityDef = {
  name: "web.search",
  description:
    "Use when the user asks to search the web for current information.",
  policy: {
    effects: ["external.read"],
  },
}

const _createSlideDeck: CapabilityDef = {
  name: "document.create_slide_deck",
  description:
    "Use when the user asks to create a slide deck from structured content.",
  policy: {
    effects: ["artifact.write"],
  },
  artifacts: {
    writes: ["slide_deck"],
  },
}

// Suppress "declared but never read" warnings — fixtures exist for their
// compile-time type checks, not their runtime values.
void _listIssues
void _createIssue
void _placeCall
void _webSearch
void _createSlideDeck

// ---------------------------------------------------------------------------
// Runtime checks — vocabulary completeness
// ---------------------------------------------------------------------------

describe("CAPABILITY_EFFECTS", () => {
  it("contains all ten defined effects", () => {
    const expected = [
      "memory.read",
      "memory.write",
      "artifact.read",
      "artifact.write",
      "external.read",
      "external.write",
      "approval.request",
      "dispatch.send",
      "user.notify",
      "compute.privileged",
    ] as const
    for (const effect of expected) {
      if (!CAPABILITY_EFFECTS.includes(effect)) {
        throw new Error(`Missing effect: ${effect}`)
      }
    }
  })
})

describe("POLICY_ERRORS", () => {
  it("contains all ten defined policy error names", () => {
    const expected = [
      "policy_denied",
      "dispatch_not_allowed",
      "tool_not_allowed",
      "effect_not_allowed",
      "missing_connection",
      "approval_required",
      "approval_rejected",
      "provider_unauthorized",
      "provider_unavailable",
      "capability_misconfigured",
    ] as const
    for (const name of expected) {
      if (!POLICY_ERRORS.includes(name)) {
        throw new Error(`Missing policy error: ${name}`)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Runtime fixture validation — neutral JSON examples (issue #74)
//
// Each fixture file under src/capability/fixtures/ is loaded as unknown text
// and validated through validateCapability(). This proves:
//   (a) the JSON files are well-formed and match the declaration vocabulary
//   (b) validateCapability() accepts all canonical neutral examples
//   (c) the files have not drifted as the vocabulary evolves
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(import.meta.dir, "fixtures")

function loadFixtureJson(filename: string): unknown {
  const text = readFileSync(join(FIXTURES_DIR, filename), "utf-8")
  return JSON.parse(text)
}

const NEUTRAL_FIXTURES = [
  "issue_tracker.list_issues.json",
  "issue_tracker.create_issue.json",
  "communication.place_call.json",
  "web.search.json",
  "document.create_slide_deck.json",
] as const

describe("neutral fixture files", () => {
  for (const filename of NEUTRAL_FIXTURES) {
    const capabilityName = filename.replace(/\.json$/, "")
    it(`${capabilityName} passes validateCapability`, () => {
      const raw = loadFixtureJson(filename)
      const result = validateCapability(raw)
      if (!result.valid) {
        throw new Error(
          `Fixture ${filename} failed validation:\n${JSON.stringify(result.errors, null, 2)}`,
        )
      }
    })
  }

  it("all five neutral examples are present in the fixtures directory", () => {
    const expected = [
      "issue_tracker.list_issues.json",
      "issue_tracker.create_issue.json",
      "communication.place_call.json",
      "web.search.json",
      "document.create_slide_deck.json",
    ]
    for (const filename of expected) {
      // loadFixtureJson throws if the file is missing — that surfaces a clear
      // failure message rather than a confusing undefined
      expect(() => loadFixtureJson(filename)).not.toThrow()
    }
  })
})
