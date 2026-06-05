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

For a user-mode example, see [`examples/second-brain/`](examples/second-brain/). It shows a small research operating system with a persona, skill, workflow, task, and finalized artifact.
