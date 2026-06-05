---
name: research-brief
description: Activate when an agent needs to convert a research question into a cited second-brain brief
tags: [second-brain, research, artifact]
---

# Research Brief

Use this procedure when the task is to answer a research question for later reuse.

## Procedure

1. Restate the question in one sentence.
2. Identify the decision or action the answer should support.
3. Gather a small set of high-signal sources. Prefer primary sources, official docs, source code, standards, and direct measurements.
4. Extract findings as claims with source references. Do not preserve raw browsing notes unless they are necessary evidence.
5. Synthesize tradeoffs. Call out uncertainty and missing information.
6. Write a brief artifact. Keep it readable without the transcript.
7. Validate that the artifact has at least one PARA bucket tag.
8. Finalize the artifact once taxonomy validation passes.
9. Add follow-up tasks only for unresolved questions that affect a decision.

## Artifact Contract

Write a `research-brief` artifact with these sections:

- `Question`
- `Why It Matters`
- `Findings`
- `Tradeoffs`
- `Recommendation`
- `Sources Consulted`
- `Follow-Up Questions`

Every artifact must include at least one PARA bucket tag in this form:

```text
para:<bucket>/<slug>
```

Allowed buckets are `project`, `area`, `resource`, and `archive`. Choose the bucket that describes where the brief belongs in the user's second-brain system.

Do not finalize the artifact until this tag is present. Finalization means the brief is durable output for this research pass, not that it can never be superseded.

## Quality Bar

- A reader can tell what changed in their understanding.
- Recommendation follows from the evidence.
- Sources are named clearly enough to revisit.
- Unknowns are explicit instead of hidden in confident prose.
