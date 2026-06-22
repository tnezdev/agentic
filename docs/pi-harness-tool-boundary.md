# Pi Harness Tool Boundary

This note captures the design direction from the project-stewardship dogfood pivot.

## Crystallized Direction

Agentic authored bundles should stay declarative. They should declare goals, artifacts, actions, capabilities, policies, prompts, skills, and expected outputs. They should not hide the core behavior of a workflow inside bundle-local imperative handlers.

Imperative execution still exists, but it belongs at the harness/runtime boundary:

- The harness owns model calls, tool-loop protocol, streaming, session trees, and provider-specific mechanics.
- The runtime owns policy checks, action records, approval records, artifact persistence, audit, and enforcement.
- The host environment owns installed CLIs, credentials, network access, sandboxing, and operating authority.
- The bundle declares what work is allowed, what output must be produced, and which effects require approval.

Pi is the likely harness adapter for this shape.

## Mental Model

A robust agent environment does not need a bespoke integration handler for every operation. It usually needs a small set of low-level tools in a rich environment.

Example:

- Expose one shell-like tool.
- Run it in a workspace where `git`, `gh`, `bun`, `npm`, `jq`, and project scripts are available.
- Let the agent use those tools to inspect and operate the project.
- Route tool calls through Agentic runtime policy so they are recorded, constrained, and approval-gated.

The bundle should not need a TypeScript function just to say "inspect the repo and produce a release readiness report." The bundle should say:

- A release-readiness run can use read-oriented shell commands.
- It should produce a `release-readiness-report` artifact.
- It may propose `release.cut`.
- `release.cut` requires explicit maintainer approval before tag, push, or publish-triggering effects.

## Desired Flow

For Agentic project stewardship, the target flow is:

1. A surface starts a `release-readiness` run.
2. The runtime resolves the authored bundle and prepares a frame for Pi.
3. The frame includes relevant prompts, skills, policies, artifact declarations, action declarations, and capability constraints.
4. Pi runs the agent loop.
5. The agent uses low-level tools such as shell commands to inspect the repo and environment.
6. Tool calls route through the Agentic runtime or an Agentic-aware tool adapter.
7. The runtime records tool/action requests, policy decisions, command outputs, artifacts, and approval gates.
8. The agent writes a `release-readiness-report` artifact.
9. If ready, the agent requests `release.cut`.
10. The runtime records `approval_required` instead of letting the agent tag, push, or publish directly.

This makes the admin console meaningful: it can explain what the agent inspected, which tools it used, which policies applied, which artifact was produced, and which effects were stopped at approval.

## Why The Current Handler Spike Smells

The initial root `.agentic` project-stewardship port includes `.agentic/bundle/handlers.ts`. That proved the authored bundle can validate and run, but it is not the desired long-term execution model for this use case.

The handler currently does too much:

- Reads git state.
- Reads package metadata.
- Computes release readiness.
- Writes the readiness artifact.

That hides the work in runtime-owned TypeScript instead of letting the agent operate through generic tools under declared policy. It makes the bundle "YAML plus arbitrary code," which weakens the declarative contract.

Keep this handler as a local-runtime spike only. Do not treat it as the design target.

## Target Tool Set

The first useful Pi-backed tool surface should be small:

- `shell.exec`: run commands in a bounded workspace and return captured output.
- `artifact.read`: read mounted or stored Agentic artifacts.
- `artifact.write`: create or update declared output artifacts.
- `action.request`: request an action through the gateway.
- `action.status`: inspect action and approval status.

For release readiness, the agent could use `shell.exec` for commands like:

```bash
git status --short
git describe --tags --abbrev=0
git log <tag>..HEAD --oneline
gh pr list --state open
gh run list --workflow=ci.yml --limit 5
npm view @tnezdev/agentic version
bun test
bun run typecheck
bun run build
```

The important part is not the specific commands. The important part is that each tool call is inspectable and constrained by capability/policy.

## Capability Shape

The bundle should declare tool access at the capability level.

Read-oriented example:

```yaml
id: release.inspect
kind: capability_declaration
description: Allow repo and registry inspection for release readiness.
tool: shell.exec
effects:
  - process.spawn
  - filesystem.read
  - network.read:github
  - network.read:npm
data_classes:
  - project_public_state
approval:
  required: false
```

Mutation example:

```yaml
id: release.cut
kind: capability_declaration
description: Gate tag push and publish-triggering release effects.
tool: shell.exec
effects:
  - git.tag:release
  - git.push:tag
  - ci.trigger:publish
approval:
  required: true
```

The exact schema is still open. The principle is stable: capabilities should describe access to generic tools plus effects, not require bespoke handler code for every project operation.

## Runtime Enforcement

Do not expose a raw shell beside Agentic and call it protected. If Pi can bypass Agentic with unrestricted shell, the action gateway becomes decorative.

The strong path is:

```text
Pi tool call
  -> Agentic-aware tool adapter
  -> capability and policy check
  -> execute, deny, or record approval_required
  -> persist action/tool record and output reference
  -> return result to Pi
```

For local development, the first version can be conservative:

- Start with read-oriented shell commands.
- Record commands, exit codes, stdout/stderr excerpts, and working directory.
- Deny or approval-gate obvious mutations such as `git tag`, `git push`, `npm publish`, and `gh pr merge`.
- Keep secrets out of model-visible output.
- Treat command classification as a runtime concern, not a bundle-local handler concern.

## Project Stewardship Application

The root `.agentic` dogfood bundle should evolve toward these responsibilities:

- Release readiness.
- Release cut supervision.
- Backlog grooming.
- Progress updates.
- Planning briefs.

Each responsibility should produce a durable artifact. The release-readiness slice is the first one because it preserves valuable legacy release knowledge and naturally exercises approval-gated mutation.

The desired release-readiness output remains a `release-readiness-report` artifact with:

- Package version alignment.
- Changes since last tag.
- Local worktree state.
- Relevant CI/check status.
- Release notes/changelog status.
- Recommendation.
- Blockers.
- Proposed next action.
- Sources and commands consulted.

## Next Implementation Direction

The first runtime seam now exists: `agentic serve . --clean --json --harness pi` can route Pi-targeted bundle actions through the local runtime, mount the runtime-owned Pi extension/tools, pass the active run id, reload generated actions/artifacts, and complete the top-level action through the action gateway. The local handler remains the default fallback.

Next sessions should keep treating `.agentic/bundle/handlers.ts` as a spike and continue replacing it with the Pi-backed path.

Likely next slice:

1. Keep the root authored bundle declarations.
2. Move more of the Pi tool adapter from the repo-local extension into runtime-owned package code.
3. Expose Agentic-aware tools to Pi through runtime-backed ports, starting with constrained `shell.exec` and `artifact.write`.
4. Move release-readiness synthesis out of `handlers.ts` and into the Pi/agent loop.
5. Persist the readiness report as a runtime artifact.
6. Ensure `release.cut` remains approval-gated and inspectable in the admin console.

The question to answer is not "can the handler produce the report?" It can. The question is whether Agentic can declaratively supervise an agent using low-level tools in a rich environment while preserving audit, policy, approval, and durable artifacts.

## Open Questions

- Which Pi SDK/RPC hooks are enough to expose Agentic-aware tools without losing runtime policy enforcement?
- Should shell/tool calls be represented as normal action records, a separate tool-call record type, or both?
- How should command classification work for read-only versus mutating shell commands?
- What is the minimum sandbox story for local dogfood before this is safe enough beyond trusted development machines?
- Should command outputs become artifacts, action payloads, or external log references?
- How does the admin console show tool calls without turning into a raw terminal transcript browser?
- What part of this belongs in `@tnezdev/agentic-runtime-local` versus future Pi harness adapter code?
