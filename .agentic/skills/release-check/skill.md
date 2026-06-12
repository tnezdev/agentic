---
name: release-check
description: Activate when cutting a new @tnezdev/agentic release — the CI-gated checklist for landing a version bump and triggering the tag publish
tags: [agentic, release, npm, ci]
---

# Release check — @tnezdev/agentic

Releases are **CI-gated**. You don't run `npm publish`; you push a `vX.Y.Z` tag and `.github/workflows/publish.yml` does the rest via npm Trusted Publishing (OIDC). Your job is to land a clean version bump on `main` and hand the tag to CI.

**The gate is CI. Do not publish locally.** There is no `NPM_TOKEN`; there is no path for a local `npm publish` to succeed. If you find yourself typing it, stop.

**First Agentic publish gate:** before the first CI-published `@tnezdev/agentic` release, verify npm Trusted Publishing is configured for `@tnezdev/agentic` against this repo and `.github/workflows/publish.yml`. The old `@tnezdev/spores` trusted publisher registration does not automatically cover the new package name. If npm requires a one-time local bootstrap publish before Trusted Publishing can be configured, publish without provenance; CI adds provenance explicitly after the trusted publisher exists.

Do this before the release PR or tag, not while a publish run is failing. The package page must trust `tnezdev/agentic`, workflow `.github/workflows/publish.yml`, and the tag ref pattern used by this workflow.

## 1. Land the version bump on main

Open a `chore: release vX.Y.Z` PR that:

- Bumps `version` in `packages/agentic/package.json` per semver.
- Appends a CHANGELOG entry (or release notes section) covering user-visible changes since the last tag.
- Keeps `"dependencies": {}` in `packages/agentic/package.json`. A non-empty production dependency is a design regression — investigate before shipping.

Merge only after CI (`.github/workflows/ci.yml`) is green on the PR. CI runs `bun test` and `bun run typecheck` — those are the authoritative gates, not a local run.

## 2. Sync and sanity-check main

```bash
git checkout main && git pull
git log -1 --oneline   # confirm the release commit is HEAD
```

The commit you're about to tag must be the merged release commit on `origin/main`. No tagging from feature branches, no tagging ahead of merge.

## 3. Tag and push

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The tag push is the trigger. `publish.yml` runs on `push: tags: [v*.*.*]` and takes over from here.

## 4. Watch publish.yml run green

```bash
gh run watch --exit-status
# or
gh run list --workflow=publish.yml --limit 3
```

What the workflow does (for context when reading logs):

1. Checkout + Bun + `bun install --frozen-lockfile`
2. `bun run typecheck` and `bun test` (re-gate, cheap)
3. Builds `dist/` and smoke-tests the packed tarball under both Bun and Node
4. Bootstraps npm 11 via direct tarball download (the runner's bundled npm has historically been corrupt on fresh `ubuntu-latest` images — don't "simplify" this step)
5. `npm publish --provenance --access public` using OIDC — no token, no secret

If the workflow fails:

- **Do not delete the tag as a first move.** Investigate in the logs; most failures (flaky install, transient registry) are retryable via `gh run rerun`.
- If the failure is real (bad code landed, version bump wrong), fix forward on `main` with a new patch version — `vX.Y.(Z+1)` — and a new tag. A published version is immutable; don't chase the old number.
- Only delete-and-retag if the tag was pushed to the wrong commit *and nothing published*. Confirm with `npm view @tnezdev/agentic versions` before retagging.

## 5. Verify the registry

```bash
npm view @tnezdev/agentic version
bash scripts/post-publish-check.sh X.Y.Z
```

`npm view` should print the version you just tagged. If it lags, wait 30 seconds and retry — npm registry propagation.

Then run the post-publish check — it installs the package from the registry in a temp dir and verifies all public API exports load. Pass the explicit version since `latest` may not have propagated yet.

Also spot-check provenance on https://www.npmjs.com/package/@tnezdev/agentic — the published version should show a "Built and signed on GitHub Actions" badge linking back to the workflow run. That badge is the whole point of OIDC; its absence means provenance attestation didn't attach and is worth investigating.

## On failure — general rule

A failed publish run does not mean "roll back." It means "the tag did not ship a package." The main branch is still the source of truth. Fix forward, bump patch, retag. Never rewrite history on `main` to "unship" a tag that CI caught.
