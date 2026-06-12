# @tnezdev/agentic-runtime-local

Local runtime package for Agentic workspaces.

The public runtime target is `local`:

```bash
agentic runtime add local
agentic runtime init local
agentic runtime status local
```

This package is intentionally thin. It exports the Agentic runtime manifest,
creates local runtime glue, and provides placeholder `run` behavior while real
execution is split into later runtime work.

Pi may power this runtime under the hood in the future. In this project, Pi
means https://pi.dev/, not Raspberry Pi. `pi` is not a public runtime target.

## Initial Scope

- `init` creates `.agentic/runtime/local/runtime.json` and a local `targets/` directory.
- `run` returns a placeholder result without executing a harness.
- `status` reports whether the local runtime glue has been initialized.

Non-goals for this skeleton: daemon/service mode, scheduling, Cloudflare code,
and a session primitive.
