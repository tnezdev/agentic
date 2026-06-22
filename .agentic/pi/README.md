# Pi Agent-First Dogfood Prototype

This directory documents the exploratory harness adapter for the root Agentic dogfood bundle. The tool implementation now lives in `packages/agentic-runtime-local/src/pi-agentic-tools.ts`; `.agentic/pi/extensions/agentic-tools.ts` is only a compatibility shim for direct Pi probes.

## Goal

Invert the current `bundle/handlers.ts` smell. Instead of hiding release-readiness behavior inside a bespoke local handler, Pi should run the agent loop and call Agentic-aware tools:

- `agentic_bundle_context` loads the authored bundle contract.
- `agentic_shell_exec` runs constrained read/check commands and records them.
- `agentic_artifact_write` writes durable runtime artifacts.
- `agentic_action_request` records approval-gated actions without executing host-owned effects.

The extension writes runtime-shaped records under `.agentic/.data/runs/<run-id>/`, so `agentic inspect .` can see the resulting actions and artifacts.

## Runtime Probe

From the repo root:

```bash
AGENTIC_RUNTIME_PACKAGE_DIRS=packages agentic serve . --clean --json --harness pi
```

This routes the bundle's Pi-targeted `release.assess` action through the local runtime. The runtime prepares the Pi action prompt, mounts the extension and declared tools, passes `AGENTIC_PI_RUN_ID`, then reloads actions/artifacts from `.agentic/.data` before completing the top-level action.

## Direct CLI Probe

From the repo root:

```bash
pi --approve \
  --no-builtin-tools \
  --tools agentic_bundle_context,agentic_shell_exec,agentic_artifact_write,agentic_action_request \
  --extension packages/agentic-runtime-local/src/pi-agentic-tools.ts \
  --append-system-prompt .agentic/bundle/prompts/release-readiness-agent.md \
  --print --mode text \
  "Assess Agentic release readiness through the Agentic-aware tools."
```

This direct probe remains useful for harness debugging, but it is no longer the only executable path. Prefer the runtime probe when dogfooding Agentic because it exercises the action gateway, run state, and inspect/eval surfaces.

## Runtime Boundary

Fallback path:

- `agentic serve . --clean --json` executes `release.assess` through `bundle/handlers.ts`.
- The handler directly reads git/package state and writes the report.

Pi path:

- `agentic serve . --clean --json --harness pi` resolves bundle declarations and prepares a Pi frame for `release.assess`.
- Pi owns the model loop.
- Agentic-aware tools enforce policy, classify shell commands, persist artifacts/actions, and stop release effects at approval.
- The admin console explains inspected commands, produced artifacts, and approval gates.

The runtime-owned extension is deliberately conservative: shell mutations, tag pushes, GitHub writes, and publishing commands are recorded as approval-required instead of executed.
