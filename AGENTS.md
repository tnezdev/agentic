# AGENTS.md — Agentic Monorepo

Orientation for agent sessions. Read this before touching code in this repo.

## Start Here

This repo dogfoods its own toolbelt. Before touching code, run the three-command on-ramp in [`.agentic/ONRAMP.md`](.agentic/ONRAMP.md).

## Layout

| Path | Purpose |
|---|---|
| `packages/agentic` | Published `@tnezdev/agentic` core package |
| `.agentic/` | Repo-local dogfood workspace |
| `docs/` | Repo-level design docs |
| `scripts/` | Release and smoke-test helpers |

## Commands

Run checks from the repository root:

```bash
bun test
bun run typecheck
bun run build
```

The root package is private and only coordinates workspaces. Core package implementation rules live in [`packages/agentic/AGENTS.md`](packages/agentic/AGENTS.md).
