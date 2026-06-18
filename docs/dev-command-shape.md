# `agentic dev` Command Shape

This note defines the narrow product shape for `agentic dev`.

## Purpose

`agentic dev` is the local feedback loop for an authored bundle while a user is
editing declarations. It composes existing lifecycle commands rather than
introducing a new runtime model.

The first version is equivalent to a deliberate one-shot loop:

```bash
agentic validate . --json
agentic inspect . --json
agentic serve . --clean --json
agentic eval . --json
```

The value is not new capability. The value is a single command that returns a
coherent phase report for the same bundle target.

## First Version Constraints

The narrow version should:

- Accept an optional bundle target, defaulting like `validate`, `inspect`,
  `serve`, and `eval`.
- Run phases in order: validate, inspect, serve, eval.
- Stop before `serve` if validation fails.
- Stop before `eval` if serve fails.
- Preserve JSON output as a structured envelope with phase results.
- Reuse `serve --clean` by default so generated state is deterministic during
  local iteration.
- Delegate runtime execution exactly the way `agentic serve` does today.

## Non-Goals

Do not use the first `agentic dev` slice to add:

- Watch mode or file-system subscriptions.
- HTTP serving, webhook receivers, or browser UI.
- Hosted runtime handoff or deployment.
- Handler packaging or arbitrary-code execution in core.
- Provider clients, auth, secrets, approval UI, or queues.
- Long-running daemon/session behavior.

Those may become separate runtime or host features later. They are not needed for
the first local feedback loop.

## Implementation Posture

Keep `dev` thin. If a future change needs new runtime semantics, split that
runtime work first instead of hiding it inside the orchestration command.
