# Agentic Next Example

This is a full-swing spike for the artifact-substrate reframe in `docs/artifact-substrate-reframe.md`.

It is intentionally not the current stable example shape. It asks what Agentic feels like if the authored system is a bundle of prompts, skills, artifact declarations, action declarations, capabilities, hooks, surfaces, schedules, integrations, policies, deploy targets, evals, and fixtures.

## Run It

From the repo root:

```bash
bun run examples/agentic-next/run.ts --clean
```

The runner writes local runtime state to:

```text
examples/agentic-next/.agentic/.data/runs/<run-id>/
```

That directory is ignored by git because it is runtime state, not authored bundle content.

## What It Demonstrates

The bundle models a synthetic regulated case-review flow:

- `surfaces/case-intake-api.yaml` accepts an API-like fixture and emits durable artifacts.
- `schedules/nightly-qc-sweep.yaml` selects queued `case-packet` artifacts and proposes validation.
- `capabilities/case.validate.yaml` allows an agent principal to write a `validation-result` artifact.
- `hooks/validation-result.propose-handoff.yaml` reacts to findings and proposes `external.handoff`.
- `capabilities/handoff.release.yaml` requires authenticated reviewer approval before external write effects.
- The runner records `approval_required` instead of accepting agent text as approval.

`run.ts` routes each proposed action through the runtime-local action gateway and narrow Agentic ports for artifact reads/draft writes plus action request/status. A harness adapter could expose those ports as model-facing tools, but the example keeps the boundary high-level: runtime-bound handlers still own demo artifact writes and effects. The gateway resolves the action declaration, checks principal/data-class/effect/capability/integration policy, computes a stable action digest, executes only allowed runtime-bound callbacks, and creates an `approval-request` artifact for approval-gated actions.

No model is called. No external system is contacted. The point is to inspect whether the bundle/runtime boundary feels right.

## Inspect The Output

After a run, start with the printed summary path, or read:

```text
examples/agentic-next/.agentic/.data/latest.json
examples/agentic-next/.agentic/.data/runs/<run-id>/summary.md
examples/agentic-next/.agentic/.data/runs/<run-id>/actions.jsonl
examples/agentic-next/.agentic/.data/runs/<run-id>/artifacts/
```

The important outcome is that `external.handoff` is not executed. It is recorded with an exact digest and `approval_required` policy result, and an `approval-request` artifact points at the exact action that needs an authenticated grant. The summary action table shows each gateway policy decision and digest prefix.

## Bundle Layout

```text
.agentic/
  agentic.yaml
  prompts/
  skills/         # <skill-name>/SKILL.md entrypoints with required name/description metadata
  artifacts/
  actions/
  capabilities/
  hooks/
  surfaces/
  schedules/
  integrations/
  policies/
  deploy/
  evals/
  fixtures/
  .data/          # generated, ignored
```

Within this example, `artifacts/` and `actions/` are declarations. Runtime instances live in `.agentic/.data`.

## What To Judge

- Does the authored bundle feel like piano keys laid out in the repo?
- Is it clear which files are authored and which are runtime state?
- Do actions give enough observability without forcing a workflow graph?
- Are capabilities and approvals concrete enough to keep policy out of prompt text?
- Does surface/schedule ingress feel like it proposes artifacts/actions rather than bypassing policy?
- Is this a better starting point than refactoring current primitives first?
