# AGENTS.md - Agentic Project Steward Bundle

Use this file as the harness bootstrap for agents operating the repo-local Agentic dogfood bundle.

## What This Is

This `.agentic/` workspace is migrating from the legacy primitive dogfood shape toward the authored-bundle runtime shape used by `agentic validate`, `agentic inspect`, and `agentic serve`.

The bundle source of truth is `.agentic/agentic.yaml`. Legacy primitive files such as `personas/`, `workflows/`, `tasks/`, and old skills remain during migration, but new project-stewardship behavior should be declared through the bundle manifest and its referenced resources.

## Start Here

From the repository root:

```bash
agentic validate .
agentic inspect .
AGENTIC_RUNTIME_PACKAGE_DIRS=packages agentic serve . --clean --json
```

If the repo-local shim is not on `PATH`, use:

```bash
bun packages/agentic/src/cli/main.ts validate .
bun packages/agentic/src/cli/main.ts inspect .
AGENTIC_RUNTIME_PACKAGE_DIRS=packages bun packages/agentic/src/cli/main.ts serve . --clean --json
```

## Current Slice

The first ported stewardship slice is release readiness.

Design note for the next implementation direction: `docs/pi-harness-tool-boundary.md`.

Pi agent-first prototype: `.agentic/pi/README.md`; runtime-owned tools live in `packages/agentic-runtime-local/src/pi-agentic-tools.ts` and the deploy uses `runtime:agentic-tools`.

Current local run shape:

- CLI-like ingress requests `release.assess`.
- Default `agentic serve . --clean --json` uses the local handler spike to inspect git/package state and write a `release-readiness-report` artifact.
- `agentic serve . --clean --json --harness pi` routes Pi-targeted actions such as `release.assess` through the Pi agent loop declared in `runtime.pi`.
- If a report is ever `ready_to_cut`, a hook proposes `release.cut`.
- `release.cut` requires human maintainer approval before any tag, push, or publish-triggering effect.

This minimal bundle does not execute a release. Release execution remains host-owned and approval-gated.

Pi run shape:

- Pi receives `bundle/prompts/release-readiness-agent.md`.
- Pi uses only Agentic-aware tools for repo inspection, artifact writes, and action requests.
- `agentic_shell_exec` records bounded read/check commands; mutating shell commands are blocked or approval-recorded.
- `agentic_artifact_write` persists `release-readiness-report` under `.agentic/.data`.
- `agentic_action_request` records `release.cut` as approval-required instead of executing host-owned effects.

## Boundary

Agentic owns the authored bundle shape, portable declarations, artifact/action vocabulary, policy metadata, and inspectable local state.

The host runtime owns credentials, GitHub/npm authority, approval channels, actual tag pushes, CI watching, and publishing effects.

Do not commit generated `.agentic/.data` state.
