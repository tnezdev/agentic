# Handler Packaging Boundary

Agentic authored bundles can declare actions, capabilities, hooks, surfaces,
schedules, policies, artifacts, prompts, skills, evals, fixtures, and deploy
targets. Executable handlers are different: they are privileged runtime code, not
portable declarations.

## Current Shape

The canonical case-review starter includes a top-level `handlers.ts` so a local
workspace can be runnable after `agentic init --example case-review-bundle`.
That file is local-runtime demo code. Core Agentic does not load it, package it,
publish it, sandbox it, or treat it as an authored declaration.

The portable bundle source is the `.agentic/` declaration tree. Generated state
under `.agentic/.data/` and runtime package state under `.agentic/runtime/` stay
outside the bundle source.

## Why Core Does Not Package Handlers Yet

Handler execution is where secrets, provider credentials, external writes,
approval grants, filesystem access, network access, retries, audit, and sandbox
policy meet. Packaging that code is therefore runtime work, not primitive-layer
work.

Adding handler packaging to core too early would smuggle in at least one of:

- An arbitrary-code execution policy.
- A sandbox or process model.
- Secret and environment binding rules.
- Provider/client conventions.
- Deployment target assumptions.
- Audit and rollback semantics.

Those belong to host runtimes until multiple runtimes prove the same portable
contract is needed.

## Authoring Rule For Now

Use `.agentic/` files for portable declarations. Put executable code in a
runtime-owned module, package, container, worker, or host service. The runtime may
reference that code from a deploy target, but core Agentic should only validate
portable declarations and policy vocabulary.

The local runtime validates explicit `runtime.local.handlers` references when it
serves a bundle. A missing handler module, action export, or proposal payload
export fails the local run and writes inspectable failure state to the bundle run's
`latest.json` and `summary.md`. That is local-runtime guidance, not core handler
packaging or arbitrary-code execution.

If an allowed local handler throws during execution, the runtime records the
action as `failed` with the handler error before failing the bundle run. The
failed action appears in the action log, action record, bundle `latest.json`, and
runtime invocation failure state. This is still runtime-owned execution; core only
defines the durable action status vocabulary.

Effect-producing handlers must still enter through the action gateway. A handler
module is not permission by itself; the runtime must resolve the action,
capability, principal, data boundary, and approval state before executing it.

## Minimum Future Contract

If handler packaging graduates into an Agentic-supported shape, it should start
as a declaration contract that a runtime may consume, not as core execution.
Minimum constraints:

- Explicit opt-in from a deploy/runtime target.
- Handler references are locators plus metadata, not executable behavior in core.
- Runtime owns resolution, dependency installation, sandboxing, secrets, and
  process lifecycle.
- Runtime records the resolved handler source or digest in audit state before
  executing effects.
- Runtime records handler execution failures as failed action records before
  surfacing the run failure.
- Action gateway policy and approval checks stay mandatory before every
  effect-producing handler call.
- The same authored bundle can still validate without the handler package
  installed.

Until those constraints are concrete, keep handler code starter-local or
runtime-package-local.
