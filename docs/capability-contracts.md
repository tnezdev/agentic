# Portable Capability Contracts

Agentic primitives need two separate layers:

- **Skills** are model-readable instructions.
- **Capabilities** are executable, policy-bearing contracts.

A skill tells an agent how to do work. A capability declares whether that work may be executed, where it may be executed from, what external requirements it has, and which side effects a host runtime may allow.

This package should define the portable declaration vocabulary. Host runtimes enforce the declarations, store state, provide user interfaces, bind external providers, and decide how approvals happen.

## Why This Boundary Exists

Local agent toolbelts can often treat skills as plain markdown. Hosted agent systems need an additional boundary because model-readable instructions may lead to real side effects:

- Reading or writing external systems
- Creating or revising durable artifacts
- Sending messages across agent or user boundaries
- Requesting human approval before an action
- Using user-owned accounts or provider connections
- Running only from certain inbound surfaces or dispatch contexts

The declaration layer should name these requirements without assuming one runtime, provider, storage engine, user interface, or deployment target.

## Skills

A skill remains the model-facing procedure. It should be easy to read, search, and pipe into a model.

Example:

```text
.agentic/skills/issue-triage/SKILL.md
```

The skill body can explain when to use the procedure, what information to gather, and how to phrase outputs. It should not be the only source of truth for executable permissions.

## Capabilities

A capability is the host-facing execution contract around a skill or procedure.

Example shape:

```yaml
name: issue_tracker.create_issue
description: Use when the user asks to create an issue in an external issue tracker.
skill: issue-triage
requires:
  connections:
    - provider: issue_tracker
      capabilities:
        - issues.write
policy:
  dispatch:
    from:
      - surface:web
      - surface:chat
  tools:
    - integration.invoke
    - approval.request
  effects:
    - external.write
    - approval.request
  approval:
    required_for:
      - external.write
    mode: before_effect
artifacts:
  writes:
    - issue_reference
```

This declaration is not an executor. It is input to a host runtime that can decide whether a requested action is allowed and how to perform it.

## Effects

Effects are portable names for side-effect classes. They are useful for policy, audit, review, and model-visible error recovery.

Initial vocabulary:

- `memory.read`
- `memory.write`
- `artifact.read`
- `artifact.write`
- `external.read`
- `external.write`
- `approval.request`
- `dispatch.send`
- `user.notify`
- `compute.privileged`

Hosts may define narrower internal effects, but portable declarations should prefer these generic names unless a real use case requires expansion.

## Connection Requirements

A connection requirement says that a capability needs access to a user-owned or host-owned external account. It does not define where credentials live or how authorization happens.

Example:

```yaml
requires:
  connections:
    - provider: issue_tracker
      capabilities:
        - issues.read
        - issues.write
```

Host responsibilities include connection lookup, token handling, reauthorization, account selection, and secret redaction.

## Approval Policy

Some capabilities should require human approval before producing sensitive effects.

Example:

```yaml
policy:
  effects:
    - external.write
    - approval.request
  approval:
    required_for:
      - external.write
    mode: before_effect
```

The declaration names the requirement. The host owns the approval store, notification surface, approve/reject flow, idempotency, and continuation behavior.

## Dispatch Constraints

Capabilities may be valid only for certain inbound contexts. Rather than introduce a separate surface system, capability policy can reuse the dispatch vocabulary.

Example:

```yaml
policy:
  dispatch:
    from:
      - surface:web
      - surface:chat
```

This keeps the same mechanism usable for web, chat, voice, scheduled jobs, agent-to-agent messages, command-line turns, and future host-defined sources.

## Artifacts

Workflow artifacts prove that agent processes often produce durable outputs. Hosted systems may need richer artifact declarations so agents and hosts agree on the kind of object a capability reads or writes.

Minimal portable shape:

```yaml
kind: issue_reference
description: A durable reference to an issue created or found in an external tracker.
media_type: application/json
```

Capability declarations can reference artifact effects:

```yaml
artifacts:
  reads:
    - requirements_document
  writes:
    - issue_reference
```

Host-specific concerns stay outside the portable artifact declaration: storage layout, revision history, rendering, previews, inboxes, archiving, and UI state.

## Structured Policy Errors

Host runtimes should return structured failures that an agent can understand without parsing provider logs or runtime internals.

Initial vocabulary:

- `policy_denied`
- `dispatch_not_allowed`
- `tool_not_allowed`
- `effect_not_allowed`
- `missing_connection`
- `approval_required`
- `approval_rejected`
- `provider_unauthorized`
- `provider_unavailable`
- `capability_misconfigured`

The portable layer defines names and broad meaning. Hosts decide how to detect, log, display, and recover from these failures.

## Host Responsibilities

The host runtime owns:

- Enforcing capability policy
- Resolving connections and credentials
- Performing provider calls
- Creating approval requests
- Storing and rendering artifacts
- Logging and auditing effects
- Mapping dispatches to active turns
- Returning structured success and error results
- Deploying or materializing declarations into runtime-specific storage

The portable package should not assume a particular host architecture.

## Non-Goals

This design does not introduce a hosted runtime. It does not define provider APIs, credential storage, approval UI, artifact storage, deployment infrastructure, or session management.

Those are host bindings. The portable layer defines the shared vocabulary that lets different hosts describe comparable capabilities without sharing an implementation.

## Neutral Example Set

The following examples are useful fixtures for validating the vocabulary without binding it to a specific host:

- `issue_tracker.list_issues`: external read through a required issue-tracker connection
- `issue_tracker.create_issue`: external write with approval before effect
- `communication.place_call`: user notification / external write constrained by dispatch context
- `web.search`: external read with no user-owned connection
- `document.create_slide_deck`: artifact write from model-provided structured content

If these examples cannot be represented cleanly, the declaration vocabulary is probably missing a concept.
