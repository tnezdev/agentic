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
- Action gateway policy and approval checks stay mandatory before every
  effect-producing handler call.
- The same authored bundle can still validate without the handler package
  installed.

Until those constraints are concrete, keep handler code starter-local or
runtime-package-local.
