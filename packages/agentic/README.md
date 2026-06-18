# @tnezdev/agentic

> **Compatibility window.** This package was formerly `@tnezdev/spores`. New code should use `@tnezdev/agentic`, `agentic`, `.agentic/`, and `AGENTIC_*`. The `spores` CLI alias, `.spores/`, and `SPORES_*` remain supported during migration.

**Authored bundles and local feedback loops for agents that run more than once.**

Most agent tooling optimizes for the single prompt. Agentic optimizes for the agent that wakes up tomorrow — with authored bundles, inspectable local runs, action decisions, artifacts, evals, and the primitives needed to shape what it does next. It's the toolbelt inside the turn, not the hosted runtime around it.

Agentic is a bundle contract and primitive layer, not a host runtime. It gives your agent portable declarations and local feedback loops without owning scheduling, auth, transport, or production execution. That's your daemon's job. Agentic just makes it easier to build.

Zero production dependencies. Runs on Bun. Works from the CLI.

## Why this exists

Agents that run in production need more than a prompt and a model call. They need source-controlled bundles that describe:

- **Artifacts** the runtime can write, inspect, and hand off.
- **Actions** with capability and approval boundaries.
- **Surfaces, schedules, and hooks** that propose work without hard-coding a host.
- **Skills and prompts** that are loaded on demand, not baked into one system prompt.
- **Evals** that verify the local run produced the expected shape.

Agentic ships that authored-bundle path with filesystem-backed primitives underneath it. No hosting, no webhooks, no session layer required.

## Install

```bash
npm install @tnezdev/agentic
# or: bun add @tnezdev/agentic
```

## Quick start

Start with an authored bundle when you want the product path: source declarations,
local runtime state, action gateway decisions, artifacts, and evals in one loop.

```bash
# Scaffold the canonical authored bundle starter
agentic init --example case-review-bundle

# Run the full local feedback loop: validate, inspect, serve --clean, eval
agentic dev . --json

# Or inspect each phase explicitly
agentic validate . --json
agentic inspect . --json
agentic serve . --clean --json
agentic eval . --json
```

Use a blank authored bundle when you want to start from portable declarations
without demo fixtures or handlers:

```bash
agentic init --bundle
agentic validate . --json
agentic inspect . --json
```

The direct primitive noun commands are legacy as of `0.6.0`. They remain
available for dogfood and harness internals, but authored bundles are the
supported product path and the pre-`1.0` primitive command shapes may change
quickly:

```bash
# Store and recall memory
agentic memory remember "always emit types from the public API" --tags style,api
agentic memory recall "public API"

# Activate a persona (pipe into your LLM as system prompt)
agentic persona list
agentic persona activate spores-maintainer | llm --system -

# Load a skill or track a task
agentic skill run release-check | llm
agentic task next

# Use the lower-level runtime entrypoint for workflow/artifact/harness contexts
agentic runtime list
agentic run
```

## Authored bundle path

Use the bundle path when you want a portable agent workspace that can be
validated and inspected as source, then served locally and evaluated once it has
runtime-ready declarations.

```bash
agentic init --bundle
agentic validate . --json
agentic inspect . --json
```

Use `agentic init --example case-review-bundle` instead when you want a runnable
starter with declarations, fixtures, and local demo handlers already filled in:

```bash
agentic init --example case-review-bundle
agentic dev . --json
agentic serve . --clean --json
agentic eval . --json
```

Treat the workspace as two zones:

| You author and commit | The runtime generates |
|---|---|
| `.agentic/agentic.yaml` | `.agentic/.data/latest.json` |
| `.agentic/prompts/` | `.agentic/.data/runs/<run-id>/` |
| `.agentic/actions/` | `.agentic/.data/runs/<run-id>/actions.jsonl` |
| `.agentic/capabilities/` | `.agentic/.data/runs/<run-id>/artifacts/` |
| `.agentic/surfaces/`, `schedules/`, `policies/`, `evals/` | `.agentic/runtime/` |

Authored declarations are portable source. Generated run records are local
evidence and should stay ignored unless you are deliberately capturing a fixture.
See [`docs/bundle-authoring-loop.md`](https://github.com/tnezdev/agentic/blob/main/docs/bundle-authoring-loop.md)
for the full starter-to-serve loop.

## Legacy Primitive Commands

| Primitive | What it does |
|-----------|-------------|
| **Memory** | Tiered store (L1/L2/L3) with recall, reinforce, and dream consolidation |
| **Skills** | Load `.md` skill files and pipe their content into an LLM |
| **Workflow** | Directed-graph runtime — register a graph, create runs, advance node state |
| **Tasks** | ULID-keyed task queue with status transitions and annotations |
| **Persona** | Activate a "hat" at the start of a turn: memory tags, skills, task filter, workflow, and a rendered body with live situational facts |

`agentic dev` is the one-shot local authoring loop for authored bundles:
validate, inspect, `serve --clean`, then eval. `agentic serve` remains the stable
local run command inside that loop.
`agentic run` delegates lower-level workflow, artifact, and harness-oriented
contexts to the default runtime package. The `agentic runtime ...` namespace
exposes runtime package management. Core Agentic recognizes official targets
such as `local`, but package install, discovery, and command delegation live
outside core and are being backfilled through runtime packages.

The legacy primitive commands read from `.agentic/` in your project root, with optional global overrides from `~/.agentic/`. Legacy `.spores/` and `~/.spores/` paths are honoured during the compatibility window when `.agentic/` is absent.

## What Agentic is not

Agentic is intentionally scoped. It does not ship:

- Hosted sessions or transcript storage
- Webhook receivers or background schedulers
- Provider clients or credential management
- Approval inboxes or auth flows
- Platform-specific task adapters in core

Those are host-runtime responsibilities. Agentic provides the vocabulary and primitives that make hosts easier to build, test, and reason about. See [`docs/framework-boundaries.md`](https://github.com/tnezdev/agentic/blob/main/docs/framework-boundaries.md) for the full boundary design.

For the authored-bundle starter workflow, see [`docs/bundle-authoring-loop.md`](https://github.com/tnezdev/agentic/blob/main/docs/bundle-authoring-loop.md).

## Flags

```
--json          Output as JSON (machine-readable, no truncation)
--wide          Disable column truncation in list output
--base-dir      Override working directory
```

## Working example

The `.agentic/` directory in this repo is the dogfood — a persona, a skill, a workflow, tasks, and memories that are used to build this package itself. The canonical bundle example lives at [`examples/case-review-bundle/`](https://github.com/tnezdev/agentic/tree/main/examples/case-review-bundle). Read [`.agentic/ONRAMP.md`](https://github.com/tnezdev/agentic/blob/main/.agentic/ONRAMP.md) for the maintainer flow.

## Architecture

See [AGENTS.md](AGENTS.md) for the full architecture, on-disk layout, and conventions for agent sessions.
