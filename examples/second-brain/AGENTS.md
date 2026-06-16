# AGENTS.md — Second-Brain Example

Use this file as the harness bootstrap for agents working in this example workspace.

## What This Is

This directory is an Agentic second-brain research workspace. Agentic provides the durable primitives; the harness provides the model call, tools, research access, and execution loop.

Workspace base dir:

```bash
examples/second-brain
```

## Start Here

For a first smoke test, ask the workspace what is ready and let the local runtime
prepare the turn:

```bash
agentic task next --base-dir examples/second-brain
agentic runtime init local --base-dir examples/second-brain
agentic runtime run examples/second-brain
```

For a manual harness turn, show the seeded task and activate the researcher
persona:

```bash
agentic task show 01KTC500000000000000000001 --base-dir examples/second-brain
agentic persona activate researcher --base-dir examples/second-brain
```

Treat the output as operating context for the turn. Follow the persona's instructions.

Then gather the current working context:

```bash
agentic skill run research-brief --base-dir examples/second-brain
agentic artifact read 01KTC500000000000000000020 --base-dir examples/second-brain
agentic artifact read 01KTC500000000000000000030 --base-dir examples/second-brain
```

If this workspace has a user-provided memory adapter or seeded user memories, recall relevant context as well. This public example does not ship with memory records.

If a follow-up task is tagged `stewardship`, switch hats instead of forcing the
researcher persona to do curation:

```bash
agentic persona activate second-brain-steward --base-dir examples/second-brain
agentic skill run steward-review --base-dir examples/second-brain
```

The runtime uses the public `local` target. It prepares a workflow run and a
finalized `local-runtime-run` artifact for inspection; it still does not browse,
call a model, or complete the research on its own.

When using the checked-in repository example, treat runtime output as local
dogfood state. Do not commit generated `.agentic/runtime/`, `.agentic/runs/`, or
ad hoc artifact directories unless deliberately refreshing the fixture. A real
harness run may mark the seed task done; restore or replace it before committing
the example as a reusable starter.

If Pi is installed and you want the local runtime to hand this prepared turn to a
harness, keep the public target and add the harness flag:

```bash
agentic runtime run examples/second-brain --harness pi
```

If the installed `agentic` binary is unavailable while working from this repo, use:

```bash
bun ../../packages/agentic/src/cli/main.ts persona activate researcher --base-dir .
bun ../../packages/agentic/src/cli/main.ts task next --base-dir .
bun ../../packages/agentic/src/cli/main.ts skill run research-brief --base-dir .
```

When running `project-kickoff`, load its skill before planning:

```bash
agentic skill run project-kickoff --base-dir examples/second-brain
```

## How To Use Agentic

- Use `persona activate` to load the hat and turn-level operating instructions.
- Use `skill run` to load reusable procedures.
- Use `memory recall` only when the user has configured memory records or an adapter for this workspace.
- Use `task next` to find the active research question.
- Use `workflow run` for multi-step research that needs resumable state.
- Use `artifact create`, `artifact write`, and `artifact finalize` for durable outputs.
- Finalize artifacts only after the workflow's taxonomy validation step passes.
- When a workflow step requires user intent that is not already available, ask concise questions before creating durable artifacts. Label any assumptions explicitly.

## Boundary

Agentic is not the harness. Do not expect it to browse, call a model, schedule work, manage auth, or execute approvals.

The harness owns:

- Model calls
- Tool execution
- Web or file research
- Credentials and authorization
- Scheduling and notifications
- Final user communication

Agentic owns:

- Personas
- Skills
- Memories when the user configures them
- Tasks
- Workflows
- Artifacts

## Research Output

When research produces a reusable answer, persist it as a `research-brief` artifact. Do not leave the final answer only in the transcript.

Every artifact must include at least one PARA bucket tag:

```text
para:<bucket>/<slug>
```

Allowed buckets are `project`, `area`, `resource`, and `archive`. The slug names the concrete bucket, such as `para:project/reading-queue-refresh`, `para:area/personal-finance`, or `para:resource/cellular-plans`.

For multi-step research, use the `research-loop` workflow as the enforcement gate: write the brief, validate taxonomy, then finalize the artifact. Finalization means the artifact is durable output for this research pass.

Use this shape:

- Question
- Why It Matters
- Findings
- Tradeoffs
- Recommendation
- Sources Consulted
- Follow-Up Questions
