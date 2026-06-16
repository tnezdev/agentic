---
name: steward-review
description: Activate when an agent needs to curate second-brain inputs into a small, trustworthy next-action set
tags: [second-brain, stewardship, review, tasks]
---

# Steward Review

Use this procedure when the task is to keep a second-brain workspace clean and purposeful after research or inbox processing.

## Procedure

1. List the active task or the task that requested stewardship.
2. Inspect referenced artifacts before creating new work.
3. Classify each relevant input as promote, keep, defer, archive, or discard.
4. Create follow-up tasks only for decisions or actions that should survive the current turn.
5. Write a review artifact that explains the choices without depending on the transcript.
6. Include a valid PARA bucket tag on any finalized review artifact.

## Artifact Contract

Write a `steward-review` or `weekly-plan` artifact with these sections:

- `Current State`
- `Promote`
- `Archive Or Discard`
- `Task Updates`
- `Recommended Next Focus`

Every finalized artifact must include at least one PARA bucket tag in this form:

```text
para:<bucket>/<slug>
```

Allowed buckets are `project`, `area`, `resource`, and `archive`.

## Quality Bar

- The queue is smaller or clearer after the review.
- The next action is specific enough for `task next` to be useful.
- Low-signal inputs are explicitly archived or discarded instead of silently retained.
- The review explains why work was not created for some inputs.
