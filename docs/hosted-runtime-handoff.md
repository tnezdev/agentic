# Hosted Runtime Handoff

This is the handoff for building a hosted Agentic runtime outside core. It maps
the authored bundle lifecycle to runtime-owned services without adding `deploy`,
hosting, auth, queues, storage clients, or handler execution to `@tnezdev/agentic`.

Use the local bundle lifecycle as the reference behavior:

```bash
agentic validate examples/case-review-bundle --json
agentic serve examples/case-review-bundle --clean --json
agentic inspect examples/case-review-bundle --json
agentic eval examples/case-review-bundle --json
```

The local runtime proves the contract. A hosted runtime chooses its own storage,
sandbox, deployment, and approval UI.

## Runtime Responsibilities

| Concern | Hosted runtime owns | Agentic core provides |
| --- | --- | --- |
| Bundle source | Fetch, version, and address authored `.agentic/` files | Manifest and declaration types, loaders, validation helpers |
| Run identity | Create run ids, invocation ids, principals, and storage keys | Portable record shapes and local lifecycle vocabulary |
| Artifact state | Persist artifact records, bodies, attachment refs, and projections | `ArtifactRecord`, `ArtifactData`, `ArtifactAttachmentRef`, artifact ports |
| Action gateway | Resolve declarations, evaluate policy, compute digests, record decisions | Action/capability declaration vocabulary and port interfaces |
| Approvals | Store approval requests, grants, denials, and reviewer metadata | `ApprovalRequest` shape and digest-binding convention |
| Handler execution | Resolve handler locators, load code, bind secrets, sandbox, retry, audit | Handler boundary guidance only, no arbitrary-code execution |
| Inspection/eval | Expose latest run records and projections for debugging and checks | `inspect`/`eval` expectations proven by the local runtime |

## Minimal Runtime Contract

A hosted runtime should implement the same semantic ports that the local runtime
uses today:

- `readArtifact`
- `writeDraftArtifact`
- `requestAction`
- `checkActionStatus`

Those ports are the runtime boundary. Surfaces, schedules, hooks, harnesses, and
agents propose actions through `requestAction`; they do not perform effects
directly. Approval grants must bind the exact `action_digest` recorded on the
action request.

## Suggested Record Layout

The local filesystem layout is not required. For a JSON-record hosted proof of
concept, a portable shape is:

```text
bundles/<bundle-id>/manifest.json
bundles/<bundle-id>/declarations/actions/<action-id>.json
bundles/<bundle-id>/declarations/artifacts/<artifact-id>.json
runs/<run-id>/latest.json
runs/<run-id>/invocation.json
runs/<run-id>/actions.jsonl
runs/<run-id>/actions/<action-id>.json
runs/<run-id>/artifacts/<artifact-id>.json
runs/<run-id>/approval-requests/<action-id>.json
blobs/<runtime-owned-ref>
```

Runtimes may add indices, projections, database rows, object-store keys, or cache
records. The invariant is that action decisions, approval requests, artifact
records, and invocation records remain inspectable after the run.

## First Hosted Spike Checklist

- Load an authored bundle and validate declarations before creating a run.
- Create an invocation record with runtime package/name, target, status, start
  time, and run id.
- Persist action requests before executing any effect-producing handler.
- Record the exact action digest used for policy and approval decisions.
- Write artifact records through runtime-owned storage, with large bytes behind
  opaque attachment refs.
- Represent approval-required actions as durable records that a UI or operator can
  grant or deny later.
- Record handler source, version, locator, or digest before handler execution.
- Expose enough run state for an `inspect` equivalent and an `eval` equivalent.

## Non-Goals

- No hosted runtime implementation in core.
- No `agentic deploy` behavior in this package.
- No storage client, migration engine, queue, scheduler, webhook receiver, auth UI,
  approval inbox, or provider SDK in core.
- No ScoutOS, Ortho-Rad, GCP, PHI, compliance, or domain-specific schema in core.
- No model tool binding or handler sandbox in core.

Related docs:

- [`docs/runtime-state-layout.md`](runtime-state-layout.md)
- [`docs/runtime-adapter-boundary.md`](runtime-adapter-boundary.md)
- [`docs/handler-packaging-boundary.md`](handler-packaging-boundary.md)
- [`docs/bundle-authoring-loop.md`](bundle-authoring-loop.md)
