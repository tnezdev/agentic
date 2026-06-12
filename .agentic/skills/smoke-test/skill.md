---
name: smoke-test
description: Activate when you need to validate the package is consumable before a release — runs npm pack, installs the tarball, and verifies exports under Bun and Node
tags: [agentic, release, npm, testing]
---

# Pre-publish smoke test

Validates that `@tnezdev/agentic` is consumable from an `npm pack` tarball under Bun and Node. This catches packaging issues (missing files, broken imports, wrong entry point) before a release tag is pushed.

## Run it

```bash
bash scripts/smoke-test.sh
bash scripts/smoke-test-node.sh
```

## What it does

1. `npm pack` in `packages/agentic` — produces the exact tarball that `npm publish` would upload
2. Creates a temp consumer project and installs the tarball via `bun add`
3. Runs `scripts/smoke-consumer.mjs` which imports the public API and checks that all value exports are present and constructable

## When to run

- Before pushing a release tag (`vX.Y.Z`)
- After changing `packages/agentic/package.json` fields (`files`, `main`, `exports`)
- After adding or removing public exports from `packages/agentic/src/index.ts`

CI runs these automatically in `.github/workflows/ci.yml` and `.github/workflows/publish.yml` between the test step and the publish step.

## Current scope

- Checks value exports exist with the right type (`function` for classes and functions). Does not exercise runtime behavior beyond import resolution.
