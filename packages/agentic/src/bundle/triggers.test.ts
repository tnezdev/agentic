import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type {
  ActionCapabilityDeclaration,
  ActionDeclaration,
  ArtifactDeclaration,
  HookDeclaration,
  ScheduleDeclaration,
  SurfaceDeclaration,
} from "../types.js"
import { loadAgenticBundle } from "./filesystem.js"
import {
  validateAgenticTriggerDeclarations,
  validateHookDeclaration,
  validateScheduleDeclaration,
} from "./triggers.js"

const exampleRoot = join(import.meta.dir, "../../../../examples/agentic-next/.agentic")

const actions: ActionDeclaration[] = [
  { id: "surface.receive", effects: ["artifact.write:case-review-request", "artifact.write:case-packet"] },
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
]

const capabilities: ActionCapabilityDeclaration[] = [
  { id: "case.validate", action: "case.validate" },
  { id: "handoff.release", action: "external.handoff" },
]

const artifacts: ArtifactDeclaration[] = [
  { id: "case-review-request" },
  { id: "case-packet" },
  { id: "validation-result" },
  { id: "handoff-note" },
]

describe("validateAgenticTriggerDeclarations", () => {
  test("accepts the current agentic-next surface, schedule, and hook declarations", async () => {
    const bundle = await loadAgenticBundle(exampleRoot)
    const result = validateAgenticTriggerDeclarations({
      surfaces: bundle.surfaces.map((entry) => entry.data as unknown as SurfaceDeclaration),
      schedules: bundle.schedules.map((entry) => entry.data as unknown as ScheduleDeclaration),
      hooks: bundle.hooks.map((entry) => entry.data as unknown as HookDeclaration),
      actions: bundle.actions.map((entry) => entry.data as unknown as ActionDeclaration),
      capabilities: bundle.capabilities.map((entry) => entry.data as unknown as ActionCapabilityDeclaration),
      artifacts: bundle.artifacts.map((entry) => entry.data as unknown as ArtifactDeclaration),
    })

    expect(result).toEqual({ valid: true })
  })

  test("rejects proposed actions and capabilities missing from the loaded bundle", () => {
    const result = validateAgenticTriggerDeclarations({
      schedules: [{
        id: "bad-nightly-sweep",
        cron: "0 3 * * *",
        principal: "service:nightly-scheduler",
        proposes: { action: "case.release", capability: "case.release" },
      } satisfies ScheduleDeclaration],
      actions,
      capabilities,
      artifacts,
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((error) => error.field === "schedules[0].proposes.action")).toBe(true)
      expect(result.errors.some((error) => error.field === "schedules[0].proposes.capability")).toBe(true)
    }
  })

  test("rejects proposed capabilities that do not match the action declaration", () => {
    const result = validateScheduleDeclaration({
      id: "nightly-qc-sweep",
      cron: "0 3 * * *",
      principal: "service:nightly-scheduler",
      selects: { artifact: "case-packet", status: "intake_ready" },
      proposes: { action: "case.validate", capability: "handoff.release" },
    } satisfies ScheduleDeclaration, { actions, capabilities, artifacts })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((error) => error.message.includes("does not match action case.validate"))).toBe(true)
    }
  })

  test("validates hook artifact type/status matches without building a general rules engine", () => {
    expect(validateHookDeclaration({
      id: "validation-result.propose-handoff",
      on: { "artifact.type": "validation-result", "artifact.status": "needs_reviewer" },
      proposes: { action: "external.handoff", capability: "handoff.release" },
    } satisfies HookDeclaration, { actions, capabilities, artifacts })).toEqual({ valid: true })

    const result = validateHookDeclaration({
      id: "bad-hook",
      on: { "artifact.type": "missing-result", "artifact.status": "needs_reviewer" },
      proposes: { action: "external.handoff", capability: "handoff.release" },
    } satisfies HookDeclaration, { actions, capabilities, artifacts })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some((error) => error.field === "hook.on.artifact.type")).toBe(true)
    }
  })

  test("does not execute function-shaped proposed payload values", () => {
    let executed = false
    const result = validateScheduleDeclaration({
      id: "nightly-qc-sweep",
      cron: "0 3 * * *",
      principal: "service:nightly-scheduler",
      proposes: {
        action: "case.validate",
        capability: "case.validate",
        payload: {
          run: () => {
            executed = true
          },
        },
      },
    }, { actions, capabilities, artifacts })

    expect(result.valid).toBe(false)
    expect(executed).toBe(false)
  })
})
