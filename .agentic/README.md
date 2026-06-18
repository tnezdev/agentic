# .agentic/ — dogfood example

This directory is the project dogfood workspace. If we can't use Agentic to build Agentic, the primitive shape needs work.

Every file here is exercised by the agentic CLI itself. Think of it as both the self-use and the working example that ships with the repo.

## Contents

| Path | Primitive | What's in it |
|---|---|---|
| `config.toml` | (all) | Agentic config — `adapter = "filesystem"`, dirs for each primitive |
| `personas/spores-maintainer.md` | persona | The hat to wear when working on this codebase. Real principles, real activation triggers, real situational tokens |
| `skills/release-check/skill.md` | skill | The pre-release checklist. Piped into the agent before cutting a new version |
| `workflows/agentic-release.json` | workflow | CI-gated release graph: release PR → sync main → push tag → watch publish.yml → verify registry/provenance |
| `memory/*.json` | memory | Durable facts about this repo (npm package name, zero-deps rule, v0.1 runtime-scoping decision) |
| `tasks/*.json` | task | Real mirrored tasks — dogfood verification, release cut, v0.2 composition design |
| `runs/` | workflow | Ephemeral per-run state. **gitignored.** |

## How to use

From the repo root:

```bash
# List what's available
bun packages/agentic/src/cli/main.ts persona list
bun packages/agentic/src/cli/main.ts skill list
bun packages/agentic/src/cli/main.ts workflow list
bun packages/agentic/src/cli/main.ts task list

# Activate the maintainer hat — pipe into your LLM of choice
bun packages/agentic/src/cli/main.ts persona activate spores-maintainer

# Run the release check skill
bun packages/agentic/src/cli/main.ts skill run release-check

# Pick up the next ready task
bun packages/agentic/src/cli/main.ts task next

# Kick off a release run
bun packages/agentic/src/cli/main.ts workflow run agentic-release --name "0.6.0-cut"

# Query memories when you need the "why"
bun packages/agentic/src/cli/main.ts memory recall "runtime scope"
```

(After `npm install -g @tnezdev/agentic`, replace `bun packages/agentic/src/cli/main.ts` with `agentic`.)

## Why this shape

- **The persona reads like something a human would actually write for themselves.** Not a label, not a role — a set of non-negotiables and a "before you start" checklist. If it feels forced, the primitive isn't pulling its weight.
- **Skills are agent-facing work product.** `release-check` is not documentation *about* releasing — it's the actual pipeline an agent follows, with verification commands inline.
- **Memories are non-obvious durable facts**, not restatements of what `git log` already tells you. "Zero production dependencies is a hard rule" is worth remembering because the code alone doesn't say why.
- **Tasks are the real backlog**, not fake examples. Keep them in sync with GitHub ready issues when dogfooding exposes drift.
- **The workflow is a real process**, not a toy DAG. Every node corresponds to a command someone actually runs at release time.

## What this dogfood validated

- All four primitives (memory/workflow/skills/tasks) + persona compose cleanly in one directory layout
- `persona activate` template substitution works against live situational facts
- Adapter-layered project/global resolution is transparent (nothing in `~/.agentic/` interferes)
- `task next` returns the highest-ULID (most recent) ready task — caller is responsible for narrowing with `task_filter` if they want a different ordering (descoped per #8 addendum, caller wires persona bindings manually)
- Zero production dependencies held throughout

## Runs are ephemeral

`.agentic/runs/` is gitignored because each `workflow run` produces a new run record and committing those would add churn without meaning. If you want to reproduce a run, re-run the workflow — the graph is the durable artifact, the run is the execution.
