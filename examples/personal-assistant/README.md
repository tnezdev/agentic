# Personal Assistant Example

This example shows Agentic as the durable operating layer for a personal assistant: persona, skills, workflows, tasks, and artifacts.

It is inspired by a real session-start ritual, but the fixture data is fictional and public-safe. The goal is to show how an assistant can resume from durable context without baking in a private identity, a home server, Slack, email, calendars, or any specific harness.

## Big Picture

Agentic stores and loads the pieces an assistant needs inside a turn. It does not call the model or inspect live services by itself.

In this example:

- The harness reads `AGENTS.md` to learn how to enter the workspace.
- The ready task names the assistant persona, `session-brief` skill, `session-start` workflow, and fixture artifacts.
- The assistant reads a fictional user profile, operating policy, continuity brief, recent sessions, open loops, and workspace context.
- The assistant synthesizes a startup briefing and writes it as a durable `session-brief` artifact.
- At the end of meaningful work, the assistant can run a wrap loop and write a durable `session-wrap` artifact.
- The host harness still owns model calls, tool execution, credentials, scheduling, notifications, and final user communication.

## Quick Smoke Test

From the repo root, run the example:

```bash
agentic run examples/personal-assistant
```

Or from inside the example workspace:

```bash
cd examples/personal-assistant
agentic run
```

The runtime prints a workflow-run id and a run-packet artifact id. Inspect those ids next:

```bash
agentic workflow status <workflow-run-id> --base-dir examples/personal-assistant
agentic artifact read <artifact-id> --base-dir examples/personal-assistant
```

That is the first-run path. It should show the assistant startup loop without requiring you to memorize artifact ids, persona names, or workflow internals first.

## Manual Primitive Path

After the quick smoke test, inspect the same inputs manually:

```bash
agentic task show 01KPA500000000000000000001 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000010 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000070 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000020 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000030 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000040 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000050 --base-dir examples/personal-assistant
```

Then load the exact primitives a manual harness would give to the model:

```bash
agentic persona activate assistant --base-dir examples/personal-assistant
agentic skill run session-brief --base-dir examples/personal-assistant
agentic workflow show session-start --base-dir examples/personal-assistant
agentic artifact list --base-dir examples/personal-assistant
```

To inspect the end-of-session facet:

```bash
agentic skill run wrap-session --base-dir examples/personal-assistant
agentic workflow show session-wrap --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000080 --base-dir examples/personal-assistant
```

If you need to bypass the repo-local shim, use `bun packages/agentic/src/cli/main.ts` from the repo root.

## Fixture Story

The fictional user is Alex Rivera, an independent software consultant who wants an assistant that starts each work session by reconstructing context before acting.

Alex is currently deciding how to make a personal assistant runtime more portable. The durable context intentionally mirrors common assistant inputs without using private data:

- `user-profile`: Alex's working style, trust boundary, and assistant expectations.
- `operating-policy`: allowed sources, privacy boundary, live-access claims, and persistence rules.
- `continuity-brief`: compact dashboard of current projects, open gates, and loose threads.
- `recent-session`: two fresher notes that override stale continuity.
- `open-loops`: ready, blocked, and waiting items.
- `workspace-context`: instructions for a fictional local project workspace.
- `sample-session-brief`: finalized example output showing the expected briefing shape.
- `sample-session-wrap`: finalized example output showing how the assistant preserves continuity at the end of a session.

## How The Pieces Work Together

### Harness Bootstrap

`AGENTS.md` is not an Agentic primitive. It tells a generic harness how to use this workspace: which base directory to use, which task to inspect first, which persona and skill to load, and where Agentic's responsibility stops.

### Persona

`.agentic/personas/assistant.md` is the assistant operating mode. It says to load durable context before acting, treat recent sessions as fresher than continuity, surface blockers plainly, persist reusable output as artifacts, and wrap meaningful sessions for continuity.

### Skill

`.agentic/skills/session-brief/skill.md` is the reconstruct-style procedure. It tells the assistant how to read profile, policy, continuity, recent sessions, open loops, and workspace context, then synthesize a durable briefing.

`.agentic/skills/wrap-session/skill.md` is the end-of-session procedure. It tells the assistant how to preserve outcomes, decisions, durable changes, open loops, and the next-session pointer without copying the whole transcript.

### Task

`.agentic/tasks/01KPA500000000000000000001.json` is the self-guided starting point. It names the persona, skill, workflow, and input artifact ids so `agentic run` can prepare a turn without guessing.

### Workflow

`.agentic/workflows/session-start.json` captures the repeated startup shape:

```text
load-profile
-> read-policy
-> read-continuity
-> inspect-recent-sessions
-> check-open-loops
-> synthesize-briefing
-> decide-next-step
```

The important gate is `synthesize-briefing`: the assistant should write a `session-brief` artifact that can be inspected after the transcript is gone.

`.agentic/workflows/session-wrap.json` captures the matching closeout shape:

```text
collect-outcomes
-> separate-signal
-> update-open-loops
-> write-wrap-note
-> prepare-next-start
```

The important gate is `write-wrap-note`: the assistant should write a `session-wrap` artifact that becomes the freshest input to the next session-start pass.

### Artifact

`.agentic/artifacts/*` stores durable fixture context and the sample output shape. In a real assistant workspace, this is where continuity summaries, session notes, open-loop snapshots, and generated briefs would live or sync from a storage adapter.

## What Is In Here

| Path | Primitive | Purpose |
|---|---|---|
| `AGENTS.md` | Harness bootstrap | Minimal instructions for agents using this workspace |
| `.agentic/personas/assistant.md` | Persona | Activates the personal assistant hat |
| `.agentic/skills/*.md` | Skills | Procedures for synthesizing startup briefings and session wraps |
| `.agentic/workflows/*.json` | Workflows | Resumable session-start and session-wrap loops |
| `.agentic/tasks/*.json` | Task | A ready `START HERE` task that drives the dogfood path |
| `.agentic/artifacts/*` | Artifact | Fictional profile, policy, continuity, sessions, open loops, context, sample brief, and sample wrap |

On first `agentic run`, the local runtime creates `.agentic/runtime/local/runtime.json` plus runtime output directories. Each run creates an invocation record, a workflow run, and a finalized `local-runtime-run` artifact. Those are runtime outputs, not starter content.

## What Is Not Included Yet

- Real Dottie identity or Travis data
- Live calendar, email, Slack, GitHub, or Taskwarrior adapters
- Daemon or service mode
- Background wake scheduling
- Container execution
- Model calls, browsing, credentials, approvals, or tool execution
- Automatic mutation of the continuity/open-loop fixture after a wrap
- Interactive Pi mode; that is a future harness/runtime concern

## Dogfooding Loop

To dogfood this example, let the content drive the first run and watch for friction.

1. Run `agentic run` from inside the example, or `agentic run examples/personal-assistant` from the repo root.
2. Inspect the workflow-run id and run-packet artifact id printed by the runtime.
3. If you are testing a real harness, rerun with `--harness pi`.
4. Confirm the harness creates a durable `session-brief` artifact rather than leaving the briefing only in a transcript.
5. End the test with `wrap-session` and confirm it creates a durable `session-wrap` artifact with a next-session pointer.
6. Patch only the friction you observed in the loop.

Good findings are not just better prose. They are places where the primitive boundaries feel wrong, missing, or too ceremonial.
