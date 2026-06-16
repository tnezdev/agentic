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

Pi may power this runtime under the hood in the future. In this project, Pi
means https://pi.dev/, not Raspberry Pi. `pi` is not a public runtime target.

## Initial Scope

- `init` creates `.agentic/runtime/local/runtime.json`, `targets/`, and
  `invocations/`.
- `run` resolves a workspace/workflow target, loads the matching persona, skills,
  ready task, and workflow, records a runtime invocation, creates a workflow run,
  and writes a finalized `local-runtime-run` artifact as the durable run packet.
- `status` reports whether the local runtime glue has been initialized and
  summarizes the latest invocation.

Invocation records live under `.agentic/runtime/local/invocations/<id>.json`.
They are runtime-owned execution facts, not transcripts or sessions. Future
harness integrations can attach an optional `harness_ref` without importing that
harness's session model into Agentic core.

Non-goals for this skeleton: daemon/service mode, scheduling, cloud-provider
code, model/tool execution, and a session primitive.
