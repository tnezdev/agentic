# Lifecycle Events

Lifecycle events are Agentic-owned vocabulary for semantic facts about primitive operations. They answer "what happened?" without deciding who handles it, where it is stored, or how side effects run.

Agentic defines the event names and portable envelope in `packages/agentic/src/types.ts`:

- `LifecycleEventName`
- `LifecycleEvent`
- `LifecycleEventSubject`
- `LifecycleEventRef`
- `LIFECYCLE_EVENTS`
- `LIFECYCLE_EVENT_PRIMITIVES`

## Boundary

Agentic owns lifecycle event vocabulary. Hosts and harnesses own execution semantics.

| Layer | Role | Owner |
| --- | --- | --- |
| Lifecycle event | Portable vocabulary for something that happened while using a primitive | Agentic |
| Local hook | CLI or harness convenience for running a local side effect | Harness/host |
| Dispatch | Portable message/routing shape a host may use to carry an event | Agentic shape, host execution |

A host may map lifecycle events into logs, metrics, queues, dispatches, webhooks, indexes, audit records, user-visible progress, or nothing. Agentic does not define retries, persistence, idempotency, authorization, or UI.

## Event Vocabulary

Initial semantic events:

- `artifact.created`
- `artifact.written`
- `artifact.finalized`
- `persona.activated`
- `workflow.transitioned`
- `memory.remembered`
- `capability.requested`
- `capability.allowed`
- `capability.denied`
- `capability.completed`
- `approval.requested`
- `approval.granted`
- `approval.rejected`
- `approval.expired`

## Envelope

`LifecycleEvent` is intentionally small:

```ts
type LifecycleEvent = {
  id?: string
  name: LifecycleEventName
  primitive: LifecyclePrimitive
  subject: LifecycleEventSubject
  timestamp: string
  correlation_id?: string
  related?: LifecycleEventRef[]
  data?: Record<string, unknown>
}
```

`subject` identifies the primitive-owned thing the event is about, such as an artifact id, persona name, workflow run id, memory key, capability name, or approval request id.

`correlation_id` lets a host group multiple primitive events produced by one operation.

`related` lets composed operations remain explicit. For example, a workflow transition that also writes an artifact can emit or record a `workflow.transitioned` event related to an `artifact.written` event. Agentic does not require one event to contain the other's full payload.

`data` is primitive-specific context. Keep it portable and avoid provider internals; hosts can store private execution details elsewhere.

## Hooks Are Not Events

`.agentic/hooks/artifact.written` is one local way to react to the semantic event `artifact.written`. The event name is Agentic vocabulary; hook lookup, process execution, timeout policy, stderr handling, and failure behavior are harness behavior.

Existing CLI hooks continue to work as local dogfood. The lifecycle event vocabulary does not require hosts to use local hooks.

## Dispatch Is Not Event Handling

`Dispatch` is a portable inbound message shape and filter vocabulary. A host may choose to carry lifecycle events through dispatch, but Agentic does not provide queues, webhooks, schedulers, or handler execution.

This keeps the boundary clear: Agentic can say `approval.requested` happened; the host decides whether that becomes a Slack message, database row, audit log, retryable job, or no-op.
