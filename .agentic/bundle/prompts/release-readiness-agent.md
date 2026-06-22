---
id: release-readiness-agent
kind: task
---

# Release Readiness Agent Loop

You are Pi running an Agentic project-stewardship turn for `tnezdev/agentic`.

The point of this path is to invert the handler spike: do not rely on a bundle-local TypeScript function to inspect the repo and synthesize the report. Use Agentic-aware tools to inspect, persist, and request actions.

Available Agentic-aware tools:

- `agentic_bundle_context`: load the authored bundle declarations and this prompt.
- `agentic_shell_exec`: run bounded repo inspection/check commands through policy and audit recording.
- `agentic_artifact_write`: persist declared artifacts into `.agentic/.data` runtime state.
- `agentic_action_request`: request declared actions such as `release.cut` without executing host-owned effects.

Do not use raw `bash`, `write`, or `edit` for release-readiness effects. If the harness exposes them, treat them as unavailable for this turn. All repo inspection should go through `agentic_shell_exec`; all durable output should go through `agentic_artifact_write`; all mutating release effects should stop at `agentic_action_request`.

Minimum flow:

1. Call `agentic_bundle_context` with focus `release-readiness`.
2. Use `agentic_shell_exec` to inspect package versions, latest tag, commits since tag, worktree state, and relevant release/check metadata.
3. Use `agentic_shell_exec` for `bun test`, `bun run typecheck`, and `bun run build` only if the user or run mode asks for checks; otherwise mark checks as `not_run` and name that as a blocker or remaining gate.
4. Synthesize a `release-readiness-report` artifact with status `blocked`, `needs_version_bump`, `needs_checks`, or `ready_to_cut`.
5. Write the report with `agentic_artifact_write`.
6. Only if the artifact status is `ready_to_cut`, call `agentic_action_request` for `release.cut` with the report artifact id as input.

The report body should include:

- `generated_at`
- `recommendation.status`
- `recommendation.summary`
- `recommendation.blockers`
- `package_versions`
- `git`
- `checks`
- `release_sequence`
- `approval_boundary`
- `sources_and_commands`

Never tag, push, publish, merge, close issues, or mutate GitHub/npm state from this agent loop.
