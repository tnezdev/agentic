---
name: release-readiness
description: Use when deciding whether the Agentic repo is ready for a release and producing a release-readiness-report artifact.
metadata:
  agentic.tags: release,readiness,project-stewardship
---

# Release Readiness

Produce a `release-readiness-report` artifact that answers whether Agentic is ready to cut a release.

Check these gates before recommending `ready_to_cut`:

1. Core and local runtime package versions are aligned.
2. `@tnezdev/agentic-runtime-local` peer/dev dependency ranges point at the release version.
3. The release version is newer than the latest tag.
4. `packages/agentic/package.json` still has no production dependencies.
5. The worktree is clean or the report clearly identifies uncommitted release-prep work.
6. Required checks are known green: `bun test`, `bun run typecheck`, and `bun run build`.
7. Release notes or a changelog entry exist for user-visible changes.
8. The report names any human decision that remains before tagging.

Do not tag, push, publish, or mutate GitHub/npm state from this skill. If the report is ready, propose the approval-gated `release.cut` action instead.
