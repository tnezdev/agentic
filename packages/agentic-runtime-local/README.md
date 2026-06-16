# @tnezdev/agentic-runtime-local

Local runtime package for Agentic workspaces.

The public runtime target is `local`:

```bash
agentic runtime add local
agentic runtime init local
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
- `run` resolves a workspace/workflow target, loads the matching persona, skills,
  ready task, and workflow, records a runtime invocation, creates a workflow run,
  and writes a finalized `local-runtime-run` artifact as the durable run packet.
  By default this is prepare-only.
- `run --harness pi` also invokes the Pi CLI as the local harness driver after
  the Agentic run packet is prepared.
- `status` reports whether the local runtime glue has been initialized and
  summarizes the latest invocation.

Invocation records live under `.agentic/runtime/local/invocations/<id>.json`.
They are runtime-owned execution facts, not transcripts or sessions. Harness
integrations attach an optional `harness_ref` without importing that harness's
session model into Agentic core.

## Pi Harness Mode

Chosen integration mode for the first Pi bridge: CLI print mode.

```bash
agentic runtime run <workspace-or-workflow> --harness pi
```

You can also make Pi the default harness for this runtime target with config:

```toml
[runtime.local]
harness = "pi"
```

The local runtime still owns the public command and target name. When Pi is
enabled, `runtime run`:

1. Prepares the same Agentic invocation record, workflow run, and run-packet
   artifact as prepare-only mode.
2. Writes generated Pi prompt files beside the invocation JSON:
   `.agentic/runtime/local/invocations/<id>.pi-system.md` and
   `.agentic/runtime/local/invocations/<id>.pi-user.md`.
3. Invokes `pi --print --mode text --session-id <invocation-id> --session-dir
   .agentic/runtime/local/pi-sessions ...` from the target workspace.
4. Records `harness_ref: { provider: "pi", id: "<invocation-id>" }` on the
   invocation.

Agentic exposes personas, skills, the selected task, workflow definition, and
run-packet IDs to Pi through the generated prompt files. Pi owns the model loop,
tools, compaction, and session tree. Agentic records only the stable harness
reference and durable primitive IDs.

The Pi command can be overridden for local development:

```bash
agentic runtime run research-loop --harness pi --pi-command /path/to/pi
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
- The integration relies on Pi CLI guarantees for `--print`, `--mode text`,
  `--session-id`, `--session-dir`, `--name`, `--append-system-prompt`, and
  `@file` prompt inputs.
- Agentic does not parse Pi transcripts or continue Pi sessions itself. The
  invocation id is reused as the Pi session id so the reference is deterministic.
- Pi mode may call a model and use tools. Prepare-only mode remains the default
  so `agentic runtime run` is safe as an inspectable setup step.

Non-goals for this skeleton: daemon/service mode, scheduling, cloud-provider
code, model/tool execution inside Agentic core, and a session primitive.
