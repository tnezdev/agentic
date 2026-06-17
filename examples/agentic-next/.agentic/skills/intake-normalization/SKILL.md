---
name: intake-normalization
description: Normalize inbound case-review requests into durable artifacts. Use when handling intake before validation or external effects.
metadata:
  agentic.tags: case-review,intake
---

# Intake Normalization

Transform an inbound request into durable artifacts before any validation or external effect occurs.

1. Preserve the raw request as a `case-review-request` artifact.
2. Extract the reviewable payload into a `case-packet` artifact.
3. Attach source metadata for the surface, fixture, request id, and data class.
4. Mark the packet `intake_ready` so a schedule or explicit action can select it.
5. Do not execute review, handoff, or notification effects during intake.
