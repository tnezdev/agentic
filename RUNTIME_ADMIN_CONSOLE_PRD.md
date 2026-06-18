# Runtime Admin Console PRD

## Summary

Agentic should provide a generic, bundle-aware runtime admin console for local development and runtime operation. The console is the control-plane UI for authored bundles: it lets a human inspect runs, review approvals, browse artifacts, trace actions, configure local integration credentials, and understand why a capability is available, blocked, waiting, or failed.

The closest mental model is a WordPress admin panel: one generic administrative surface for the runtime and bundle, with separate product-facing UIs built on top of artifacts and actions when a host application needs domain-specific UX.

This PRD is intentionally generic. It should not depend on any downstream product, organization, data domain, cloud provider, or compliance regime.

## Problem

The local runtime now has enough semantics to support realistic human-in-the-loop workflows:

- Authored bundles declare artifacts, actions, capabilities, surfaces, schedules, hooks, integrations, policies, deploy targets, evals, and fixtures.
- The runtime writes inspectable action records, artifacts, approval requests, approval decisions, and summaries.
- Approval-gated actions can stop at `approval_required`, receive a human grant or rejection, and resume the stored action payload.

Today those records are mostly visible through JSON files and CLI output. That is powerful for debugging, but it is not a good human review or operator experience. Common runtime questions require manual file inspection:

- What approvals are waiting for me?
- What exact action, digest, effects, and artifacts am I approving?
- What happened in this run?
- Which action wrote this artifact?
- Why was this action denied or gated?
- Which integrations are required and are they connected locally?
- What would a product UI consume after the runtime completes?

As Agentic moves from primitives toward authored bundles and local feedback loops, this observability/control surface becomes part of the product path.

## Goals

- Provide a first-class local runtime admin console that works for any authored bundle using local runtime state.
- Make pending approvals reviewable and actionable without reading JSON files.
- Make action, artifact, policy, and integration state observable enough to debug bundle behavior.
- Make the distinction between runtime admin UI and product-specific UIs explicit.
- Keep core Agentic focused on portable declarations, loaders, validation, policy helpers, and record shapes.
- Keep runtime environment concerns in runtime packages, with storage adapters as internal runtime implementation details.

## Non-Goals

- Do not add a hosted SaaS admin product to core Agentic.
- Do not add provider SDKs, OAuth clients, secret stores, or cloud clients to `@tnezdev/agentic` core.
- Do not require product-specific artifact renderers in the generic admin console.
- Do not make the local admin console the required production approval UI.
- Do not define one mandatory database, object-store layout, queue, auth provider, or deployment platform.
- Do not leak or encode any private downstream project or regulated-domain assumptions.

## Users

- **Bundle author:** validates that declarations compose into a coherent runtime flow.
- **Local developer:** debugs handlers, actions, approvals, artifacts, evals, and integration setup.
- **Human approver:** reviews pending approval requests and approves or rejects exact actions.
- **Runtime operator:** inspects failures, blocked capabilities, stale credentials, and action history.
- **Product developer:** uses admin-console observations to design product faces over selected artifacts/actions.

## Product Model

Agentic should distinguish three layers:

| Layer | Purpose | Example Responsibilities |
| --- | --- | --- |
| Authored bundle | Portable declaration source | Artifacts, actions, capabilities, surfaces, hooks, schedules, policies, integrations |
| Runtime admin console | Generic control plane | Approvals, action log, artifact browser, integration status, run/eval observability |
| Product face | Domain/application UX | Custom review workspace, customer portal, report viewer, artifact editor, task board |

The admin console is bundle-aware but generic. It should understand runtime records and declarations, not domain-specific product intent.

Product faces consume runtime artifacts/actions through host-owned APIs and can render richer workflows. They should not be forced into the admin console, and the admin console should not become an application framework.

## Core Use Cases

### 1. Review Pending Approvals

A runtime action requires human approval before external effects or privileged writes. The console should show:

- Action id, type, principal, capability, digest, and status.
- Approval request id, expiration, approver rule, and required principal/role hints.
- Input artifacts and output effects.
- Payload preview with redacted sensitive values.
- Relevant draft artifact preview when one exists.
- Approve/reject controls that call the runtime approval path.
- Decision history after grant, rejection, expiration, or retry.

Acceptance criteria:

- A pending approval can be granted or rejected from the UI.
- Approval grants bind the stored action digest and do not accept a fresh action payload.
- After approval, the UI shows the resumed action as completed and links to output artifacts.
- Rejection does not execute effects and remains visible in the audit trail.

### 2. Inspect Action Log

The console should show a chronological action table for the selected run:

- Action id and type.
- Status: completed, denied, approval_required, failed.
- Principal, capability, policy decision, policy reason.
- Digest prefix and full digest copy affordance.
- Surface/schedule/hook source when present.
- Input and output artifact links.
- Payload preview and handler error when present.

Acceptance criteria:

- A developer can answer "what happened?" without opening `actions.jsonl` manually.
- Denied, failed, and approval-gated actions are visually distinct.
- Action detail pages link directly to related artifacts and approval records.

### 3. Browse Artifacts

The console should expose runtime artifact instances:

- Artifact list filtered by type, status, tag, data class, and created action.
- Artifact detail view with metadata and body preview.
- Derived-from and created-by links.
- Version/finalized state when available.
- Attachment refs when available, without assuming local file bytes are readable.

Acceptance criteria:

- A user can trace an artifact back to the action that wrote it.
- A user can trace from an artifact to derived artifacts and approval records.
- Large or binary attachments are represented as refs, not blindly rendered.

### 4. Understand Run State

The console should provide a run overview:

- Latest run pointer and run selector.
- Bundle name, version, schema version, and manifest path.
- Loaded inventory: prompts, skills, artifacts, actions, capabilities, hooks, surfaces, schedules, integrations, policies, deploy targets, evals, fixtures.
- Summary of completed, failed, denied, and approval-required actions.
- Summary of artifacts by type/status.
- Eval results for the latest run when available.

Acceptance criteria:

- The existing local runtime summary is visible in the browser.
- The latest run can be distinguished from older runs.
- Evals and validation status can be surfaced without replacing CLI output.

### 5. Inspect Capability And Policy Decisions

For any action, the console should show the declaration and enforcement path:

- Action declaration effects and input/output artifacts.
- Matched capability declaration.
- Allowed principals.
- Required data classes.
- Integration requirements.
- Approval requirements.
- Actual runtime policy decision and reason.

Acceptance criteria:

- A bundle author can understand why an action was allowed, denied, or gated.
- Capability availability can distinguish declaration errors, missing integrations, missing approval, and denied effects.

### 6. Manage Local Integration Connectivity

The console should show declared integrations and local connection status:

- Required integrations from `.agentic/integrations/*`.
- Required scopes/effects.
- Local status: missing, configured, expired, healthy, misconfigured, unavailable.
- Connect/disconnect/test controls where the local runtime has a supported adapter.
- Redacted credentials and safe diagnostics.
- Capabilities/actions blocked by missing credentials.

Acceptance criteria:

- No raw secret values are displayed.
- Credentials are stored by the runtime/host, not in portable bundle declarations.
- Missing or expired local credentials explain which capabilities are blocked.
- OAuth/provider-specific setup is adapter-owned and optional, not a core dependency.

## Runtime Package Versus Storage Adapter Recommendation

The admin-console discussion raises a design question: should Agentic have different runtime packages, or should it only have different storage adapters?

Recommendation: this is not either/or.

Use **runtime packages** for materially different execution environments and host responsibilities. Use **storage adapters** inside those runtimes for persistence choices.

### Runtime Package Owns

A runtime package is the environment adapter. It owns the concrete semantics for:

- Process/server model.
- Handler loading and execution constraints.
- Approval command/API implementation.
- Admin console serving and routing.
- Integration credential storage and OAuth callback handling.
- Secret access.
- Queue/scheduler/webhook materialization.
- Filesystem availability or lack of it.
- Runtime-specific audit and observability projection.
- Mapping from semantic Agentic ports to host infrastructure.

Examples:

- A local Node/Bun runtime can read local files, import local handler modules, launch a local web console, and store dev credentials in local stores.
- A Cloudflare runtime may use Workers, Durable Objects, KV/R2/D1, and different handler/deployment constraints.
- A GCP/Node runtime may use Cloud Run, Cloud Tasks, object storage, databases, service accounts, and hosted auth callbacks.

Those are different runtime environments, not just storage backends.

### Storage Adapter Owns

A storage adapter is a persistence implementation used by a runtime:

- Filesystem JSON records.
- SQLite.
- Object storage plus JSON records.
- Relational database rows.
- Durable Object state.
- In-memory test storage.

Storage adapters should not decide approval semantics, handler execution, OAuth flows, or admin UI behavior. They should implement persistence primitives required by the runtime.

### Admin Console Reuse

The console should start inside `@tnezdev/agentic-runtime-local` because the local runtime already has the record layout and approval commands.

If a second runtime wants the same UI, extract a reusable console layer only after the seam is clear. A likely future shape:

- `@tnezdev/agentic`: core declarations, loaders, validation, pure policy/digest helpers, portable types.
- `@tnezdev/agentic-runtime-local`: local runtime, local storage adapters, local approval commands, bundled local admin console.
- Optional future shared console package: browser UI and view-model components that consume a runtime admin API.
- Hosted runtime packages/apps: implement their own admin API and may reuse the shared console UI if useful.

Do not put the web console into core Agentic. Core should not become a host runtime.

### Storage Adapter Configuration

Storage adapter selection should be runtime configuration, not artifact/action semantics. The authored bundle describes what the workflow means; deploy/runtime config describes where runtime records are persisted.

Preferred shape for local runtime deploy configuration:

```yaml
id: local-demo
kind: deploy_target

runtime:
  local:
    storage:
      adapter: filesystem
      dir: .agentic/.data
```

The same runtime could later support another local persistence adapter without changing bundle declarations:

```yaml
runtime:
  local:
    storage:
      adapter: sqlite
      database: .agentic/.data/runtime.db
```

A hosted runtime can use the same concept while interpreting supported adapters through its own package:

```yaml
runtime:
  hosted-node:
    storage:
      adapter: object-json
      bucket_env: AGENTIC_STATE_BUCKET
      prefix: runs/
```

Validation and runtime behavior should be layered:

- `agentic validate` checks that deploy storage config is structurally valid.
- `agentic serve` or runtime startup checks whether the selected runtime supports the requested storage adapter.
- `agentic inspect` and the admin console show active storage adapter, state location, and storage health.
- Secrets and non-portable values should be referenced through host/runtime config or environment variables, not committed into bundle declarations.

Storage adapter names may overlap across runtime packages, but support and constraints are runtime-owned. For example, a local runtime and a hosted runtime may both expose `sqlite`, while using different deployment, durability, and concurrency assumptions.

## Functional Requirements

### Commands

Initial command shape:

```bash
agentic ui [target]
agentic serve [target] --ui
```

Open question: whether `agentic ui` should be top-level core CLI that delegates to the runtime, or a local-runtime command surfaced through existing runtime delegation. Prefer runtime delegation so core does not own web serving.

### Pages

Initial local console pages:

- `/` or `/runs/latest`: run overview.
- `/approvals`: pending and decided approvals.
- `/approvals/:action_id`: approval detail and approve/reject controls.
- `/actions`: action log.
- `/actions/:action_id`: action detail.
- `/artifacts`: artifact browser.
- `/artifacts/:artifact_id`: artifact detail.
- `/integrations`: declared integrations and local connection status.
- `/capabilities/:capability_id`: capability/policy inspector.

### API

The local console can start as server-rendered HTML, but it should expose JSON endpoints that make later product faces and reusable UI easier:

- `GET /api/runs`
- `GET /api/runs/latest`
- `GET /api/actions`
- `GET /api/actions/:id`
- `GET /api/artifacts`
- `GET /api/artifacts/:id`
- `GET /api/approvals`
- `POST /api/approvals/:action_id/approve`
- `POST /api/approvals/:action_id/reject`
- `GET /api/integrations`
- `POST /api/integrations/:id/connect`
- `POST /api/integrations/:id/test`

The API should use runtime state and runtime authorization. It should not expose raw filesystem paths as the primary API contract, though local debug links can show them.

## Data Requirements

The console needs normalized projections over existing runtime records:

- Runs and latest pointer.
- Actions and action log.
- Artifacts and artifact lineage.
- Approval requests and decisions.
- Bundle declarations.
- Integration declarations and live connection state.
- Capability availability results.

If the filesystem local runtime remains JSON-record based, the console can build projections by reading the run directory. If this becomes slow or complex, add a local index/projection file under runtime-generated state.

## Security And Trust Requirements

- Bind approval decisions to exact action digests.
- Never approve by model prose or mutable draft text.
- Never show raw secret/token values.
- Treat artifact content as potentially untrusted when rendering HTML.
- Escape rendered artifact content by default.
- Keep local credential files out of authored bundle content and git.
- Make local/dev security posture clear: local console is for trusted local users unless a runtime adds authentication.
- Hosted runtimes must own authn/authz for the console; local runtime may start unauthenticated on localhost.

## UX Principles

- Prefer direct traceability over abstraction: every page links to the underlying action/artifact/declaration ids.
- Show exact policy reasons, not generic "blocked" messages.
- Make pending human work obvious.
- Keep payload and artifact previews readable, but preserve links to raw JSON.
- Keep generic views useful without domain-specific renderers.
- Allow product faces to provide domain-specific rendering separately.

### Lite Visual System

The admin console should feel like a professional control panel, not a marketing page or raw record browser. Use a restrained, readable visual system:

- Warm off-white page background with a very subtle grid texture.
- Dark plum/ink text, muted secondary text, and pale blush accents for selected/primary controls.
- Thin hairline borders, light elevation, and modest card radius.
- Native system sans typography by default; avoid decorative/editorial type treatments in the app UI.
- Moderate font weights; reserve bold text for headings, primary identifiers, and key decision values.
- Compact rectangular buttons, pills, and status chips rather than highly rounded badges.
- Metrics and summaries should be scannable but not oversized or splashy.
- Technical JSON and raw records should stay progressively disclosed behind details panels.
- The approvals page should lead with the human review question, then expose action ids, digests, policy rules, and raw records as supporting detail.

## Milestones

### Milestone 1: Local Approval Inbox

- Generic pending approvals list.
- Approval detail page.
- Artifact preview for common JSON/Markdown bodies.
- Approve/reject controls wired to runtime approval commands.
- Links to action, approval request, and input artifacts.

### Milestone 2: Run And Action Observability

- Latest run overview.
- Action log table.
- Action detail view with policy/digest/payload/artifact links.
- Runtime summary rendered in browser.

### Milestone 3: Artifact Browser

- Artifact list filters.
- Artifact detail page.
- Derived-from and created-by navigation.
- Raw JSON view.

### Milestone 4: Integration Status

- Integration list from declarations.
- Local connection status adapter interface.
- Test connection controls.
- Redacted diagnostics.
- Optional connect/disconnect flows for one simple local integration class.

### Milestone 5: Shared Console Boundary

- Evaluate whether the local console should remain local-only or split into a reusable UI/view-model package.
- Define a runtime-admin API seam only after the local implementation proves what endpoints are stable.

## Acceptance Criteria

- Running a local bundle can produce a pending approval visible in the console.
- A human can approve or reject the pending action from the console.
- Approval resumes the stored action payload and writes expected output artifacts.
- Rejection records a durable decision and does not execute effects.
- Action log and artifact browser are usable for a bundle with no product-specific UI code.
- Integration status page shows declared requirements and safe local connection state.
- The implementation does not add provider SDKs, OAuth flows, secret stores, or hosted infrastructure dependencies to core Agentic.

## Open Questions

- Should the first command be `agentic ui`, `agentic console`, `agentic admin`, or `agentic serve --ui`?
- Should local UI state live under `.agentic/runtime/local/` or `.agentic/.data/`?
- Should approval requests remain artifacts, separate records, or both?
- Should the console include simple generic artifact editors, or stay read-only except for approval/integration actions?
- Which local secret storage should be supported first: environment variables, OS keychain, encrypted file, or explicit adapter interface only?
- How much of the console API should be standardized before a second runtime exists?

## Related Docs

- `docs/runtime-adapter-boundary.md`
- `docs/runtime-state-layout.md`
- `docs/hosted-runtime-handoff.md`
- `docs/framework-boundaries.md`
