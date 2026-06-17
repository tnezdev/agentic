# Runtime Adapter Boundary

Agentic owns portable contracts and pure helpers. Runtime adapters own enforcement. Harness adapters own model/tool-call protocol binding.

This boundary keeps `@tnezdev/agentic` useful for hosted runtimes without turning the core package into a host, sandbox, provider SDK, MCP server, or deployment platform.

## Layer Model

| Layer | Owns | Does Not Own |
| --- | --- | --- |
| Core Agentic | Types, declarations, port interfaces, lifecycle vocabulary, pure validation/policy/digest helpers | Storage services, queues, identity, secrets, providers, approval UI, model loops |
| Runtime adapter | Port implementation, persistence, policy enforcement, approval records, handler execution, audit, live integration state | Model/provider conversation loops, tool schema protocols, user-facing app surfaces unless it is also the host |
| Harness adapter | Model calls, streaming, context delivery, tool schemas, MCP/tool-call/RPC mapping | Policy authority, approval grants, direct effect execution that bypasses the runtime |
| Host/deploy target | Infrastructure, auth, secrets, queues, logs, UI, compliance controls | Core vocabulary changes just to fit one platform |

## Core Contracts

The high-level runtime seam is the `AgenticPorts` interface in `packages/agentic/src/types.ts`:

```ts
type AgenticPorts = ArtifactPort & ActionGatewayPort
```

`ArtifactPort` covers safe artifact reads and draft writes:

- `readArtifact(input)`
- `writeDraftArtifact(input)`

`ActionGatewayPort` covers effect-producing requests and status checks:

- `requestAction(input)`
- `checkActionStatus(input)`

These are semantic ports, not model tools. A harness may expose them as tool names such as `read_artifact` or `request_action`, but that mapping belongs outside core Agentic.

## Runtime Adapter Responsibilities

A runtime adapter implementing these ports must:

- Resolve authored declarations into runtime records.
- Bind the current principal, surface, session, invocation, and data boundary from host context.
- Compute canonical action digests from the resolved action payload.
- Persist action records, artifacts, approval requests, and approval grants in its own storage.
- Enforce declared capability policy before executing any effect-producing handler.
- Create approval requests for approval-gated actions instead of accepting model prose as approval.
- Execute only allowed or approved handlers, with runtime-owned access to secrets and providers.
- Return portable request/status results without leaking provider secrets or host internals.

The local package proves this shape with `LocalActionGateway`, `LocalArtifactPort`, and `LocalAgenticPorts` in `packages/agentic-runtime-local`.

## Harness Adapter Responsibilities

A harness adapter may translate Agentic ports into model-facing tools, CLI commands, Pi SDK calls, MCP tools, or provider-specific function schemas. The harness owns:

- Model/provider selection and calls.
- Streaming, turn loops, compaction, and session transcript storage.
- Tool schema naming and provider protocol details.
- Prompt delivery and model-facing context assembly.

The harness should not expose broad raw filesystem, shell, network, or provider-write tools beside a supposedly protective gateway unless an external sandbox and policy layer make that safe. Otherwise the gateway is decorative.

## What Stays Out Of Core

Do not add these to `@tnezdev/agentic` just to make a runtime adapter concrete:

- GCP, Cloud Run, Cloud Tasks, GCS, Firestore, or queue clients.
- MCP servers or provider-specific tool schemas.
- OAuth, credentials, identity, secrets, or connection repair flows.
- Approval inboxes, web UI, Slack, email, or voice approval channels.
- Sandboxes, shell execution, network policies, or code runners.
- Ortho-Rad, ScoutOS, PHI, compliance, or product-specific primitives.

A future ScoutOS Labs GCP runtime should consume these contracts as an external adapter. Its job is to stress the boundary with real storage, queues, audit, and approval mechanics, not to pull those mechanics into core.
