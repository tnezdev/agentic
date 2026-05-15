import { describe, expect, test } from "bun:test"
import type { CapabilityDef, Dispatch } from "../types.js"
import {
  capabilityAllowsEffect,
  capabilityAllowsTool,
  capabilityMatchesDispatch,
  capabilityRequiresApprovalFor,
  validateCapability,
} from "./helpers.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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
// validateCapability
// ---------------------------------------------------------------------------

describe("validateCapability", () => {
  test("accepts a minimal valid declaration (name only)", () => {
    expect(validateCapability({ name: "web.search" })).toEqual({ valid: true })
  })

  test("accepts a full valid declaration", () => {
    const def: CapabilityDef = {
      name: "issue_tracker.create_issue",
      description: "Create an issue in an external issue tracker.",
      skill: "issue-triage",
      requires: {
        connections: [{ provider: "issue_tracker", capabilities: ["issues.write"] }],
      },
      policy: {
        dispatch: { from: ["surface:web", "surface:chat"] },
        tools: ["integration.invoke", "approval.request"],
        effects: ["external.write", "approval.request"],
        approval: { required_for: ["external.write"], mode: "before_effect" },
      },
      artifacts: { writes: ["issue_reference"] },
    }
    expect(validateCapability(def)).toEqual({ valid: true })
  })

  test("accepts a declaration with multiple connections", () => {
    expect(
      validateCapability({
        name: "calendar.create_event",
        requires: {
          connections: [
            { provider: "calendar", capabilities: ["events.write"] },
            { provider: "contacts", capabilities: ["contacts.read"] },
          ],
        },
        policy: { effects: ["external.write"] },
      }),
    ).toEqual({ valid: true })
  })

  // --- malformed declarations ---

  test("rejects a non-object input: string", () => {
    const result = validateCapability("not an object")
    expect(result.valid).toBe(false)
  })

  test("rejects a non-object input: number", () => {
    const result = validateCapability(42)
    expect(result.valid).toBe(false)
  })

  test("rejects null", () => {
    const result = validateCapability(null)
    expect(result.valid).toBe(false)
  })

  test("rejects an array", () => {
    const result = validateCapability([{ name: "x" }])
    expect(result.valid).toBe(false)
  })

  test("rejects missing name", () => {
    const result = validateCapability({})
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "name")).toBe(true)
    }
  })

  test("rejects empty name string", () => {
    const result = validateCapability({ name: "" })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "name")).toBe(true)
    }
  })

  test("rejects whitespace-only name", () => {
    const result = validateCapability({ name: "   " })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "name")).toBe(true)
    }
  })

  test("rejects non-string name", () => {
    const result = validateCapability({ name: 42 })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "name")).toBe(true)
    }
  })

  test("rejects an unknown effect", () => {
    const result = validateCapability({
      name: "x",
      policy: { effects: ["not.a.real.effect"] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "policy.effects[0]")).toBe(true)
    }
  })

  test("rejects mixed valid and unknown effects, flagging the bad index", () => {
    const result = validateCapability({
      name: "x",
      policy: { effects: ["external.read", "bad.effect"] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "policy.effects[1]")).toBe(true)
    }
  })

  test("rejects approval.required_for effect not in policy.effects", () => {
    const result = validateCapability({
      name: "x",
      policy: {
        effects: ["external.read"],
        approval: { required_for: ["external.write"], mode: "before_effect" },
      },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "policy.approval.required_for[0]")).toBe(true)
    }
  })

  test("rejects unknown effect in approval.required_for", () => {
    const result = validateCapability({
      name: "x",
      policy: {
        effects: ["external.write"],
        approval: { required_for: ["not.real"], mode: "before_effect" },
      },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "policy.approval.required_for[0]")).toBe(true)
    }
  })

  test("rejects connection with empty provider", () => {
    const result = validateCapability({
      name: "x",
      requires: { connections: [{ provider: "", capabilities: [] }] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.field === "requires.connections[0].provider"),
      ).toBe(true)
    }
  })

  test("rejects connection with non-string provider", () => {
    const result = validateCapability({
      name: "x",
      requires: { connections: [{ provider: 99, capabilities: [] }] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.field === "requires.connections[0].provider"),
      ).toBe(true)
    }
  })

  test("returns all errors when multiple fields are invalid", () => {
    const result = validateCapability({
      name: "",
      policy: { effects: ["bad.effect"] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(1)
    }
  })
})

// ---------------------------------------------------------------------------
// capabilityAllowsEffect
// ---------------------------------------------------------------------------

describe("capabilityAllowsEffect", () => {
  const def: CapabilityDef = {
    name: "issue_tracker.list_issues",
    policy: { effects: ["external.read", "memory.read"] },
  }

  test("returns true for a declared effect", () => {
    expect(capabilityAllowsEffect(def, "external.read")).toBe(true)
  })

  test("returns true for each declared effect", () => {
    expect(capabilityAllowsEffect(def, "memory.read")).toBe(true)
  })

  test("returns false for an undeclared effect", () => {
    expect(capabilityAllowsEffect(def, "external.write")).toBe(false)
  })

  test("returns false for an effect present nowhere", () => {
    expect(capabilityAllowsEffect(def, "compute.privileged")).toBe(false)
  })

  test("returns false when policy is absent", () => {
    expect(capabilityAllowsEffect({ name: "x" }, "external.read")).toBe(false)
  })

  test("returns false when policy.effects is absent", () => {
    expect(capabilityAllowsEffect({ name: "x", policy: {} }, "external.read")).toBe(false)
  })

  test("returns false when policy.effects is empty", () => {
    expect(capabilityAllowsEffect({ name: "x", policy: { effects: [] } }, "external.read")).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// capabilityAllowsTool
// ---------------------------------------------------------------------------

describe("capabilityAllowsTool", () => {
  const def: CapabilityDef = {
    name: "issue_tracker.create_issue",
    policy: { tools: ["integration.invoke", "approval.request"] },
  }

  test("returns true for a declared tool", () => {
    expect(capabilityAllowsTool(def, "integration.invoke")).toBe(true)
  })

  test("returns true for the second declared tool", () => {
    expect(capabilityAllowsTool(def, "approval.request")).toBe(true)
  })

  test("returns false for an undeclared tool", () => {
    expect(capabilityAllowsTool(def, "memory.read")).toBe(false)
  })

  test("returns false when policy is absent", () => {
    expect(capabilityAllowsTool({ name: "x" }, "integration.invoke")).toBe(false)
  })

  test("returns false when policy.tools is absent", () => {
    expect(capabilityAllowsTool({ name: "x", policy: {} }, "integration.invoke")).toBe(false)
  })

  test("returns false when policy.tools is empty", () => {
    expect(capabilityAllowsTool({ name: "x", policy: { tools: [] } }, "anything")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// capabilityMatchesDispatch
// ---------------------------------------------------------------------------

describe("capabilityMatchesDispatch", () => {
  test("matches all dispatches when no dispatch filter is declared (no policy)", () => {
    const def: CapabilityDef = { name: "web.search" }
    expect(capabilityMatchesDispatch(def, makeDispatch({ from: "scheduler" }))).toBe(true)
    expect(capabilityMatchesDispatch(def, makeDispatch({ from: "surface:voice" }))).toBe(true)
  })

  test("matches all dispatches when policy has no dispatch constraint", () => {
    const def: CapabilityDef = { name: "web.search", policy: {} }
    expect(capabilityMatchesDispatch(def, makeDispatch())).toBe(true)
  })

  test("matches when from is in an array allowlist", () => {
    const def: CapabilityDef = {
      name: "x",
      policy: { dispatch: { from: ["surface:web", "surface:chat"] } },
    }
    expect(capabilityMatchesDispatch(def, makeDispatch({ from: "surface:web" }))).toBe(true)
    expect(capabilityMatchesDispatch(def, makeDispatch({ from: "surface:chat" }))).toBe(true)
  })

  test("rejects when from is not in the array allowlist", () => {
    const def: CapabilityDef = {
      name: "x",
      policy: { dispatch: { from: ["surface:web", "surface:chat"] } },
    }
    expect(capabilityMatchesDispatch(def, makeDispatch({ from: "scheduler" }))).toBe(false)
    expect(capabilityMatchesDispatch(def, makeDispatch({ from: "surface:voice" }))).toBe(false)
  })

  test("matches when from is an exact string match", () => {
    const def: CapabilityDef = {
      name: "x",
      policy: { dispatch: { from: "scheduler" } },
    }
    expect(capabilityMatchesDispatch(def, makeDispatch({ from: "scheduler" }))).toBe(true)
  })

  test("rejects when from does not match the exact string", () => {
    const def: CapabilityDef = {
      name: "x",
      policy: { dispatch: { from: "scheduler" } },
    }
    expect(capabilityMatchesDispatch(def, makeDispatch({ from: "surface:web" }))).toBe(false)
  })

  test("empty from array rejects all dispatches (no values acceptable)", () => {
    const def: CapabilityDef = {
      name: "x",
      policy: { dispatch: { from: [] } },
    }
    expect(capabilityMatchesDispatch(def, makeDispatch())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// capabilityRequiresApprovalFor
// ---------------------------------------------------------------------------

describe("capabilityRequiresApprovalFor", () => {
  const def: CapabilityDef = {
    name: "issue_tracker.create_issue",
    policy: {
      effects: ["external.write", "approval.request"],
      approval: { required_for: ["external.write"], mode: "before_effect" },
    },
  }

  test("returns true for an effect that requires approval", () => {
    expect(capabilityRequiresApprovalFor(def, "external.write")).toBe(true)
  })

  test("returns false for a declared effect that does not require approval", () => {
    expect(capabilityRequiresApprovalFor(def, "approval.request")).toBe(false)
  })

  test("returns false for an entirely undeclared effect", () => {
    expect(capabilityRequiresApprovalFor(def, "memory.read")).toBe(false)
  })

  test("returns false when policy is absent", () => {
    expect(capabilityRequiresApprovalFor({ name: "x" }, "external.write")).toBe(false)
  })

  test("returns false when no approval policy is declared", () => {
    expect(
      capabilityRequiresApprovalFor({ name: "x", policy: {} }, "external.write"),
    ).toBe(false)
  })

  test("returns false when approval.required_for is empty", () => {
    const empty: CapabilityDef = {
      name: "x",
      policy: { approval: { required_for: [], mode: "before_effect" } },
    }
    expect(capabilityRequiresApprovalFor(empty, "external.write")).toBe(false)
  })

  test("handles after_effect approval mode", () => {
    const afterEffect: CapabilityDef = {
      name: "x",
      policy: {
        effects: ["dispatch.send"],
        approval: { required_for: ["dispatch.send"], mode: "after_effect" },
      },
    }
    expect(capabilityRequiresApprovalFor(afterEffect, "dispatch.send")).toBe(true)
  })
})
