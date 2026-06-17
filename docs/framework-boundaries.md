# Agentic Framework Boundaries

Draft memo for [#87](https://github.com/tnezdev/agentic/issues/87).

## Thesis

Agentic is the primitive layer, not the host runtime.

Agentic should define portable, typed, in-turn building blocks that agents and host runtimes can use. It should not absorb scheduling, transport, identity, auth flows, background execution, provider integrations, or platform-specific orchestration.

The package is most useful when it gives host runtimes a shared vocabulary and small tested primitives, while leaving deployment and execution policy to the host.

## Boundary Rule

Agentic owns declarations, data shapes, pure matching logic, local filesystem implementations, and CLI dogfood that exercises the primitives.

Host runtimes own durable orchestration, reliability semantics, user identity, provider credentials, approval flows, queues, retries, observability, and transport-specific execution.

When a design question is unclear, prefer the smaller primitive boundary first. Add host behavior only after more than one host/runtime needs the same portable shape.

## What Production Host Usage Has Validated

Recent production-host usage has validated several reusable concepts without making the host itself part of Agentic:

- Long-lived workflow runs need stable graph semantics across deploys.
- Skills need a way to reference executable capability contracts without becoming executors themselves.
- Capability declarations need portable policy vocabulary for effects, approval requirements, dispatch constraints, artifacts, and connection requirements.
- Human-in-the-loop approval is a first-class host-runtime requirement, but Agentic's role is to declare where approval is required rather than implement the approval flow.
- Artifacts are a real primitive: agents produce durable outputs that benefit from versioning, finalization, and typed metadata.
- Personas are useful as active hats: they declare memory tags, skills, task filters, workflow hints, and model-facing instructions.
- Task queues are useful in-loop, but external work trackers are host integrations rather than core package adapters.
- Lifecycle events are useful integration seams, but event handling belongs to the host or harness.
- Sessions are important for learning and improvement, but raw sessions are runtime-owned. Agentic should enable session review workflows without owning the session abstraction.

## Primitive Boundaries

| Area | Agentic Owns | Host Runtime Owns |
| --- | --- | --- |
| Memory | Store/recall/reinforce/dream primitives and filesystem storage | Global memory policy, cross-agent visibility, private retrieval pipelines |
| Skills | Markdown skill loading, metadata, capability references | Model prompting strategy, execution of described procedures |
| Workflow | Graphs, runs, transitions, state derived from history | Scheduling, wakeups, lifecycle ownership, long-running process management |
| Tasks | Task shape, adapter interface, local queue semantics | External trackers, assignment policy, board stewardship, async workers |
| Persona | Declarative active-hat metadata and rendered body | Identity, session ownership, authorization, automatic application of defaults |
| Artifacts | Versioned content blobs, metadata, finalize/write semantics | UI rendering, collaboration, inboxes, external delivery, attachment APIs |
| Ports / Action Gateway | Semantic artifact/action port interfaces, action records, approval-request vocabulary, pure policy and digest helpers | Mandatory enforcement path, handler execution, approval grants, audit storage, provider calls |
| Sources | Read-only loader abstraction and composition | Remote storage, deployment, synchronization, access control |
| Capabilities | Portable declarations and pure policy helpers | Provider clients, credentials, approval UI, enforcement, audit logs |
| Dispatch | Message shape, filters, and pure match logic | Webhooks, queues, recurrence, transport, handler execution |

See [`runtime-adapter-boundary.md`](runtime-adapter-boundary.md) for the current ports/runtime/harness split used by the `agentic-next` product-path spike.

## Capability Availability And Discovery

Capability declarations answer what an action requires. They do not, by themselves, answer whether the action is available right now.

Production hosts need to tell an agent which capabilities are usable in the current frame and why unavailable capabilities are blocked. Availability can vary by inbound surface, user connection state, provider scope, approval policy, organization membership, host configuration, or temporary provider outage.

Agentic should support this with portable declaration and error vocabulary:

- A capability can declare required effects, dispatch constraints, connection requirements, artifact reads/writes, and approval policy.
- Pure helpers can validate declarations and check declared policy against a dispatch/frame supplied by the host.
- Structured errors can explain why a capability is unavailable without exposing host internals.

The host owns the live capability catalog for a frame: which declarations are installed, which providers are connected, which accounts apply, which tools are enabled, and which actions are currently allowed.

The goal is that an agent can ask "what can I do here?" and receive portable answers, while the host remains responsible for determining the live answer.

## Connection State And Recovery

Provider-backed capabilities depend on connection state. Production usage has shown that failures are often not simple "tool failed" cases; they are missing auth, expired auth, wrong account, missing provider scope, disabled integration, unavailable provider, or host misconfiguration.

Agentic should not manage credentials, OAuth flows, account selection, token refresh, or provider-specific repair. Those are host responsibilities.

Agentic should define enough portable vocabulary that an agent can recover gracefully:

- `missing_connection` when a required provider connection does not exist.
- `provider_unauthorized` when an existing connection can no longer be used.
- `capability_misconfigured` when the declaration or host binding is invalid.
- `provider_unavailable` when the external system is temporarily unreachable.
- `dispatch_not_allowed`, `effect_not_allowed`, and `tool_not_allowed` when policy blocks the requested action.

Hosts can map provider-specific failures into these portable errors. Agents can then explain the problem, request repair, choose another path, or stop safely without parsing provider logs.

## Trust Boundaries And Untrusted Inputs

Hosted agents routinely encounter untrusted input: external documents, emails, issues, web pages, messages, transcripts, and provider records.

Agentic should help hosts carry source and policy metadata, but it should not own the full trust model.

Agentic-owned pieces can include:

- Source locators and metadata on loaded config or artifacts.
- Dispatch context that identifies the inbound surface or sender namespace.
- Capability effects that distinguish reads, writes, user notification, external calls, and privileged compute.
- Structured policy errors when a host refuses an action for trust or policy reasons.

Host-owned pieces include:

- Allowlists and deny lists.
- Redaction, quarantine, and content filtering.
- Prompt-injection handling.
- User/org-specific policy.
- Secret handling and data-loss prevention.
- Decisions about whether untrusted content may be summarized, acted on, stored, or forwarded.

The portable layer should make trust-relevant context visible. The host decides what is trusted and what actions are permitted.

## Progress And Observability

Long-running agent actions need progress updates and debuggable traces. Production hosts need to answer questions like what happened, what is waiting, what failed, what was approved, and what artifact changed.

Agentic should not define a telemetry backend, trace store, dashboard, or progress UI. It can still make host observability easier through lifecycle events and structured results.

Useful event seams include:

- A workflow transitioned.
- An artifact was written or finalized.
- A capability was requested, allowed, denied, or completed.
- Approval was requested, granted, rejected, or expired.
- A memory was written or reinforced.

Hosts decide whether those events become logs, metrics, user-visible progress messages, audit records, dispatches, or queue jobs. Agentic's role is to make the events coherent and portable enough that hosts do not need to infer them from ad hoc command output.

## Examples Before Core

Examples are the incubation layer between production-specific integrations and core Agentic primitives.

Patterns should start in `examples/` when they are useful but not yet proven as core abstractions. Good candidates include:

- Session review workflows.
- External task tracker adapters.
- HITL approval flows.
- Host dispatch bridges.
- Connection repair flows.
- Capability discovery UIs or catalogs.
- Lifecycle event indexing.

Examples can use real integration shapes without making those integrations package dependencies or privileged core adapters. If multiple examples converge on the same portable concept, that is evidence to promote the concept into core types, helpers, or docs.

## Human-In-The-Loop Approval

Human-in-the-loop approval is critical for hosted agents that can affect external systems, spend money, send messages, mutate durable records, or act through user-owned accounts.

Agentic should enable HITL by defining portable approval requirements, not by owning an approval product.

Agentic-owned pieces:

- Capability declarations can name effects that require approval.
- Capability declarations can express approval timing, such as `before_effect`.
- Structured policy errors can distinguish `approval_required`, `approval_rejected`, and related failure modes.
- Lifecycle events can give hosts a seam to record approval requests, completions, expirations, or rejected actions.
- Skills can describe how an agent should prepare an approval request for a human.
- Workflows can model steps that wait for approval before continuing.

Host-owned pieces:

- Approval UI, inbox, chat surface, email, push notification, or voice confirmation.
- Identity and authorization: who may approve, for whom, and under what conditions.
- Durable approval records and audit logs.
- Expiration, retry, cancellation, and idempotency behavior.
- Continuation semantics after approval or rejection.
- Provider-specific enforcement and secret handling.

The host receives a capability declaration and a requested effect, then decides how to ask the human and how to resume. Agentic should make that decision easier to express and test, but it should not embed one approval surface or persistence model.

This keeps HITL portable: the same capability can say "external write requires approval" whether the host asks through a web app, chat thread, mobile notification, CLI prompt, voice call, or a future surface.

## Sessions And Learning Loops

Sessions are central to agent learning, review, and improvement, but they sit on the host-runtime side of the boundary.

A raw session includes identity, model/provider behavior, tool calls, transport context, continuation rules, transcript storage, privacy policy, and retention policy. Those are host concerns. Agentic should not become a session host or define a mandatory transcript store.

Agentic should instead provide the primitives that let hosts and users build session review loops:

- A workflow can define the review process.
- A skill can describe the reflection procedure.
- An artifact can store the resulting summary, reflection, or narrative.
- Memory can retain durable lessons extracted from the session.
- Lifecycle events can give hosts a reliable seam for triggering review, indexing outputs, or recording that a reflection was written.

The reflection itself should be user-defined. Agentic should not prescribe a built-in session summary schema unless multiple independent uses converge on the same portable shape.

This belongs in examples before it belongs in core. An `examples/` session-review pattern can show how a host-owned session transcript becomes a workflow-produced artifact and memory update without implying that Agentic owns sessions.

## Lifecycle Events, Hooks, And Dispatch

Agentic should define lifecycle event vocabulary for primitive operations. It should not own hook execution.

Examples of semantic lifecycle events:

- `artifact.created`
- `artifact.written`
- `artifact.finalized`
- `persona.activated`
- `workflow.transitioned`
- `memory.remembered`

These events are not the same thing as local hook scripts. For example, `artifact.written` is a semantic event. `.agentic/hooks/artifact.written` is one local CLI/dogfood way to react to that event.

This keeps three layers separate:

| Layer | Role |
| --- | --- |
| Lifecycle event | Agentic-owned vocabulary for something that happened while using a primitive |
| Local hook | CLI or harness-owned convenience for running a local side effect |
| Dispatch | Portable message/routing primitive that a host may use to carry an event |

A host runtime may map lifecycle events into dispatches, queues, logs, indexes, webhooks, or no-op handlers. The host decides execution semantics: sync or async handling, retries, idempotency, authorization, observability, and failure policy.

The important boundary is:

> Lifecycle event vocabulary belongs in Agentic; hook execution belongs to harnesses and hosts.

## Existing Issue Decisions

### #49: Pin Runs To Graph Versions

Provisional decision: reactivate with sharper scope.

If Agentic owns workflow runs, it should preserve the meaning of a run across graph changes. Long-lived runs are not only a host concern; they are a correctness requirement for the workflow primitive once runs can outlive a process or deploy.

The implementation should stay focused on graph identity and runtime resolution. It should not add scheduling, migrations, deployment management, or host lifecycle policy.

### #23: GitHub Issues TaskAdapter

Provisional decision: do not add a GitHub Issues adapter to core.

The original drift problem is real, but a platform-specific adapter is host integration work. Core Agentic should not ship GitHub as a privileged proof adapter.

If this remains useful, it belongs in one of these places:

- `examples/`, as a documented host integration sketch.
- External integration package, if there is enough reuse pressure.
- A later host-runtime project, where auth, rate limits, assignment policy, and write behavior can be owned explicitly.

Core can still improve the task adapter interface if examples expose missing seams, but the GitHub adapter itself should stay out of `@tnezdev/agentic`.

### #16: Composition Object / Scope

Provisional decision: keep design-only and reframe around `Scope`.

The original pain was that persona metadata does not automatically shape task queries, memory recall, skill foregrounding, or workflow selection. That remains valid, but the answer should not be to turn the workflow `Runtime` into a multi-primitive god object.

`Scope` is the current best name for the concept:

- One active hat at a time.
- Persona metadata supplies defaults, not hard restrictions.
- Adapter-backed primitives can be queried through scoped defaults.
- Identity stays outside the scope.
- Hosts may choose whether and how to apply the scope.

This needs a resolved design comment before implementation. The design should account for lifecycle events and capability declarations, not just task filtering.

## Public Positioning

Agentic can use host-runtime experience as evidence without depending on private systems or naming downstream products.

Useful public language:

- "production personal-assistant host runtimes"
- "long-lived agent workflows"
- "host applications using Agentic primitives"
- "provider-backed capabilities"
- "human approval boundaries"

Avoid language that implies Agentic includes the host runtime itself. The README/package story should not promise hosting, webhooks, session management, provider auth, approval UI, or background job execution.

## Next Shippable Slices

1. Post a condensed version of this memo to #87.
2. Reactivate #49 as a focused workflow correctness issue.
3. Rewrite or close #23 to remove the core GitHub adapter direction; preserve any useful example/integration notes separately.
4. Update #16 with a `Scope`-centered design frame and keep it design-only until the questions converge.
5. File a focused lifecycle-event vocabulary issue if #87 accepts the boundary.
6. Consider a README positioning update after the boundary decisions settle.

## Non-Goals

Agentic should not add:

- Hosted sessions
- Webhook receivers
- Background schedulers
- Provider clients
- Credential storage
- Approval inboxes or UI
- Platform-specific task adapters in core
- Identity or actor ownership fields
- A general plugin executor

Those are host/runtime responsibilities. Agentic should provide the vocabulary and primitives that make those hosts easier to build, test, and reason about.
