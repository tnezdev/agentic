# Agentic Monorepo

This repository contains the Agentic package workspace.

## Packages

| Package | Path | Purpose |
|---|---|---|
| `@tnezdev/agentic` | `packages/agentic` | Core primitives and CLI |

Runtime packages will live beside the core package under `packages/`.

## Development

Run checks from the repository root:

```bash
bun test
bun run typecheck
bun run build
```

The dogfood workspace still lives at `.agentic/`. Start with [`.agentic/ONRAMP.md`](.agentic/ONRAMP.md), then read [`packages/agentic/AGENTS.md`](packages/agentic/AGENTS.md) for core package architecture.
