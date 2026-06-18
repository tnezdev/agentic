# `agentic dev` Command Shape

This note defines the narrow product shape for a future `agentic dev` command. It
does not implement the command.

## Purpose

`agentic dev` should be the local feedback loop for an authored bundle while a
user is editing declarations. It should compose existing lifecycle commands
rather than introduce a new runtime model.

The expected first version is equivalent to a deliberate one-shot loop:

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

## Implementation Gate

Implement this only after the existing lifecycle commands remain stable enough
that `dev` can be a thin orchestration layer. If implementation needs new runtime
semantics, stop and split that runtime work first.
