# AGENTS.md - Personal Assistant Example

Use this file as the harness bootstrap for agents working in this example workspace.

## What This Is

This directory is an Agentic personal-assistant workspace. Agentic provides the durable primitives; the harness provides the model call, tools, live integrations, credentials, and user communication.

Workspace base dir:

```bash
examples/personal-assistant
```

## Start Here

For a first smoke test, let the local runtime prepare the turn:

```bash
agentic run examples/personal-assistant
```

For a manual harness turn, show the seeded task and activate the assistant persona:

```bash
agentic task show 01KPA500000000000000000001 --base-dir examples/personal-assistant
agentic persona activate assistant --base-dir examples/personal-assistant
```

Treat the persona output as operating context for the turn. Then load the reusable session-start procedure and fixture context:

```bash
agentic skill run session-brief --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000010 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000070 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000020 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000030 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000040 --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000050 --base-dir examples/personal-assistant
```

For an end-of-session wrap, keep the same assistant persona and load the wrap procedure:

```bash
agentic skill run wrap-session --base-dir examples/personal-assistant
agentic workflow show session-wrap --base-dir examples/personal-assistant
agentic artifact read 01KPA500000000000000000080 --base-dir examples/personal-assistant
```

The runtime uses the public `local` target. It prepares a workflow run and a finalized `local-runtime-run` artifact for inspection; it does not check calendars, read email, call external APIs, or complete the assistant work on its own.

When using the checked-in repository example, treat runtime output as local dogfood state. Do not commit generated `.agentic/runtime/`, `.agentic/runs/`, or ad hoc artifact directories unless deliberately refreshing the fixture.

If Pi is installed and you want the local runtime to hand this prepared turn to a harness, keep the public target and add the harness flag:

```bash
agentic run examples/personal-assistant --harness pi
```

For a conversational handoff, add `--interactive`; Agentic prepares the same
invocation, workflow run, artifact, and Pi prompt files, then attaches the
terminal to Pi:

```bash
agentic run examples/personal-assistant --harness pi --interactive
```

If the installed `agentic` binary is unavailable while working from this repo, use:

```bash
bun ../../packages/agentic/src/cli/main.ts persona activate assistant --base-dir .
bun ../../packages/agentic/src/cli/main.ts task next --base-dir .
bun ../../packages/agentic/src/cli/main.ts skill run session-brief --base-dir .
```

## How To Use Agentic

- Use `persona activate` to load the assistant hat and turn-level operating instructions.
- Use `skill run` to load the session-start or wrap-session procedure.
- Use `task next` to find the current assistant task.
- Use `workflow run` for resumable session-start state.
- Use `artifact read` to load durable fixture context.
- Use `artifact create`, `artifact write`, and `artifact finalize` for durable session briefs and wrap notes.
- Ask one concise question when the next action depends on user intent.
- Do not claim live service checks unless the harness actually performed them.

## Boundary

Agentic is not the assistant host. Do not expect it to browse, call a model, check calendars, read email, schedule background wakes, manage auth, or execute approvals.

The harness owns:

- Model calls
- Tool execution
- Live service access
- Credentials and authorization
- Scheduling and notifications
- Final user communication

Agentic owns:

- Personas
- Skills
- Tasks
- Workflows
- Artifacts
- Optional memories when the user configures them

## Session Output

When the assistant synthesizes a startup briefing, persist it as a `session-brief` artifact. Do not leave the briefing only in the transcript.

Use this shape:

- Who This Assistant Is
- Current Picture
- Last Session
- Open Work
- Needs User
- Recommended Next Step
- Sources Consulted

When the assistant closes a meaningful session, persist a `session-wrap` artifact. Use this shape:

- What Happened
- Decisions
- Durable Changes
- Open Loops
- Next Session Pointer
- Sources Consulted
