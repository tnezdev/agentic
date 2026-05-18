import type { CapabilityDef, CapabilityEffect, Dispatch } from "../types.js"
import { CAPABILITY_EFFECTS } from "../types.js"
import { match } from "../dispatch/match.js"

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type CapabilityValidationError = {
  field: string
  message: string
}

export type CapabilityValidationResult =
  | { valid: true }
  | { valid: false; errors: [CapabilityValidationError, ...CapabilityValidationError[]] }

/**
 * Validate a capability declaration against structural and semantic
 * constraints. Returns a structured result rather than throwing — call sites
 * can inspect `valid` and `errors` without try/catch.
 *
 * Validates:
 * - `name` is a non-empty string (required)
 * - `policy.effects` entries are known `CapabilityEffect` values
 * - `policy.approval.required_for` entries are known effects that also
 *   appear in `policy.effects`
 * - `requires.connections[*].provider` is a non-empty string
 */
export function validateCapability(def: unknown): CapabilityValidationResult {
  const errors: CapabilityValidationError[] = []

  if (typeof def !== "object" || def === null || Array.isArray(def)) {
    return {
      valid: false,
      errors: [{ field: ".", message: "capability declaration must be a non-null object" }],
    }
  }

  const d = def as Record<string, unknown>

  // name — required non-empty string
  if (typeof d["name"] !== "string" || d["name"].trim() === "") {
    errors.push({ field: "name", message: "name must be a non-empty string" })
  }

  // policy
  if (d["policy"] !== undefined) {
    if (typeof d["policy"] !== "object" || d["policy"] === null || Array.isArray(d["policy"])) {
      errors.push({ field: "policy", message: "policy must be an object" })
    } else {
      const policy = d["policy"] as Record<string, unknown>

      // policy.effects — each must be a known CapabilityEffect
      const declaredEffects: CapabilityEffect[] = []
      if (policy["effects"] !== undefined) {
        if (!Array.isArray(policy["effects"])) {
          errors.push({ field: "policy.effects", message: "effects must be an array" })
        } else {
          for (let i = 0; i < policy["effects"].length; i++) {
            const e = policy["effects"][i]
            if (!CAPABILITY_EFFECTS.includes(e as CapabilityEffect)) {
              errors.push({
                field: `policy.effects[${i}]`,
                message: `unknown effect: "${String(e)}"`,
              })
            } else {
              declaredEffects.push(e as CapabilityEffect)
            }
          }
        }
      }

      // policy.approval — required_for entries must be known and in policy.effects
      if (policy["approval"] !== undefined) {
        if (
          typeof policy["approval"] !== "object" ||
          policy["approval"] === null ||
          Array.isArray(policy["approval"])
        ) {
          errors.push({ field: "policy.approval", message: "approval must be an object" })
        } else {
          const approval = policy["approval"] as Record<string, unknown>
          if (approval["required_for"] !== undefined) {
            if (!Array.isArray(approval["required_for"])) {
              errors.push({
                field: "policy.approval.required_for",
                message: "required_for must be an array",
              })
            } else {
              for (let i = 0; i < approval["required_for"].length; i++) {
                const e = approval["required_for"][i]
                if (!CAPABILITY_EFFECTS.includes(e as CapabilityEffect)) {
                  errors.push({
                    field: `policy.approval.required_for[${i}]`,
                    message: `unknown effect: "${String(e)}"`,
                  })
                } else if (!declaredEffects.includes(e as CapabilityEffect)) {
                  errors.push({
                    field: `policy.approval.required_for[${i}]`,
                    message: `effect "${String(e)}" is not declared in policy.effects`,
                  })
                }
              }
            }
          }
          // mode — required, must be a known ApprovalMode
          const APPROVAL_MODES = ["before_effect", "after_effect"]
          if (!APPROVAL_MODES.includes(approval["mode"] as string)) {
            errors.push({
              field: "policy.approval.mode",
              message: `mode must be "before_effect" or "after_effect"`,
            })
          }
        }
      }
    }
  }

  // requires.connections — each must have a non-empty provider string
  if (d["requires"] !== undefined) {
    if (
      typeof d["requires"] !== "object" ||
      d["requires"] === null ||
      Array.isArray(d["requires"])
    ) {
      errors.push({ field: "requires", message: "requires must be an object" })
    } else {
      const requires = d["requires"] as Record<string, unknown>
      if (requires["connections"] !== undefined) {
        if (!Array.isArray(requires["connections"])) {
          errors.push({
            field: "requires.connections",
            message: "connections must be an array",
          })
        } else {
          for (let i = 0; i < requires["connections"].length; i++) {
            const conn = requires["connections"][i]
            if (typeof conn !== "object" || conn === null) {
              errors.push({
                field: `requires.connections[${i}]`,
                message: "connection must be an object",
              })
            } else {
              const c = conn as Record<string, unknown>
              if (typeof c["provider"] !== "string" || c["provider"].trim() === "") {
                errors.push({
                  field: `requires.connections[${i}].provider`,
                  message: "provider must be a non-empty string",
                })
              }
              // capabilities — required string[]
              if (!Array.isArray(c["capabilities"])) {
                errors.push({
                  field: `requires.connections[${i}].capabilities`,
                  message: "capabilities must be an array of strings",
                })
              } else {
                for (let j = 0; j < c["capabilities"].length; j++) {
                  if (typeof c["capabilities"][j] !== "string") {
                    errors.push({
                      field: `requires.connections[${i}].capabilities[${j}]`,
                      message: "each capability must be a string",
                    })
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors: errors as [CapabilityValidationError, ...CapabilityValidationError[]],
    }
  }
  return { valid: true }
}

// ---------------------------------------------------------------------------
// Policy helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the capability's policy declares the given effect.
 * An absent policy or absent effects list returns false — no whitelist
 * means no effects are permitted.
 */
export function capabilityAllowsEffect(def: CapabilityDef, effect: CapabilityEffect): boolean {
  return def.policy?.effects?.includes(effect) ?? false
}

/**
 * Returns true if the capability's policy allows the host to invoke the
 * given tool on its behalf. An absent tools list returns false.
 */
export function capabilityAllowsTool(def: CapabilityDef, tool: string): boolean {
  return def.policy?.tools?.includes(tool) ?? false
}

/**
 * Returns true if the inbound dispatch satisfies the capability's dispatch
 * filter. An absent filter (no `policy.dispatch`) matches every dispatch —
 * the capability places no constraint on call origin.
 *
 * Delegates to `match()` from `dispatch/match` for filter semantics:
 * a string constraint matches by equality; an array constraint matches by
 * inclusion; an undefined field places no constraint.
 */
export function capabilityMatchesDispatch(def: CapabilityDef, dispatch: Dispatch): boolean {
  if (def.policy?.dispatch === undefined) return true
  return match(dispatch, def.policy.dispatch)
}

/**
 * Returns true if the capability's approval policy requires human approval
 * before (or after) the given effect executes.
 */
export function capabilityRequiresApprovalFor(
  def: CapabilityDef,
  effect: CapabilityEffect,
): boolean {
  return def.policy?.approval?.required_for?.includes(effect) ?? false
}
