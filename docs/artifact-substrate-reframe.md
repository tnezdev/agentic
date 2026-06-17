# Artifact Substrate Reframe

Draft memo, 2026-06-16. This is directional design context, not a claim that the current implementation has already collapsed every primitive into artifacts.

## Thesis

Agentic's canonical substrate should be durable artifacts.

Prompts render model-facing context. Skills are reusable procedures for transforming, retrieving, validating, summarizing, or routing artifacts. Actions record what an agent or runtime attempted or performed. Capabilities declare which actions and effects a host may execute. Hooks declare reactions to artifacts and actions while leaving execution to the runtime.

Memory, tasks, workflows, personas, lifecycle events, and inboxes can then become projections or conventions over artifact and action state rather than independent first-class centers.

The larger direction is a meta-framework for declarative agentic systems: a bundle spec plus runtime contract. The bundle declares the system. The host runtime enforces policy, identity, state, approvals, secrets, action execution, and deployment.

## Core Model

The smaller starting-fresh primitive stack is:

```text
prompts + skills + artifacts + actions + capabilities + hooks
```

Everything else can be a composed view over that stack:

```text
personas  = prompt conventions for stable operating stances
memory    = retrieval and consolidation projection over artifacts
tasks     = attention and worklist projection over artifacts
workflows = progress, audit, and resumability projection over artifacts
inboxes   = routing projection over artifacts and dispatches
events    = derived semantic views over action and artifact records
audit     = action log plus artifact lineage plus approval grants
```

This does not mean projections must be throwaway. A projection may be computed on read, materialized for speed, persisted for audit, synced to an external system, or exposed as a CLI primitive. The distinction is that the durable truth is the artifact graph unless a host explicitly chooses another source of truth.

## Bundle Shape

The authored system should be visible as a bundle. In a local checkout, the default layout can be:

```text
.agentic/
  agentic.yaml
  prompts/
  skills/
  artifacts/      # artifact declarations, not runtime instances
  actions/        # action declarations, not action log records
  capabilities/
  hooks/
  surfaces/
  schedules/
  integrations/
  policies/
  deploy/
  evals/
  fixtures/
  .data/          # default local runtime state, gitignored
```

Within the bundle, `artifacts/` and `actions/` are shorthand for contracts or type declarations. Runtime instances live in the configured state store.

Default local state can be `.agentic/.data`, but the destination should be configurable:

```json
{
  "state": {
    "adapter": "filesystem",
    "dir": ".agentic/.data"
  }
}
```

The same bundle could point at another local directory or a cloud state adapter in deployment. The principle is:

```text
.agentic/ = authored bundle/configuration
state     = runtime-generated artifacts, actions, approvals, invocations
```

Fixtures are the exception. `.agentic/fixtures/` contains checked-in sample data for evals and demos, not live runtime state.

## Deployable System

The long-term product shape is a deployable declarative agentic system.

A host runtime should be able to point at a repo, validate the `.agentic/` bundle, bind required secrets and integrations, provision a target environment, run evals, and bring the declared system online.

Deploy flow:

1. Load and validate the bundle.
2. Check artifact and action declarations.
3. Check capability handlers and policy completeness.
4. Bind identity, integration, and secret requirements outside git.
5. Provision state storage and execution environments.
6. Materialize surfaces and schedules.
7. Load prompts, skills, capabilities, hooks, and policies.
8. Run evals and smoke tests.
9. Mark the deployment live.

The bundle remains portable. Deploy adapters materialize it on a concrete target.

## Artifact

An artifact is the durable object the agent and host can point at later. It should be versioned, typed, inspectable, finalizable, and linkable to source or derived artifacts.

Examples:

- `continuity-brief`
- `session-wrap`
- `open-loop-snapshot`
- `case-packet`
- `qc-finding`
- `validation-result`
- `handoff-note`

Artifacts are not only final documents. They can be source packets, intermediate observations, accepted outputs, rejected drafts, external references, or derived summaries.

## Prompt

A prompt is a renderable model-facing context unit.

This is broader than the current `Persona` primitive. A persona is one useful prompt convention: a stable operating stance. But a bundle also needs startup prompts, validation prompts, extraction prompts, routing prompts, handoff prompts, review prompts, and evaluator prompts.

Prompts should be authored in the bundle, rendered by the runtime or harness with selected artifacts and variables, and recorded through actions when they are used.

## Skill

A skill is a reusable procedure over artifacts. It can instruct an agent how to inspect artifacts, produce a new artifact, validate an artifact, consolidate artifacts, or decide which artifacts should be foregrounded.

Examples:

- `session-brief` transforms profile, policy, continuity, recent sessions, and open loops into a `session-brief` artifact.
- `wrap-session` transforms session outcomes and current artifacts into a `session-wrap` artifact.
- `recall-context` retrieves relevant artifacts and returns a compact model-facing context.
- `validate-case` checks a case packet and produces a `validation-result` artifact.

The skill stays model-facing. If it can produce external effects, a capability declaration carries the host-facing policy contract.

## Action

An action is the observable attempted or completed operation during an invocation.

Examples:

- `prompt.render`
- `artifact.read`
- `artifact.write`
- `tool.invoke`
- `approval.request`
- `external.write`
- `hook.run`

Actions answer what happened without requiring every process to become a workflow graph. They can carry status, inputs, outputs, effects, capability name, policy result, approver requirements, error details, timestamps, and invocation correlation.

An agent should propose sensitive actions. The runtime should decide whether those actions are allowed, denied, unavailable, or require approval.

## Runtime Action Gateway

The action gateway is the mandatory runtime path between a proposed action and any real effect.

It is not agent-authored logic, prompt text, or an optional example convention. It is host/runtime infrastructure. Surfaces, schedules, hooks, harness tools, and agents may all propose actions, but they should all enter through the same gateway before artifacts are written, external systems are mutated, approvals are requested, or privileged handlers run.

Canonical flow:

```text
action proposal
  -> resolve action declaration and capability
  -> check principal, effects, artifacts, data class, integration state, and approval policy
  -> compute canonical action digest
  -> record allow, deny, or approval_required
  -> execute only allowed handlers, or create an approval request for approval-gated actions
```

The SDK/core layer should own the portable pieces:

- Action proposal, action record, action decision, digest, and approval-request types.
- Declaration validation and pure policy helpers.
- Canonical action digest computation.
- The gateway contract a runtime adapter must implement.

The runtime adapter should own enforcement:

- Making the gateway the only path to effect-producing handlers.
- Binding the current principal, surface, session, and invocation context.
- Persisting action records, artifacts, approval requests, and approval grants.
- Resolving integration availability, scopes, secrets, and provider health.
- Verifying approval grants through authenticated host-owned channels.
- Executing approved handlers in the appropriate sandbox or provider adapter.
- Preventing raw artifact-write, external-write, shell, network, or secret-bearing tools from bypassing the gateway.

End users should author declarations and handlers, not reimplement the security-critical membrane. If a host exposes direct effect tools to the model alongside the action gateway port, the gateway is decorative rather than protective. Prefer narrow Agentic ports for artifact reads/draft writes and action request/status; harnesses may bind those ports into model-facing tools, but effect execution should stay inside runtime-owned handlers.

## Capability

A capability is the policy contract around an action type or action family.

It should declare:

- Allowed effects.
- Required integrations and scopes.
- Valid input and output artifact types.
- Surface or schedule constraints.
- Approval requirements.
- Sufficient approver rules.
- Handler binding or expected runtime implementation.

Capability existence is not the same as capability availability. Availability depends on the current principal, surface, integration state, scopes, policy, data class, provider health, and required approvals.

## Approval

Approval is a runtime-verified grant from an authenticated principal for an exact action.

A principal may be a human, agent, service account, group, organization, or external trusted system. The runtime verifies identity through a trusted channel and checks whether that principal satisfies the capability's approver rule.

Approval should bind to:

- Action id.
- Action digest.
- Capability.
- Effects.
- Input artifact ids and versions.
- Target external account or resource.
- Expiration.
- Approving principal.

The runtime executes the stored approved action. It should not accept a fresh agent-supplied payload after approval, because that would allow action mutation after the grant.

No agent self-attestation is sufficient. Text like "the reviewer approved" is untrusted unless it arrives through a runtime-authenticated approval channel.

## Hook

A hook is a declarative reaction to an artifact or action event.

Examples:

- When a `session-brief` artifact is written, index it for retrieval.
- When a `validation-result` artifact is written, propose a review action.
- When an action fails with `missing_connection`, notify the owner or create a repair artifact.

Hooks are useful automation seams, but they are not the policy engine. A hook may propose a follow-on action. That follow-on action must still pass capability policy and approval gates before producing effects.

## Memory As Projection

Current Agentic has a separate memory store. The reframe says memory can instead be composed from artifacts plus retrieval and consolidation skills.

Mapping:

| Existing memory verb | Artifact-substrate interpretation |
| --- | --- |
| `remember` | Create or update a durable artifact such as `memory-note`, `lesson`, `observation`, or `continuity-brief`. |
| `recall` | Run retrieval over artifact metadata, tags, bodies, embeddings, and derived summaries. |
| `dream` | Run a consolidation skill that produces summary artifacts and lineage links. |
| `reinforce` | Update retrieval metadata, create a derived artifact, or emit an action record that an indexer can use. |
| `forget` | Archive, suppress, redact, or de-index artifacts according to host policy. Deletion is not the only forgetting mode. |

Retrieval infrastructure is still real. Embeddings, lexical indexes, recency windows, L1/L2/L3 tiers, and summary caches may all be needed. They should be treated as indexes or materialized views over artifact truth, not as a second canonical memory database.

This also improves auditability. A remembered fact should point back to a durable source artifact or a derived summary artifact instead of living as an isolated string in a separate store.

## Tasks As Projection

A task is one way work needing attention appears. It is not necessarily the canonical work object.

Examples:

- An `open-loop` artifact with `status: ready` appears in a task queue.
- A `case-packet` without a finalized `validation-result` appears as "validate this case".
- A GitHub issue mirrored as an artifact appears as a task projection when labels and assignment match.
- A user reminder becomes an attention projection over an artifact plus dispatch schedule.

Persisted task records can remain useful as local materialized views, CLI conveniences, or external tracker bridges. The design pressure is to avoid making task storage the only place current intent can live.

## Workflows As Projection

A workflow is a reusable progress model over artifact transformations. It is useful when work needs explicit state, auditability, restartability, or multi-step coordination.

Example:

```text
profile + policy + continuity + recent sessions + open loops
  -> session-brief skill
  -> session-brief artifact
```

The workflow projection can overlay the same work as:

```text
load-profile
  -> read-policy
  -> read-continuity
  -> inspect-recent-sessions
  -> check-open-loops
  -> synthesize-briefing
```

That graph is valuable for progress and audit. It should not be required before an assistant can start a conversational turn from mounted artifacts.

## Frame

The likely missing runtime handoff concept is a resolved context frame.

A frame is ephemeral. It is what a harness gives to a model or execution loop for one turn:

```ts
type Frame = {
  prompts: RenderedPrompt[]
  skills: Skill[]
  artifacts: ArtifactRef[]
  capabilities?: CapabilityDef[]
  principal?: PrincipalRef
  surface?: SurfaceRef
  projections?: {
    memory?: unknown
    task?: Task
    workflow_run_id?: string
  }
}
```

The frame should not become a god object. It resolves context for a turn. Durable state still lands as artifacts, actions, approvals, and invocation records. Hosts decide how to build frames, apply policy, call models, run tools, and persist transcripts.

## Surfaces And Schedules

Surfaces connect the outside world to the agentic system.

Examples:

- API endpoints.
- Webhook receivers.
- Web UI routes.
- Chat or voice entrypoints.
- Agent-to-agent ingress.

A surface should translate external input into artifacts and action requests. It should not bypass capability policy.

```text
external request -> surface -> artifact/action request -> capability policy -> execution or approval
```

Schedules are timed ingress. A cron-like declaration should propose actions through the same gateway as APIs and webhooks. Deploy adapters can materialize schedules as Cloud Scheduler jobs, cron triggers, queues, or another target-specific mechanism.

## Secrets And Environment

Secrets should be declared as requirements, not stored in the bundle and not rendered into prompts by default.

The model may see that a connection is available, unavailable, unauthorized, or missing required scope. It should not see raw credentials.

Secrets should be injected only into runtime-owned action handlers or sandboxed execution environments that require them, scoped to the capability being executed.

## Code Execution And Sandboxing

Actions that run code need declared execution environments.

A handler might be a local function, hosted function, container, job, provider call, or sandboxed command. The important boundary is that the agent does not receive an ambient powerful shell with broad secrets and network access.

Default sandbox posture should be:

```text
no network unless declared
no secrets unless declared
read-only mounted input artifacts
write only declared output artifacts
required timeout
resource limits
capability-scoped environment injection
audited execution
```

The runtime should re-check policy immediately before executing effects. Hooks and harness tools should not be able to bypass the action gateway.

## Harness Boundary

A model harness is not the same as the Agentic runtime.

A harness can own model calls, streaming, session trees, compaction, model/provider selection, prompt delivery, and tool-call protocol. Pi is a strong candidate harness adapter because it exposes CLI, RPC, SDK, prompt/template loading, skills, event hooks, and custom tools.

The policy boundary should still live in the Agentic runtime:

```text
model proposes tool/action call
  -> Agentic runtime receives action request
  -> runtime checks capability, policy, integration state, and approval
  -> runtime executes, blocks, or records approval required
  -> result returns to harness
```

In a deployed runtime, broad raw tools such as shell, file write, or direct network should not be exposed to the model unless the surrounding sandbox and policy make that safe. Prefer narrow Agentic ports for artifact reads/draft writes and action request/status, then let the harness adapter decide how those ports appear to a model.

## Host Boundary

This reframe keeps the existing framework boundary intact.

Agentic owns portable shapes, bundle validation, local filesystem dogfood, typed artifact semantics, prompt and skill loading, action vocabulary, capability vocabulary, hook declarations, and small pure helpers.

Hosts own identity, sessions, scheduling, credentials, approval UI, provider calls, transcript storage, live indexes, retries, deployment, sandboxing, and policy enforcement.

If this reframe is correct, Agentic should avoid adding deeper host-owned behavior to memory, task, or workflow primitives. Instead, it should make artifact-backed composition easier and let examples prove which projections deserve core helpers.

## Regulated Case Review Implication

This is why the Agentic reframe may come full-circle to regulated case-review work.

A regulated review system likely does not need Agentic to host its runtime. It needs auditable, validated, handoff-safe transformations over domain objects.

Mapping:

| Regulated review concern | Artifact-substrate shape |
| --- | --- |
| Case or study packet | `case-packet` artifact |
| Image/report metadata | typed source artifacts |
| Model or tool observation | `observation` artifact |
| QC finding | `qc-finding` artifact |
| Validation pass/fail | `validation-result` artifact |
| Reviewer handoff | `handoff-note` artifact |
| Prior cases or guidelines | artifact corpus plus retrieval skill |
| Needs authorized review | task projection over artifacts |
| Intake to validation to signoff | workflow projection over artifacts |
| Audit trail | action log plus artifact lineage plus approval grants |

The overlap is validation, audit, retrieval, and handoff tooling. The host runtime remains responsible for infrastructure, regulated-data policy, identity, auth, provider integrations, deployment, and operational reliability.

Approval should be granted by authenticated principals, not by agent text. A principal may be a human, agent, service account, group, organization, or external trusted system. The host verifies identity and checks whether that principal satisfies the capability's approver rule for the exact action being approved.

## Migration Direction

Do not delete current primitives first.

Near-term direction:

- Keep memory, task, and workflow APIs stable while treating them as projections in docs and examples.
- Extend examples to show artifact-led starts before task/workflow projection starts.
- Rework the sandbox spike toward the proposed `.agentic/` bundle layout before promoting core APIs.
- Prefer new work that improves artifact metadata, artifact selection, artifact lineage, and frame preparation.
- Treat retrieval indexes as adapter or host concerns over artifacts.
- Avoid adding deeper independent persistence semantics to memory/tasks/workflows unless a concrete use case cannot be represented as an artifact projection.

Possible later direction:

- Add artifact and action query fields that make projections easier, such as status, relation metadata, source locators, media type, lineage edges, effects, and policy outcomes.
- Add a small frame-preparation helper once multiple examples converge on the same handoff shape.
- Recast memory commands as convenience verbs over artifact-backed retrieval and consolidation.
- Recast task commands as local materialized views over attention artifacts.
- Recast workflow runs as progress records over artifact transformation plans.

## Open Questions

- What artifact metadata is required before task and memory projections feel natural?
- Is `Frame` the right name for the resolved turn handoff, or should it remain runtime-local until examples converge?
- Should artifact lineage remain a single `derived_from` edge or become a first-class relation set?
- Which memory behaviors truly require separate storage rather than indexes over artifacts?
- How much projection vocabulary belongs in Agentic core versus examples or host runtimes?
- What is the smallest regulated case-review example that proves validation and audit without importing private host concerns?
- What is the minimum surface declaration that can materialize as API, webhook, UI, agent-to-agent, or schedule ingress?
- What execution-environment declaration is expressive enough for local dev, containers, hosted functions, and remote sandboxes?
- Which Pi SDK/RPC hooks are sufficient for a first harness adapter, and where must the Agentic runtime enforce policy independently?
