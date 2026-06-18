# Bundle Authoring Loop

Use this loop when you want to start from Agentic's authored-bundle path rather than the lower-level primitive CLI.

## Start From A Scaffold

Create a blank bundle workspace when you want to author declarations from
scratch:

```bash
agentic init --bundle
```

Create the runnable case-review starter when you want concrete declarations,
fixtures, and local demo handlers:

```bash
agentic init --example case-review-bundle
```

The starter writes portable authored files plus a local `handlers.ts` demo module. It does not copy generated `.agentic/.data` state.

Run the lifecycle from the workspace root:

```bash
agentic validate . --json
agentic inspect . --json
agentic serve . --clean --json
agentic eval . --json
```

Use `serve` as the normal local lifecycle command for authored bundles. Use `run` when you need the lower-level runtime package entrypoint for workflow, artifact, or harness contexts.

## What You Author

Authored bundle files live under `.agentic/` and should be reviewed like source code:

```text
.agentic/
  agentic.yaml
  prompts/
  skills/
  artifacts/      # artifact type declarations
  actions/        # action declarations
  capabilities/
  hooks/
  surfaces/
  schedules/
  integrations/
  policies/
  deploy/
  evals/
  fixtures/
```

Top-level files such as `README.md`, `AGENTS.md`, `package.json`, and `handlers.ts` are workspace support files. The starter's `handlers.ts` is local-runtime demo code, not a portable declaration.

## What The Runtime Writes

Runtime state is generated and should not be treated as authored bundle content:

```text
.agentic/.data/
  latest.json
  runs/<run-id>/
    actions.jsonl
    actions/<action-id>.json
    artifacts/<artifact-id>.json
    summary.md
```

The starter includes `.gitignore` entries for `.agentic/.data/` and `.agentic/runtime/`. If you scaffold into an existing repository with an existing `.gitignore`, add those ignores yourself.

## Edit Loop

1. Change one authored declaration or handler behavior.
2. Run `agentic validate . --json` to catch broken refs and declaration mismatches.
3. Run `agentic serve . --clean --json` to create a fresh local run.
4. Run `agentic inspect . --json` to inspect bundle inventory and generated state.
5. Run `agentic eval . --json` to confirm the expected run shape still holds.
6. Commit authored files, tests, and docs. Do not commit `.agentic/.data/`.

## Boundary Checks

Keep these boundaries intact as the bundle grows:

- Declarations are portable data; handlers are runtime-owned executable code.
- Action effects should pass through the action gateway before external writes or privileged mutations.
- Approval is a runtime-authenticated grant bound to an exact action digest, not model prose.
- Secrets belong in the host runtime or handler environment, not prompts, fixtures, or declarations.
- Hosted deployment, queues, auth, provider clients, and approval UI remain outside core Agentic.

See [`runtime-state-layout.md`](runtime-state-layout.md) for record layout details,
[`runtime-adapter-boundary.md`](runtime-adapter-boundary.md) for the
core/runtime/harness split, and
[`handler-packaging-boundary.md`](handler-packaging-boundary.md) for the current
handler packaging stance.
