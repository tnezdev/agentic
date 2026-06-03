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

## Skill Capability References

A skill file may declare which capabilities it is associated with using the `capabilities` frontmatter field. This is metadata only — `skill run` still outputs model-readable skill content and does not enforce capability policy or execute capability behavior.

A single capability name:

```text
---
name: issue-triage
description: Triage and route inbound issues.
capabilities: issue_tracker.list_issues
---
```

Multiple capability names use array syntax:

```text
---
name: issue-triage
description: Triage and route inbound issues.
capabilities: [issue_tracker.list_issues, issue_tracker.create_issue]
---
```

Capability names use dot-separated namespacing by convention: `<domain>.<verb>`, e.g. `issue_tracker.create_issue`.

Hosts may use the `capabilities` list on `SkillRef` and `Skill` to bind model-readable skill instructions to the matching executable policy contracts. Skill files without a `capabilities` field load unchanged; the field is absent (`undefined`) rather than an empty array.

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

## How a Host Consumes Declarations

The portable layer provides helpers that let a host make enforcement decisions from a loaded declaration. No host logic needs to parse effects strings or duplicate dispatch-matching rules.

### 1. Validate on load

After reading a declaration from any source (file, API, registry), pass it through
`validateCapability` before using it:

```typescript
import { validateCapability } from "@tnezdev/agentic"

const result = validateCapability(raw)
if (!result.valid) {
  // result.errors is a non-empty array of { field, message } objects.
  // Return a structured error to the caller — do not proceed.
  return { error: "capability_misconfigured", details: result.errors }
}
```

Validation confirms that required fields are present, all effect names are known, approval
configuration is internally consistent, and connection entries are structurally sound. It does not
make network calls, resolve credentials, or check whether a provider is reachable.

### 2. Gate on dispatch context

Before running any capability, check whether the inbound context is permitted:

```typescript
import { capabilityMatchesDispatch } from "@tnezdev/agentic"

if (!capabilityMatchesDispatch(def, inboundDispatch)) {
  return { error: "dispatch_not_allowed" }
}
```

`capabilityMatchesDispatch` returns `true` when `policy.dispatch` is absent (no constraint) and
applies inclusion checks when the field is present. The host provides the dispatch value from its
own session or request context.

### 3. Check required connections

If `def.requires.connections` is non-empty, the host must ensure each connection is available
before continuing:

```typescript
for (const conn of def.requires.connections ?? []) {
  const resolved = await host.resolveConnection(conn.provider, conn.capabilities)
  if (!resolved) {
    return { error: "missing_connection", provider: conn.provider }
  }
}
```

The declaration names the provider and required capability scopes. The host owns credential
storage, token refresh, account selection, and secret handling. These details never appear in the
portable declaration.

### 4. Gate individual tool calls on declared effects

Before allowing a tool execution, verify the capability declares the corresponding effect:

```typescript
import { capabilityAllowsEffect, capabilityAllowsTool } from "@tnezdev/agentic"

if (!capabilityAllowsTool(def, toolName)) {
  return { error: "tool_not_allowed" }
}
if (!capabilityAllowsEffect(def, requiredEffect)) {
  return { error: "effect_not_allowed" }
}
```

### 5. Require approval before sensitive effects

Check whether human approval is required before permitting an effect to execute:

```typescript
import { capabilityRequiresApprovalFor } from "@tnezdev/agentic"

if (capabilityRequiresApprovalFor(def, "external.write")) {
  const approved = await host.requestApproval(def, turn)
  if (!approved) {
    return { error: "approval_rejected" }
  }
}
```

`mode: "before_effect"` means the host must gate execution on approval. `mode: "after_effect"`
means approval is a post-execution confirmation. The declaration names the requirement; the host
owns the approval store, notification surface, approve/reject flow, idempotency, and continuation
behavior.

### What the portable layer does not provide

The portable declaration layer defines vocabulary and structural helpers. It does not provide:

- A credential store or token manager
- An approval UI, inbox, or notification surface
- A provider client or API adapter
- An artifact storage backend
- Session management or turn state
- Deployment or materialization logic

A host that needs any of those things builds or selects its own implementation and drives it using
the declaration fields as input.

## Non-Goals

This design does not introduce a hosted runtime. It does not define provider APIs, credential storage, approval UI, artifact storage, deployment infrastructure, or session management.

Those are host bindings. The portable layer defines the shared vocabulary that lets different hosts describe comparable capabilities without sharing an implementation.

## Neutral Example Set

The following examples are useful fixtures for validating the vocabulary without binding it to a specific host. Each is stored as a JSON file under `src/capability/fixtures/` and validated in tests using `validateCapability`.

### `issue_tracker.list_issues`

External read through a required issue-tracker connection. No approval is needed because no write
effect is declared.

```json
{
  "name": "issue_tracker.list_issues",
  "description": "Use when the user asks to list issues from an external issue tracker.",
  "skill": "issue-triage",
  "requires": {
    "connections": [
      { "provider": "issue_tracker", "capabilities": ["issues.read"] }
    ]
  },
  "policy": {
    "effects": ["external.read"]
  }
}
```

### `issue_tracker.create_issue`

External write with approval required before the effect executes. Dispatch is constrained to web
and chat surfaces. The capability writes an `issue_reference` artifact.

```json
{
  "name": "issue_tracker.create_issue",
  "description": "Use when the user asks to create an issue in an external issue tracker.",
  "skill": "issue-triage",
  "requires": {
    "connections": [
      { "provider": "issue_tracker", "capabilities": ["issues.write"] }
    ]
  },
  "policy": {
    "dispatch": { "from": ["surface:web", "surface:chat"] },
    "tools": ["integration.invoke", "approval.request"],
    "effects": ["external.write", "approval.request"],
    "approval": { "required_for": ["external.write"], "mode": "before_effect" }
  },
  "artifacts": {
    "writes": ["issue_reference"]
  }
}
```

### `communication.place_call`

External write and user notification constrained to chat and voice surfaces. Approval is required
before the call is placed. No connection requirement is declared because call routing is a host
concern.

```json
{
  "name": "communication.place_call",
  "description": "Use when the user asks to place an outbound call to another person.",
  "policy": {
    "dispatch": { "from": ["surface:chat", "surface:voice"] },
    "effects": ["external.write", "user.notify", "approval.request"],
    "approval": { "required_for": ["external.write"], "mode": "before_effect" }
  }
}
```

### `web.search`

External read with no user-owned connection. No approval is needed. This is the minimal
declaration shape — only `name`, `description`, and a single declared effect.

```json
{
  "name": "web.search",
  "description": "Use when the user asks to search the web for current information.",
  "policy": {
    "effects": ["external.read"]
  }
}
```

### `document.create_slide_deck`

Artifact write from model-provided structured content. No external connection or approval is
required. The capability declares the kind of artifact it produces.

```json
{
  "name": "document.create_slide_deck",
  "description": "Use when the user asks to create a slide deck from structured content.",
  "policy": {
    "effects": ["artifact.write"]
  },
  "artifacts": {
    "writes": ["slide_deck"]
  }
}
```

---

If these examples cannot be represented cleanly, the declaration vocabulary is probably missing a concept.
