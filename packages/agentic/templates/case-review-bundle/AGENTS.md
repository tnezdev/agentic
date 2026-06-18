# AGENTS.md - Case Review Bundle Starter

Use this file as the harness bootstrap for agents working in this example workspace.

## What This Is

This directory is an Agentic authored bundle starter for local runtime work.

## Start Here

Run the one-shot local authoring loop:

```bash
agentic dev . --json
```

Use the stable serve path when you only need to rerun runtime execution:

```bash
agentic serve . --clean --json
```

The local runtime loads `.agentic/agentic.yaml`, reads the authored bundle declarations, processes the synthetic case-review fixture, and writes runtime state under `.agentic/.data`.

## Boundary

Agentic owns the authored bundle shape, portable declarations, artifact/action vocabulary, and inspectable local state.

The host runtime owns identity, credentials, approval channels, external writes, scheduling, model calls, deployment, and enforcement. This example simulates those host-owned parts just far enough to make the bundle feel concrete.

Do not commit generated `.agentic/.data` state. It is local runtime output.

## What To Inspect

- `.agentic/agentic.yaml` is the authored bundle manifest.
- `.agentic/skills/<skill-name>/SKILL.md` files are skill entrypoints with required `name` and `description` frontmatter.
- `.agentic/artifacts/*.yaml` are artifact type declarations, not runtime artifact instances.
- `.agentic/actions/*.yaml` are action declarations, not action log records.
- `.agentic/capabilities/*.yaml` are policy contracts the runtime checks before effects.
- `.agentic/surfaces/` and `.agentic/schedules/` are ingress declarations that propose artifacts/actions.
- `.agentic/hooks/` reacts to artifact/action events by proposing follow-on actions.
- `.agentic/.data/runs/<run-id>/` is runtime-generated state after the runner executes.

## Expected Demo Shape

The default run should show:

- API-like ingress writes a `case-review-request` and `case-packet` artifact.
- Schedule-like ingress selects the queued packet and runs `case.validate` through a capability check.
- Validation writes a `validation-result` artifact with synthetic QC findings.
- A hook proposes `external.handoff`.
- `handoff.release` requires authenticated reviewer approval, so the runtime records `approval_required` and writes an `approval-request` artifact instead of executing an external write.
