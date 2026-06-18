---
name: validate-case
description: Validate a case packet and produce a validation-result artifact. Use when checking case-review packets before handoff.
metadata:
  agentic.tags: case-review,validation
---

# Validate Case

Read a `case-packet` and produce a `validation-result` artifact.

Validation is artifact transformation, not external release. Use declared guidelines, record the capability check, and write findings with evidence pointers back to packet fields. If validation finds issues, set status to `needs_reviewer` so hooks can propose handoff.

Do not send findings outside the runtime from this skill.
