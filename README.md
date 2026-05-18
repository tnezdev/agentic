# @tnezdev/spores → becoming `@tnezdev/agentic`

> **Rename in progress.** The package is migrating from `spores` to `agentic`. During the compatibility window both names work. New code should use `agentic`, `.agentic/`, and `AGENTIC_*`.

Executable toolbelt for agent self-improvement. Five in-loop primitives — memory, skills, workflow, tasks, and persona — with zero production dependencies, built for Bun.

## Install

```bash
npm install @tnezdev/spores
# or: bun add @tnezdev/spores
```

## Quick start

```bash
# Scaffold .agentic/ directory in your project
agentic init          # preferred
spores init           # compatibility alias

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
```

## Primitives

| Primitive | What it does |
|-----------|-------------|
| **Memory** | Tiered store (L1/L2/L3) with recall, reinforce, and dream consolidation |
| **Skills** | Load `.md` skill files and pipe their content into an LLM |
| **Workflow** | Directed-graph runtime — register a graph, create runs, advance node state |
| **Tasks** | ULID-keyed task queue with status transitions and annotations |
| **Persona** | Activate a "hat" at the start of a turn: memory tags, skills, task filter, workflow, and a rendered body with live situational facts |

All five primitives read from `.agentic/` in your project root, with optional global overrides from `~/.agentic/`. Legacy `.spores/` and `~/.spores/` paths are honoured during the compatibility window when `.agentic/` is absent.

## Flags

```
--json          Output as JSON (machine-readable, no truncation)
--wide          Disable column truncation in list output
--base-dir      Override working directory
```

## Working example

The `.agentic/` directory in this repo is the dogfood — a persona, a skill, a workflow, tasks, and memories that are used to build this package itself. Read [`.agentic/ONRAMP.md`](.agentic/ONRAMP.md) for a tour.

## Architecture

See [AGENTS.md](AGENTS.md) for the full architecture, on-disk layout, and conventions for agent sessions.
