# Second-Brain Research Example

This example shows Agentic as a small research operating system: one persona, one skill, one workflow, a task queue, durable memories, and a finalized artifact.

It is intentionally personal-workflow shaped rather than product-demo shaped. The point is not to automate research end-to-end. The point is to give an agent enough durable structure to pick up a question, preserve useful findings, and produce a reusable brief without turning Agentic into a host runtime.

## Try It

From the repo root:

```bash
bun src/cli/main.ts persona activate researcher --base-dir examples/second-brain
bun src/cli/main.ts skill run research-brief --base-dir examples/second-brain
bun src/cli/main.ts workflow list --base-dir examples/second-brain
bun src/cli/main.ts task next --base-dir examples/second-brain
bun src/cli/main.ts memory recall "source quality" --base-dir examples/second-brain
bun src/cli/main.ts artifact list --base-dir examples/second-brain
```

After installing the package, replace `bun src/cli/main.ts` with `agentic`.

## What Is In Here

| Path | Primitive | Purpose |
|---|---|---|
| `.agentic/personas/researcher.md` | Persona | Activates the research hat: question-first, source-aware, concise synthesis |
| `.agentic/skills/research-brief/skill.md` | Skill | Agent-facing procedure for turning a question into a cited brief |
| `.agentic/workflows/research-loop.json` | Workflow | Four-node loop: frame question, gather sources, synthesize, decide next actions |
| `.agentic/tasks/*.json` | Tasks | A real ready task seeded with an example research question |
| `.agentic/memory/*.json` | Memory | Durable preferences for source quality and output shape |
| `.agentic/artifacts/*` | Artifact | A finalized sample brief showing the target output |

## Why This Shape

Second-brain work repeats. The questions change, but the operating shape stays stable:

- Activate a persona so the agent knows how to think.
- Recall memories so preferences and prior decisions survive the session.
- Run a skill so the work procedure is explicit and reusable.
- Advance a workflow so multi-step work has state.
- Track tasks so open loops do not disappear.
- Write artifacts so the output becomes durable and inspectable.

Agentic owns those primitives. Your host runtime still owns browsing, credentials, model calls, scheduling, approvals, and notification surfaces.

## Extending It

Use this as a starter shape, not a template to preserve exactly.

- Add memories for your own source standards, output preferences, and active research areas.
- Add skills for recurring research genres: literature review, product comparison, meeting prep, or decision memo.
- Add workflow nodes only when they represent real state you need to resume later.
- Keep artifacts as the durable outputs; do not rely on a transcript as the source of truth.
