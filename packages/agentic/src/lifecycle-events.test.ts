import { describe, expect, it } from "bun:test"
import type { LifecycleEvent, LifecycleEventName } from "./types.js"
import {
  LIFECYCLE_EVENTS,
  LIFECYCLE_EVENT_PRIMITIVES,
} from "./types.js"

describe("lifecycle event vocabulary", () => {
  it("defines the semantic events from the framework boundary memo", () => {
    const expected: readonly LifecycleEventName[] = [
      "artifact.created",
      "artifact.written",
      "artifact.finalized",
      "persona.activated",
      "workflow.transitioned",
      "memory.remembered",
      "capability.requested",
      "capability.allowed",
      "capability.denied",
      "capability.completed",
      "approval.requested",
      "approval.granted",
      "approval.rejected",
      "approval.expired",
    ]

    expect(LIFECYCLE_EVENTS).toEqual(expected)
  })

  it("maps every event name to its owning primitive", () => {
    expect(Object.keys(LIFECYCLE_EVENT_PRIMITIVES).sort()).toEqual(
      [...LIFECYCLE_EVENTS].sort(),
    )
    expect(LIFECYCLE_EVENT_PRIMITIVES["artifact.written"]).toBe("artifact")
    expect(LIFECYCLE_EVENT_PRIMITIVES["approval.expired"]).toBe("approval")
  })

  it("supports related events for composed primitive operations", () => {
    const event: LifecycleEvent<"workflow.transitioned"> = {
      id: "01KNSAMPLEEVENT00000000000",
      name: "workflow.transitioned",
      primitive: "workflow",
      subject: {
        type: "workflow_run",
        id: "01KNRUN000000000000000000",
      },
      timestamp: "2026-06-04T13:45:00.000Z",
      correlation_id: "01KNCORRELATION000000000",
      related: [
        {
          name: "artifact.written",
          id: "01KNARTIFACTEVENT0000000",
        },
      ],
      data: {
        graph_id: "briefing",
        node_id: "write-brief",
        to_status: "completed",
      },
    }

    expect(event.related?.[0]?.name).toBe("artifact.written")
    expect(event.data?.["node_id"]).toBe("write-brief")
  })
})
