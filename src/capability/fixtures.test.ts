/**
 * Type-level fixtures for the capability declaration vocabulary (issue #69).
 *
 * These are not runtime tests — there is no executable logic to test in a
 * pure-type issue. Instead, each fixture is a valid `CapabilityDef` literal
 * that the TypeScript compiler checks at compile time. If a fixture fails to
 * typecheck, the declaration vocabulary is missing a concept or is too
 * narrow.
 *
 * Neutral examples from docs/capability-contracts.md:
 *   - issue_tracker.list_issues
 *   - issue_tracker.create_issue
 *   - communication.place_call
 *   - web.search
 *   - document.create_slide_deck
 */

import { describe, it } from "bun:test"
import type { CapabilityDef } from "../types.js"
import { CAPABILITY_EFFECTS, POLICY_ERRORS } from "../types.js"

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
