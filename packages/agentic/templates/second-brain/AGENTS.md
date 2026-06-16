# AGENTS.md — Second-Brain Starter

Use this file as the harness bootstrap for agents working in this workspace.

## What This Is

This directory is an Agentic second-brain research workspace. Agentic provides the durable primitives; the harness provides the model call, tools, research access, and execution loop.

## Start Here

At the start of a research turn, activate the researcher persona:

```bash
agentic persona activate researcher --base-dir .
```

Treat the output as operating context for the turn. Follow the persona's instructions.

Then gather the current working context:

```bash
agentic task next --base-dir .
agentic skill run research-brief --base-dir .
```

If this workspace has a user-provided memory adapter or seeded user memories, recall relevant context as well. This starter does not ship with memory records.

To let the local runtime prepare the turn instead of manually stepping through each primitive, run:

```bash
agentic runtime init local --base-dir .
agentic runtime run research-loop --base-dir .
```

The runtime uses the public `local` target. It prepares a workflow run and a finalized `local-runtime-run` artifact for inspection; it still does not browse, call a model, or complete the research on its own.

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
