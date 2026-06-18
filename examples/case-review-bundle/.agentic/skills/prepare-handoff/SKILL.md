---
name: prepare-handoff
description: Prepare reviewer handoff payloads and approval requests. Use when validation findings need human review before external release.
metadata:
  agentic.tags: case-review,handoff,approval
---

# Prepare Handoff

Prepare the action payload for a reviewer queue handoff, then let the runtime evaluate `handoff.release`.

If the capability requires approval, stop at `approval_required`. The model may summarize why approval is needed, but it cannot approve the action. The host must authenticate an approver and grant the exact action digest.
