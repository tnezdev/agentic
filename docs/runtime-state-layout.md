# Runtime State Layout

Agentic separates authored bundle configuration from runtime-generated state. Core defines portable record shapes and port contracts; each runtime decides where those records live.

## Authored Versus Runtime

Authored workspace content lives in `.agentic/` and is meant to be reviewed, versioned, and shipped with the bundle:

```text
.agentic/
  agentic.yaml
  prompts/
  skills/
  artifacts/      # artifact type declarations
  actions/        # action declarations
  capabilities/
  hooks/
  surfaces/
  schedules/
  policies/
  fixtures/
```

Runtime-generated state lives outside that authored declaration set. The current examples use two local filesystem areas:

```text
.agentic/.data/                         # bundle-specific demo runtime state
  latest.json                           # convenience pointer, not canonical history
  runs/<run-id>/
    actions.jsonl
    actions/<action-id>.json
    artifacts/<artifact-id>.json
    summary.md

.agentic/runtime/local/                 # local runtime package control state
  runtime.json
  invocations/<invocation-id>.json
  invocations/<invocation-id>.pi-system.md
  invocations/<invocation-id>.pi-user.md
  pi-sessions/
  targets/
```

External runtimes do not need these exact paths. They should preserve the record relationships and use storage appropriate to the host.

## Portable Records

| Runtime concern | Core shape | Local example | Notes |
| --- | --- | --- | --- |
| Action request/result | `ActionRecord` | `.agentic/.data/runs/<run-id>/actions/<action-id>.json` plus `actions.jsonl` | Records the proposal type, principal, policy decision, digest, input/output artifact ids, and payload. |
| Approval request | `ApprovalRequest` | `approval-request` artifact body, keyed by the approval-gated action id | The approval grant must bind the exact `action_digest`; model prose is not approval. |
| Artifact instance | `ArtifactRecord` for core artifacts, or runtime-specific records with `ArtifactData` bodies | `.agentic/.data/runs/<run-id>/artifacts/<artifact-id>.json` | Runtime-specific artifact records may carry fields such as `status`, `data_class`, and `source`; large bytes stay behind `ArtifactAttachmentRef`s. |
| Runtime invocation | `RuntimeInvocation` | `.agentic/runtime/local/invocations/<invocation-id>.json` | Tracks runtime package, target, status, start/end times, produced artifact ids, optional workflow run id, and optional harness ref. |
| Workflow run | `Run` | `.agentic/runs/<run-id>.json` when a workflow context is prepared | Optional. Product-path bundles can use actions/artifacts without forcing every flow through a workflow graph. |

## External Runtime Mapping

A hosted runtime can mirror the same shape with object storage, a database, or both. For a GCS-backed JSON-record proof of concept, a natural mapping is:

```text
bundles/<bundle-id>/manifest.json
runs/<run-id>/actions/<action-id>.json
runs/<run-id>/actions.jsonl
runs/<run-id>/artifacts/<artifact-id>.json
runs/<run-id>/approval-requests/<action-id>.json
runs/<run-id>/invocations/<invocation-id>.json
blobs/<runtime-owned-ref>
```

The runtime may choose different keys, indices, or denormalized projections. Core Agentic only requires that the runtime can implement the semantic ports:

- `readArtifact`
- `writeDraftArtifact`
- `requestAction`
- `checkActionStatus`

## State Flow

1. A surface, schedule, hook, harness, or agent proposes an action.
2. The runtime resolves declarations and calls `ActionGatewayPort.requestAction`.
3. The gateway writes an `ActionRecord` with the policy decision and exact digest.
4. If allowed, the runtime executes the handler and writes output artifacts.
5. If approval is required, the runtime writes an `ApprovalRequest` and an approval-request artifact or equivalent approval record.
6. A harness or caller later checks status with `checkActionStatus` and reads artifacts through `readArtifact`.

## Non-Goals

- No Firestore, GCS, Cloud Tasks, queue, or database client in core.
- No migration engine or hosted runtime command in core.
- No compliance, PHI, Ortho-Rad, or ScoutOS-specific schema in core.
- No requirement that external runtimes use the local `.agentic/.data` paths.
- No direct model or harness permission to bypass action gateway records for effects.
