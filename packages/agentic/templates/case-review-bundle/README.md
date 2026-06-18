# Case Review Bundle Starter

This workspace is a starter copy of Agentic's canonical authored bundle example. It shows how prompts, skills, artifact declarations, action declarations, capabilities, hooks, surfaces, schedules, integrations, policies, deploy targets, evals, fixtures, and local handlers fit together as one runnable bundle.

## Run It

```bash
agentic validate . --json
agentic inspect . --json
agentic serve . --clean --json
agentic eval . --json
```

The local runtime writes state to:

```text
.agentic/.data/runs/<run-id>/
```

That directory is ignored because it is runtime state, not authored bundle content.

## What It Demonstrates

- `surfaces/case-intake-api.yaml` accepts an API-like fixture and emits durable artifacts.
- `schedules/nightly-qc-sweep.yaml` selects queued `case-packet` artifacts and proposes validation.
- `capabilities/case.validate.yaml` allows an agent principal to write a `validation-result` artifact.
- `hooks/validation-result.propose-handoff.yaml` reacts to findings and proposes `external.handoff`.
- `capabilities/handoff.release.yaml` requires authenticated reviewer approval before external write effects.
- The local runtime records `approval_required` instead of accepting agent text as approval.

No model is called. No external system is contacted. The point is to make the bundle/runtime boundary concrete and inspectable.

## Authored Versus Runtime State

Within this example, `artifacts/` and `actions/` are declarations. Runtime instances live under `.agentic/.data` after `agentic serve` runs.
