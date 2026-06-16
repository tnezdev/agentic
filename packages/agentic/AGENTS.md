# AGENTS.md — Agentic (formerly SPORES)

Orientation for agent sessions. Concise. Read before touching code.

> **Rename in progress:** The package is migrating from `spores` / `.spores/` to `agentic` / `.agentic/`. Both names work during the compatibility window. Prefer `agentic` in new code and docs.

## Start here

This repo dogfoods its own toolbelt. Before touching code, run the three-command on-ramp in [`../../.agentic/ONRAMP.md`](../../.agentic/ONRAMP.md) — it activates the `spores-maintainer` persona, pulls the top ready task, and points you at the release skill. The rest of this file is reference; ONRAMP.md is the path.

## What is SPORES?

A TypeScript library + CLI for agent in-loop primitives:

1. **Memory** — remember/recall/dream with L1/L2/L3 tiers
2. **Skills** — load and run skill.md files from `.agentic/skills/`
3. **Workflow** — digraph runtime (GraphDef → Run → Transitions, state derived from history)
4. **Tasks** — typed adapter interface (ULID IDs, Taskwarrior-shaped)
5. **Persona** — activate a hat at the start of a turn: metadata (memory_tags, skills, task_filter, workflow, routing hints) + a rendered body with live situational facts. Declarative attention, not enforced scope.
6. **Artifact** — versioned content blobs with metadata (type, title, tags, finalized). The canonical place to store an agent's durable outputs within a project — briefs, memos, reports, plans. See "Artifact primitive" below.
7. **Source** — pluggable read-only loader abstraction (`read(name) → text`, `list() → names`). Personas/skills/workflows all load through the same shape. `LayeredSource` composes for seed-then-emerge (e.g. live DB shadows seed filesystem). See "Source abstraction" below.
8. **Dispatch** — foundation types for the universal inbound message primitive (`Dispatch`, `DispatchFilter`, `matchDispatch`). Spores ships the message shape and pure match logic; runtimes ship transport, scheduling, and handler execution.

MVP scope = what an agent reaches for *inside a single turn*. No hosting, no webhooks, no session layer — those are daemon-level concerns. **Identity lives outside spores** — in the run orchestration layer. Spores provides the hat; the caller provides who's wearing it.

## Tech stack

- TypeScript on Bun. No build step. `bun run <file>` directly.
- Zero production dependencies (`"dependencies": {}` in `packages/agentic/package.json` stays clean)
- Hand-rolled TOML parser in `config.ts`
- Custom arg parser in `src/cli/main.ts` — no CLI framework

## Commands

```bash
bun test          # run all tests
bun run typecheck # tsc --noEmit
```

## Architecture

### Types first

All shared types live in `src/types.ts`. Add types there before writing implementations.

### Adapter pattern

Every primitive has an interface in `src/<module>/adapter.ts`. Filesystem implementations are the default. Future storage backends implement the same interface.

| Module | Interface | Implementation |
|--------|-----------|----------------|
| memory | implicit in filesystem.ts | `src/memory/filesystem.ts` |
| workflow | `WorkflowAdapter` | `src/workflow/filesystem.ts` |
| tasks | `TaskAdapter` | `src/tasks/adapter.ts` (stub only) |
| personas | `PersonaAdapter` | `src/personas/filesystem.ts` |
| artifacts | `ArtifactAdapter` | `src/artifact/filesystem.ts` |

### Source abstraction

Config-style primitives (personas, skills, workflows, file-style dispatch configs) load through a pluggable `Source` interface in `src/sources/`:

```typescript
interface Source {
  read(name: string): Promise<SourceRecord | undefined>  // text + locator
  list(): Promise<string[]>
}
```

Reference implementations:

- `FlatFileSource(dir, ext)` — `<dir>/<name><ext>` layouts (personas, workflows)
- `NestedFileSource(dir, filename)` — `<dir>/<name>/<filename>` layouts (skills)
- `InMemorySource(records, tag)` — for tests and bake-in seed templates
- `LayeredSource([liveSource, seedSource])` — first-wins read, union-dedupe list (the seed-then-emerge primitive)

Per-primitive load functions (`loadPersonaFromSource`, `loadSkillFromSource`, `loadGraphFromSource`) accept any `Source` — Compass and other remote runtimes plug in their own (DB, HTTP) without touching spores.

Data primitives (Memory, Artifacts, Tasks) have query semantics and live behind their own adapter shapes — `Source` is for config, not data.

### CLI: two-word dispatch

```
agentic <noun> <verb> [args]    # preferred
spores  <noun> <verb> [args]    # compatibility alias
```

Commands in `src/cli/commands/<noun>.ts`. Each command is a `Command` function exported as `<noun><Verb>Command`. The dispatch table is in `src/cli/main.ts`.

Current command surface:
- `agentic init` — scaffold `.agentic/` config
- `agentic memory remember/recall/forget/dream/reinforce`
- `agentic skill list/show/run`
- `agentic workflow list/show/run/status`
- `agentic persona list/view/activate`
- `agentic artifact create/read/write/edit/inspect/list/finalize`
- `agentic run` — simple runtime entrypoint for the current workspace
- `agentic runtime list/add/init/run/status` — runtime package discovery and delegation in core; runtime behavior belongs to runtime packages

### Skills on disk

```
~/.agentic/skills/<name>/skill.md    # global (user-level)
.agentic/skills/<name>/skill.md      # project-level (wins on name conflict)
# Legacy: ~/.spores/ and .spores/ are honoured when .agentic/ is absent
```

Frontmatter: `name`, `description`, `tags: [a, b, c]`
Body: the skill content returned by `skill run` (pipe to an LLM).

### Personas on disk

```
~/.agentic/personas/<name>.md        # global (user-level)
.agentic/personas/<name>.md          # project-level (wins on name conflict)
# Legacy: ~/.spores/ and .spores/ are honoured when .agentic/ is absent
```

Flat-file layout (unlike skills which use a directory per skill). Frontmatter: `name`, `description`, `memory_tags: [...]`, `skills: [...]`, optional `task_filter: { tags: [...], status: ready }` (nested, one level deep), optional `workflow: <graph-id>`. Body is markdown with `{{cwd}}`, `{{timestamp}}`, `{{hostname}}`, `{{git_branch}}` tokens that get substituted at `persona activate` time.

**`view` vs `activate`** is load-bearing: `view` prints the raw file with literal tokens (for humans editing or reviewing); `activate` substitutes live situational facts (for piping into an LLM). Don't let them produce identical output.

**One hat at a time.** Personas don't compose, stack, or inherit. To pivot, deactivate one and activate another. Runtime integration for applying persona bindings (using `memory_tags` as a recall filter, etc.) is **the caller's responsibility** — spores ships the metadata, the caller wires it. Descoped from v0.1 intentionally; expected to land after we have more signal from actual use.

### Config resolution (four-tier)

1. Hardcoded defaults in `config.ts`
2. `~/.agentic/config.toml` — global user overrides (preferred); falls back to `~/.spores/config.toml`
3. `.agentic/config.toml` — project overrides, wins over global (preferred); falls back to `.spores/config.toml`

### Workflow runtime

- `GraphDef` defines a digraph (nodes + edges with conditions)
- `expandGraph` flattens nested subgraphs at register time — nesting is free
- `Runtime` is a **state machine only** — it derives current state from `Run.history` (no `current_node` field). It does NOT schedule or evaluate `EvaluatorRef` conditions — that's the caller's job.
- State is immutable: each transition appends to `history`

### Dispatch

Foundation only — the message shape and pure match logic. `Dispatch` carries `from`, `to`, `payload`, `timestamp`, plus optional `when` / `recurrence` delivery metadata. `DispatchFilter` is a declarative predicate over `from` / `to`; `matchDispatch(dispatch, filter)` returns boolean. `DispatchHandlerHooks` types `onRegister` / `onUnregister` for handler-level lifecycle setup (idempotency lives in the hook, not in spores).

Runtimes own send/handle/cancel verbs, the actual transport, scheduling, and handler execution. The split — vocabulary in spores, execution in runtime — keeps spores callable from both long-running daemons and serverless deployments.

See `PROJECTS/spores/DESIGN-runtime-description.md` for the full design conversation.

### URI schemes

`agentic://` is the preferred URI scheme for Agentic-owned compute. Branded type `AgenticUri = \`agentic://\${string}\`` in `types.ts`. Referenced from skill bodies, dispatched by the host runtime.

`spores://` is the legacy scheme; `SporesUri` is preserved but deprecated. Use `AgenticUri` in new code.

## Conventions

- Test files colocated: `src/memory/filesystem.test.ts` next to `src/memory/filesystem.ts`
- Test fixtures: inline (no separate fixtures dir)
- IDs: ULIDs via monotonic factory (see tasks types)
- Error handling: functions throw on unexpected errors; return `undefined` for "not found" cases (e.g. `loadSkill` returns `undefined` when skill doesn't exist)
- No `console.log` in library code — CLI output goes through `output(ctx, data, formatter)` in `src/cli/main.ts`
- **Descriptions are agent-facing activation triggers, not labels.** For both skills and personas, phrase `description` as "Activate when..." rather than "The X maintainer". `list` output is meant to function as a lookup table an agent scans to decide what to reach for — good triggers make the scan useful.

### Artifact primitive

Artifacts are versioned markdown blobs — the agent's durable output store for a project.

**On-disk layout** (inside `.agentic/artifacts/`):

```
.agentic/artifacts/<ulid>/meta.json    — ArtifactRecord (type, title, version, finalized, tags, …)
.agentic/artifacts/<ulid>/v1.md        — body at version 1
.agentic/artifacts/<ulid>/v2.md        — body at version 2 (iterate write)
```

`body_ref` in `meta.json` is relative to `.agentic/artifacts/` — e.g. `"<id>/v2.md"`.
Legacy: `.spores/artifacts/` is used when `.agentic/artifacts/` does not exist.

**Write modes:**

| Mode | Behavior |
|------|----------|
| `iterate` (default) | Bump version, write `v<n+1>.md`. Prior versions remain on disk. |
| `replace` | Overwrite current `v<n>.md` in place. Version unchanged. |
| `create` | Fail with "already exists". Used only for first-write semantics. |

**Finalize semantics:** `artifact finalize <id>` sets `finalized=true` in `meta.json`. Finalized artifacts reject `write` and `edit`. `finalize` is idempotent — finalizing an already-finalized artifact is a no-op.

**CLI worked example:**

```bash
# Create
agentic artifact create brief "## Q2 Launch\n\nTBD." --title "Q2 Brief" --tags "q2,launch"

# Read (pipe-friendly — raw body to stdout in human mode, JSON with --json)
agentic artifact read 01JXYZ... | pbcopy

# Iterate
agentic artifact write 01JXYZ... "## Q2 Launch\n\nUpdated content." --mode iterate

# Targeted edit
agentic artifact edit 01JXYZ... --old "TBD." --new "Final copy."

# Inspect metadata
agentic artifact inspect 01JXYZ... --json

# List with filter
agentic artifact list --type brief --json

# Finalize the artifact
agentic artifact finalize 01JXYZ...
```

**Hook events:**

| Event | Fired by |
|-------|---------|
| `artifact.created` | `artifact create` |
| `artifact.written` | `artifact write`, `artifact edit` |
| `artifact.finalized` | `artifact finalize` |

Hook env vars: `AGENTIC_ARTIFACT_ID`, `AGENTIC_ARTIFACT_TYPE`, `AGENTIC_ARTIFACT_TITLE`, `AGENTIC_ARTIFACT_TAGS` (create); `AGENTIC_ARTIFACT_ID`, `AGENTIC_ARTIFACT_VERSION`, `AGENTIC_ARTIFACT_MODE` (written); `AGENTIC_ARTIFACT_ID`, `AGENTIC_ARTIFACT_FINAL_VERSION` (finalized). Legacy `SPORES_*` mirrors are set alongside for compatibility.

**Dogfood hook:** `.agentic/hooks/artifact.written` — indexes the artifact reference into memory after every write so it's searchable via `agentic memory recall`.

**Workflow → artifact worked example:**

A workflow node declares its output type via `artifact.type` (from #50):

```yaml
nodes:
  - id: write-brief
    label: Write Q2 Brief
    artifact:
      type: brief
      description: Q2 launch brief produced by the briefing workflow
```

After the workflow run completes and the node produces its output, the caller persists it:

```bash
# Node output lands in the transition; caller writes it as a named artifact
BODY=$(agentic workflow status "$RUN_ID" --json | jq -r '.nodes[-1].artifact.content')
ARTIFACT_ID=$(agentic artifact create brief "$BODY" --title "Q2 Brief" --tags "briefing,q2" --json | jq -r '.artifact.id')

# artifact.written hook fires automatically → reference indexed into memory
# Later retrieval
agentic memory recall "Q2 Brief"
```

The dogfood hook wires the last step without any special-cased plumbing in spores itself.

## What NOT to add

- Sessions, webhooks, hosting — daemon-layer, not SPORES
- Any adapter implementation for tasks until the interface is settled
- Dependencies — keep `"dependencies": {}` clean
- Per-module adapter interfaces for memory (memory follows the filesystem.ts shape directly, no separate adapter.ts)
