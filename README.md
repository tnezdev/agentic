# Agentic Monorepo

This repository contains the Agentic package workspace.

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@tnezdev/agentic` | `packages/agentic` | Core primitives and CLI |
| `@tnezdev/agentic-runtime-local` | `packages/agentic-runtime-local` | Local runtime package |

## Development

Run checks from the repository root:

```bash
bun test
bun run typecheck
bun run build
```

The dogfood workspace still lives at `.agentic/`. Start with [`.agentic/ONRAMP.md`](.agentic/ONRAMP.md), then read [`packages/agentic/AGENTS.md`](packages/agentic/AGENTS.md) for core package architecture.

## Bundle Lifecycle

Use `dev` for a one-shot local authoring loop over validate, inspect, serve, and eval:

```bash
agentic dev examples/case-review-bundle --json
```

Use the explicit lifecycle commands when you want phase-by-phase output:

```bash
agentic validate examples/case-review-bundle --json
agentic inspect examples/case-review-bundle --json
agentic serve examples/case-review-bundle --clean --json
agentic eval examples/case-review-bundle --json
```

To scaffold a blank authored bundle in a new workspace:

```bash
agentic init --bundle
agentic validate . --json
agentic inspect . --json
```

To scaffold the runnable case-review starter:

```bash
agentic init --example case-review-bundle
agentic dev . --json
```

`agentic serve` remains the stable local run path inside that loop. `agentic run` remains the lower-level runtime entrypoint for workflow, artifact, and harness-oriented contexts.

## Design Docs

- [`docs/bundle-authoring-loop.md`](docs/bundle-authoring-loop.md) describes the starter-to-serve authored bundle workflow.
- [`docs/dev-command-shape.md`](docs/dev-command-shape.md) documents the narrow `agentic dev` loop.
- [`docs/framework-boundaries.md`](docs/framework-boundaries.md) explains the package-vs-host boundary.
- [`docs/handler-packaging-boundary.md`](docs/handler-packaging-boundary.md) explains why executable handlers remain runtime-owned code.
- [`docs/hosted-runtime-handoff.md`](docs/hosted-runtime-handoff.md) maps Agentic bundle contracts to a hosted runtime without adding hosting to core.
- [`docs/runtime-adapter-boundary.md`](docs/runtime-adapter-boundary.md) defines the core ports, runtime adapter, and harness adapter split.
- [`docs/runtime-state-layout.md`](docs/runtime-state-layout.md) describes authored bundle files versus runtime-generated records.

## Examples

- [`.agentic/`](.agentic/) is the project dogfood workspace — a persona, skills, workflow, tasks, and memories used to build Agentic itself. Read [`.agentic/ONRAMP.md`](.agentic/ONRAMP.md) for the maintainer flow.
- [`examples/case-review-bundle/`](examples/case-review-bundle/) is the canonical authored bundle example for the local runtime. It exercises surfaces, schedules, hooks, actions, capabilities, approvals, artifacts, and evals through `agentic serve`.
- [`examples/second-brain/`](examples/second-brain/) is a user-mode example. It shows how an agent harness can use Agentic primitives to run second-brain workflows with persona activation, task pickup, workflow gates, and finalized artifacts. Memory is intentionally left for user space and custom adapters.

Both examples include their own `AGENTS.md` bootstrap files for harnesses.
