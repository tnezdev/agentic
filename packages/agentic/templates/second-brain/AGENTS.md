# AGENTS.md — Second-Brain Starter

Use this file as the harness bootstrap for agents working in this workspace.

## What This Is

This directory is an Agentic second-brain research workspace. Agentic provides the durable primitives; the harness provides the model call, tools, research access, and execution loop.

## Start Here

For a first smoke test, let the local runtime prepare the turn:

```bash
agentic run
```

For a manual harness turn, show the seeded task and activate the researcher
persona:

```bash
agentic task show 01KTC500000000000000000001 --base-dir .
agentic persona activate researcher --base-dir .
```

Treat the output as operating context for the turn. Follow the persona's instructions.

Then gather the current working context:

```bash
agentic skill run research-brief --base-dir .
agentic artifact read 01KTC500000000000000000020 --base-dir .
agentic artifact read 01KTC500000000000000000030 --base-dir .
```

If this workspace has a user-provided memory adapter or seeded user memories, recall relevant context as well. This starter does not ship with memory records.

If a follow-up task is tagged `stewardship`, switch hats instead of forcing the
researcher persona to do curation:

```bash
agentic persona activate second-brain-steward --base-dir .
agentic skill run steward-review --base-dir .
```

The runtime uses the public `local` target. It records a runtime invocation, prepares a workflow run, and writes a finalized `local-runtime-run` artifact for inspection; it still does not browse, call a model, or complete the research on its own.
It initializes local runtime glue on first run.

If Pi is installed and you want the local runtime to hand this prepared turn to a harness, keep the public target and add the harness flag:

```bash
agentic run --harness pi
```

## Boundary

Agentic is not the harness. Do not expect it to browse, call a model, schedule work, manage auth, or execute approvals.

The harness owns model calls, tool execution, web or file research, credentials, scheduling, notifications, and final user communication.

Agentic owns personas, skills, memories when configured, tasks, workflows, and artifacts.

## Research Output

When research produces a reusable answer, persist it as a `research-brief` artifact. Do not leave the final answer only in the transcript.

Every artifact must include at least one PARA bucket tag:

```text
para:<bucket>/<slug>
```

Allowed buckets are `project`, `area`, `resource`, and `archive`.

For multi-step research, use the `research-loop` workflow as the enforcement gate: write the brief, validate taxonomy, then finalize the artifact.
