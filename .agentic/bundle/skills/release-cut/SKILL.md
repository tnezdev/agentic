---
name: release-cut
description: Use after release readiness is approved to execute or supervise the CI-gated Agentic release sequence.
metadata:
  agentic.tags: release,ci,npm,approval
---

# Release Cut

Releases are CI-gated through GitHub Actions and npm Trusted Publishing. Do not run local `npm publish`.

The preserved release sequence is:

1. Choose the next semver version.
2. Open and merge a `chore: release vX.Y.Z` PR after CI is green.
3. Bump both package versions: `packages/agentic/package.json` and `packages/agentic-runtime-local/package.json`.
4. Keep `@tnezdev/agentic-runtime-local` peer/dev dependency ranges aligned with `@tnezdev/agentic`.
5. Add release notes for user-visible changes since the previous tag.
6. Confirm `packages/agentic/package.json` still has no production dependencies.
7. Sync `main` locally and verify `HEAD` is the merged release commit.
8. Create and push an annotated `vX.Y.Z` tag.
9. Let `.github/workflows/publish.yml` publish both packages through npm Trusted Publishing.
10. Watch the publish workflow finish green.
11. Verify npm registry versions for both packages.
12. Run `bash scripts/post-publish-check.sh X.Y.Z`.
13. Verify npm provenance badges link to the GitHub Actions publish run.

Failure policy:

- Do not delete a tag as the first response to a publish failure.
- Investigate workflow logs first; transient failures may be rerun.
- If a real defect landed on `main`, fix forward with a new patch version and tag.
- Only delete and retag if the tag points at the wrong commit and neither package was published.
- Before retagging, check both package version lists on npm.
