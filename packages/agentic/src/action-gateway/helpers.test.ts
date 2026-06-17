import { describe, expect, test } from "bun:test"
import type {
  ActionCapabilityDeclaration,
  ActionDeclaration,
  ResolvedActionProposal,
} from "../types.js"
import {
  computeActionDigest,
  createApprovalRequest,
  evaluateActionPolicy,
  resolveActionProposal,
  validateActionGatewayDeclarations,
} from "./helpers.js"

const actions: ActionDeclaration[] = [
  {
    id: "case.validate",
    capability: "case.validate",
    effects: ["artifact.read:case-packet", "artifact.write:validation-result"],
  },
  {
    id: "external.handoff",
    capability: "handoff.release",
    effects: ["external.write:review-queue", "artifact.write:handoff-note"],
  },
  {
    id: "approval.request",
    effects: ["artifact.write:approval-request"],
  },
]

const capabilities: ActionCapabilityDeclaration[] = [
  {
    id: "case.validate",
    action: "case.validate",
    effects: ["artifact.read:case-packet", "artifact.write:validation-result"],
    data_classes: ["synthetic_regulated_demo"],
    principals: { allowed: ["agent:case-reviewer"] },
    approval: { required: false },
  },
  {
    id: "handoff.release",
    action: "external.handoff",
    effects: ["external.write:review-queue", "artifact.write:handoff-note"],
    data_classes: ["synthetic_regulated_demo"],
    principals: { allowed: ["agent:case-reviewer"] },
    approval: {
      required: true,
      approver_rule: { all_of: ["grant.action_digest == action.digest"] },
    },
  },
]

function resolved(overrides: Partial<ResolvedActionProposal> = {}): ResolvedActionProposal {
  return {
    id: "act_001",
    type: "case.validate",
    principal: "agent:case-reviewer",
    capability: "case.validate",
    data_class: "synthetic_regulated_demo",
    input_artifact_ids: ["art_packet_001"],
    effects: ["artifact.read:case-packet", "artifact.write:validation-result"],
    payload: { guideline: "demo" },
    ...overrides,
  }
}

describe("validateActionGatewayDeclarations", () => {
  test("accepts matching action and capability declarations", () => {
    expect(validateActionGatewayDeclarations({ actions, capabilities })).toEqual({ valid: true })
  })

  test("rejects an action that references a missing capability", () => {
    const result = validateActionGatewayDeclarations({
      actions: [{ id: "x", capability: "missing" }],
      capabilities: [],
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((error) => error.field === "actions[0].capability")).toBe(true)
    }
  })
})

describe("resolveActionProposal", () => {
  test("fills capability and effects from the action declaration", () => {
    expect(resolveActionProposal({
      type: "case.validate",
      principal: "agent:case-reviewer",
      data_class: "synthetic_regulated_demo",
    }, actions[0]!, "act_case_validate_0001")).toMatchObject({
      id: "act_case_validate_0001",
      capability: "case.validate",
      effects: ["artifact.read:case-packet", "artifact.write:validation-result"],
    })
  })
})

describe("computeActionDigest", () => {
  test("returns the same digest for semantically equivalent object key order", () => {
    const first = computeActionDigest(resolved({ payload: { b: 2, a: 1 } }))
    const second = computeActionDigest(resolved({ payload: { a: 1, b: 2 } }))
    expect(first).toBe(second)
    expect(first).toHaveLength(64)
  })

  test("changes when the requested effect changes", () => {
    const first = computeActionDigest(resolved())
    const second = computeActionDigest(resolved({ effects: ["artifact.write:validation-result"] }))
    expect(first).not.toBe(second)
  })
})

describe("createApprovalRequest", () => {
  test("binds approval to the exact action digest", () => {
    const proposal = resolved({ type: "external.handoff", capability: "handoff.release" })
    const request = createApprovalRequest({
      proposal,
      action_digest: "digest-123",
      approver_rule: { all_of: ["grant.action_digest == action.digest"] },
      expires_at: "2026-06-18T00:00:00.000Z",
    })
    expect(request).toMatchObject({
      action_id: "act_001",
      action_type: "external.handoff",
      action_digest: "digest-123",
      capability: "handoff.release",
      status: "pending",
    })
  })
})

describe("evaluateActionPolicy", () => {
  test("allows a declared capability request", () => {
    expect(evaluateActionPolicy({
      principals: ["agent:case-reviewer", "service:agentic-runtime"],
      action: actions[0]!,
      proposal: resolved(),
      capabilities,
      data_boundary: { allowed_data_classes: ["synthetic_regulated_demo"] },
    })).toMatchObject({
      decision: "allow",
      capability: "case.validate",
      code: "allowed",
    })
  })

  test("requires approval when the capability declares an approval gate", () => {
    expect(evaluateActionPolicy({
      principals: ["agent:case-reviewer", "service:agentic-runtime"],
      action: actions[1]!,
      proposal: resolved({
        type: "external.handoff",
        capability: "handoff.release",
        effects: ["external.write:review-queue", "artifact.write:handoff-note"],
      }),
      capabilities,
      data_boundary: { allowed_data_classes: ["synthetic_regulated_demo"] },
    })).toMatchObject({
      decision: "approval_required",
      capability: "handoff.release",
      required_approval: { all_of: ["grant.action_digest == action.digest"] },
    })
  })

  test("denies unsupported effects before execution", () => {
    expect(evaluateActionPolicy({
      principals: ["agent:case-reviewer", "service:agentic-runtime"],
      action: actions[0]!,
      proposal: resolved({ effects: ["external.write:review-queue"] }),
      capabilities,
    })).toMatchObject({
      decision: "deny",
      code: "effect_not_allowed",
    })
  })

  test("denies data classes blocked by the boundary policy", () => {
    expect(evaluateActionPolicy({
      principals: ["agent:case-reviewer", "service:agentic-runtime"],
      action: actions[0]!,
      proposal: resolved({ data_class: "real_phi" }),
      capabilities,
      data_boundary: { disallowed: ["real_phi"] },
    })).toMatchObject({
      decision: "deny",
      code: "data_boundary_denied",
    })
  })

  test("allows capability-free service actions", () => {
    expect(evaluateActionPolicy({
      principals: ["agent:case-reviewer", "service:agentic-runtime"],
      action: actions[2]!,
      proposal: resolved({
        type: "approval.request",
        principal: "service:agentic-runtime",
        capability: undefined,
        effects: ["artifact.write:approval-request"],
      }),
      capabilities,
    })).toMatchObject({
      decision: "allow",
      code: "allowed",
    })
  })
})
