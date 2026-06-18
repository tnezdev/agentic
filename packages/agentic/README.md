# @tnezdev/agentic

> **Compatibility window.** This package was formerly `@tnezdev/spores`. New code should use `@tnezdev/agentic`, `agentic`, `.agentic/`, and `AGENTIC_*`. The `spores` CLI alias, `.spores/`, and `SPORES_*` remain supported during migration.

**In-loop primitives for agents that run more than once.**

Most agent tooling optimizes for the single prompt. Agentic optimizes for the agent that wakes up tomorrow — with memory, skills, workflows, tasks, and a persona that shape what it does next. It's the toolbelt inside the turn, not the runtime around it.

Agentic is a primitive layer, not a host runtime. It gives your agent building blocks — store and recall memories, load skills, advance workflows, track tasks, activate personas — without owning scheduling, auth, transport, or execution. That's your daemon's job. Agentic just makes it easier to build.

Zero production dependencies. Runs on Bun. Works from the CLI.

## Why this exists

Agents that run in production need more than a prompt and a model call. They need:

- **Memory** that persists across sessions — not just a growing context window.
- **Skills** that are loaded on demand, not baked into a system prompt.
- **Workflows** that define multi-step processes with real state machines, not ad-hoc prompt chains.
- **Tasks** that track commitments inside the loop, not just on an external board.
- **Personas** that activate a coherent hat — memory tags, skill set, task filter, and rendered instructions — in one declaration.

Agentic ships all five as filesystem-backed primitives your agent can reach for inside any turn. No hosting, no webhooks, no session layer required.

## Install

```bash
npm install @tnezdev/agentic
# or: bun add @tnezdev/agentic
```

## Quick start

```bash
# Scaffold .agentic/ directory in your project
agentic init

# Store a memory
agentic memory remember "always emit types from the public API" --tags style,api

# Load a skill
agentic skill list
agentic skill run release-check | llm

# Track a task
agentic task add "update CHANGELOG before tagging"
agentic task next

# Activate a persona (pipe into your LLM as system prompt)
agentic persona list
agentic persona activate spores-maintainer | llm --system -

# Preview the runtime package front door
agentic runtime list

# In this repo, run an authored bundle through the local runtime
agentic serve examples/case-review-bundle --clean --json

# Inspect and evaluate the latest bundle run
agentic inspect examples/case-review-bundle --json
agentic eval examples/case-review-bundle --json

# Use the lower-level runtime entrypoint when you need workflow/artifact/harness contexts
agentic run
```

## Primitives

| Primitive | What it does |
|-----------|-------------|
| **Memory** | Tiered store (L1/L2/L3) with recall, reinforce, and dream consolidation |
| **Skills** | Load `.md` skill files and pipe their content into an LLM |
| **Workflow** | Directed-graph runtime — register a graph, create runs, advance node state |
| **Tasks** | ULID-keyed task queue with status transitions and annotations |
| **Persona** | Activate a "hat" at the start of a turn: memory tags, skills, task filter, workflow, and a rendered body with live situational facts |

`agentic serve` is the preferred local lifecycle command for authored bundles.
`agentic run` delegates lower-level workflow, artifact, and harness-oriented
contexts to the default runtime package. The `agentic runtime ...` namespace
exposes runtime package management. Core Agentic recognizes official targets
such as `local`, but package install, discovery, and command delegation live
outside core and are being backfilled through runtime packages.

All five primitives read from `.agentic/` in your project root, with optional global overrides from `~/.agentic/`. Legacy `.spores/` and `~/.spores/` paths are honoured during the compatibility window when `.agentic/` is absent.

## What Agentic is not

Agentic is intentionally scoped. It does not ship:

- Hosted sessions or transcript storage
- Webhook receivers or background schedulers
- Provider clients or credential management
- Approval inboxes or auth flows
- Platform-specific task adapters in core

Those are host-runtime responsibilities. Agentic provides the vocabulary and primitives that make hosts easier to build, test, and reason about. See [`docs/framework-boundaries.md`](https://github.com/tnezdev/agentic/blob/main/docs/framework-boundaries.md) for the full boundary design.

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
