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

## Examples

- [`.agentic/`](.agentic/) is the project dogfood workspace — a persona, skills, workflow, tasks, and memories used to build Agentic itself. Read [`.agentic/ONRAMP.md`](.agentic/ONRAMP.md) for the maintainer flow.
- [`examples/second-brain/`](examples/second-brain/) is a user-mode example. It shows how an agent harness can use Agentic primitives to run second-brain workflows with persona activation, task pickup, workflow gates, and finalized artifacts. Memory is intentionally left for user space and custom adapters.

The second-brain example includes its own [`AGENTS.md`](examples/second-brain/AGENTS.md) bootstrap file for harnesses.
