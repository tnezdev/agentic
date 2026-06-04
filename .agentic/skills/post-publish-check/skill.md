---
name: post-publish-check
description: Activate after publishing a new release — installs the package from the npm registry and verifies all exports load under Bun and Node
tags: [agentic, release, npm, testing]
---

# Post-publish check

Validates that `@tnezdev/agentic` is consumable when installed from the npm registry. This is the safety net that catches registry-specific issues (missing files, bad `exports` map, propagation problems) that the pre-publish smoke tests can't.

## Run it

```bash
bash scripts/post-publish-check.sh [version]
```

- Omit `version` to check `latest`
- Pass a specific version (e.g. `0.2.0`) right after publish when `latest` may not have propagated yet

## What it does

1. Creates temp Bun and Node consumer projects
2. Installs `@tnezdev/agentic@<version>` from the npm registry via `bun add` and `npm install`
3. Prints the installed versions
4. Runs `scripts/smoke-consumer.mjs` under Bun and Node — the same export checks used by the pre-publish smoke tests

## When to run

- After every release, as the final step of the `agentic-release` workflow (step 5: verify-registry)
- When investigating consumer reports of import failures

## Relation to smoke-test

`smoke-test` and `smoke-test-node` validate the `npm pack` tarball *before* publish. `post-publish-check` validates the registry package *after* publish. They share the same consumer script (`scripts/smoke-consumer.mjs`).
