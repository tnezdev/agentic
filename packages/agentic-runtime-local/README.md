# @tnezdev/agentic-runtime-local

Local runtime package for Agentic workspaces.

The public runtime target is `local`:

```bash
agentic serve examples/case-review-bundle --clean --json
agentic run
agentic runtime status local
```

This package is intentionally thin. It exports the Agentic runtime manifest,
creates local runtime glue, and prepares inspectable local workspace runs using
Agentic primitives.

Pi can power this runtime under the hood. In this project, Pi means
https://pi.dev/, not Raspberry Pi. `pi` is not a public runtime target.

## Initial Scope

- `init` creates `.agentic/runtime/local/runtime.json`, `targets/`, and
  `invocations/`.
- `serve` is the preferred local lifecycle command for authored bundles. It
  delegates to this package, processes declared surfaces, schedules, hooks,
  actions, capabilities, handlers, approvals, and writes inspectable local state.
- `run` resolves a workspace/workflow target, loads the matching persona, skills,
  ready task, and workflow, records a runtime invocation, creates a workflow run,
  and writes a finalized `local-runtime-run` artifact as the durable run packet.
  It initializes local runtime glue on first run. For non-bundle contexts this is
  prepare-only by default.
  If no target is provided, ready task metadata (`persona` and `workflow`) is used
  before falling back to an unambiguous workspace default.
- `run --harness pi` also invokes the Pi CLI as the local harness driver after
  the Agentic run packet is prepared. Add `--interactive` when you want to land
  in a live Pi terminal session instead of one-shot print mode.
- Bundle deploys can set `runtime.pi.extension: runtime:agentic-tools` to mount
  the package's runtime-owned Agentic-aware Pi tools.
- `status` reports whether the local runtime glue has been initialized and
  summarizes the latest invocation.

Invocation records live under `.agentic/runtime/local/invocations/<id>.json`.
Bundle run records live under the bundle state dir, usually `.agentic/.data/`.
Both are runtime-owned execution facts, not transcripts or sessions. Harness
integrations attach an optional `harness_ref` without importing that harness's
session model into Agentic core.

## Pi Harness Mode

Default integration mode for the first Pi bridge: CLI print mode.

```bash
agentic run <workspace-or-workflow> --harness pi
```

For conversational assistant-style starts, attach the terminal to Pi instead:

```bash
agentic run <workspace-or-workflow> --harness pi --interactive
```

You can also make Pi the default harness for this runtime target with config:

```toml
[runtime.local]
harness = "pi"
```

The local runtime still owns the public command and target name. When Pi is
enabled, `agentic run`:

1. Prepares the same Agentic invocation record, workflow run, and run-packet
   artifact as prepare-only mode.
2. Writes generated Pi prompt files beside the invocation JSON:
   `.agentic/runtime/local/invocations/<id>.pi-system.md` and
   `.agentic/runtime/local/invocations/<id>.pi-user.md`.
3. Invokes Pi from the target workspace. Print mode uses `pi --print --mode text
   --session-id <invocation-id> --session-dir .agentic/runtime/local/pi-sessions
   ...`; interactive mode drops `--print --mode text` and inherits the current
   terminal stdio.
4. Records `harness_ref: { provider: "pi", id: "<invocation-id>" }` on the
   invocation.

Agentic exposes personas, skills, the selected task, workflow definition, and
run-packet IDs to Pi through the generated prompt files. Pi owns the model loop,
tools, compaction, and session tree. Agentic records only the stable harness
reference and durable primitive IDs.

The Pi command can be overridden for local development:

```bash
agentic run research-loop --harness pi --pi-command /path/to/pi
```

or with runtime config:

```toml
[runtime.local]
harness = "pi"
pi_command = "/path/to/pi"
```

## Pi Limitations

- Pi must be installed on `PATH`; the local runtime does not depend on a Pi npm
  SDK.
- The integration relies on Pi CLI guarantees for `--session-id`,
  `--session-dir`, `--name`, `--append-system-prompt`, and `@file` prompt inputs;
  print mode also relies on `--print` and `--mode text`.
- Agentic does not parse Pi transcripts or continue Pi sessions itself. The
  invocation id is reused as the Pi session id so the reference is deterministic.
- Pi mode may call a model and use tools. Interactive mode attaches your terminal
  to Pi until that process exits. Prepare-only mode remains the default so
  `agentic run` is safe as an inspectable setup step.

Non-goals for this skeleton: daemon/service mode, scheduling, cloud-provider
code, model/tool execution inside Agentic core, and a session primitive.
