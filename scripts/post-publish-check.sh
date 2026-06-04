#!/usr/bin/env bash
# Post-publish validation for @tnezdev/agentic
#
# Installs the package from the npm registry (not a local tarball) and
# verifies it loads under Bun and Node. Use this after a release to confirm
# the published package works end-to-end from a consumer's perspective.
#
# Usage: bash scripts/post-publish-check.sh [version]
#   version  Optional — defaults to "latest". Pass e.g. "0.2.0" to check
#            a specific version. Useful right after publish when "latest"
#            may not have propagated yet.
#
# Requires: bun, node, npm

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-latest}"
PKG="@tnezdev/agentic@${VERSION}"

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

BUN_CONSUMER="$TMPDIR_BASE/bun-consumer"
mkdir -p "$BUN_CONSUMER"
cat > "$BUN_CONSUMER/package.json" <<'PKG_JSON'
{ "name": "post-publish-bun-consumer", "version": "0.0.0", "type": "module" }
PKG_JSON

echo "==> Installing ${PKG} from registry under Bun..."
(cd "$BUN_CONSUMER" && bun add "$PKG" 2>&1)

BUN_INSTALLED=$(cd "$BUN_CONSUMER" && bun -e "const p = require('./node_modules/@tnezdev/agentic/package.json'); console.log(p.version)")
echo "    Bun installed version: ${BUN_INSTALLED}"

echo "==> Running consumer script under Bun..."
bun run "$REPO_ROOT/scripts/smoke-consumer.mjs" "$BUN_CONSUMER"

NODE_CONSUMER="$TMPDIR_BASE/node-consumer"
mkdir -p "$NODE_CONSUMER"
cat > "$NODE_CONSUMER/package.json" <<'PKG_JSON'
{ "name": "post-publish-node-consumer", "version": "0.0.0", "type": "module" }
PKG_JSON

echo "==> Installing ${PKG} from registry under npm..."
(cd "$NODE_CONSUMER" && npm install --silent "$PKG" 2>&1)

NODE_INSTALLED=$(cd "$NODE_CONSUMER" && node -e "const p = require('./node_modules/@tnezdev/agentic/package.json'); console.log(p.version)")
echo "    Node installed version: ${NODE_INSTALLED}"

echo "==> Running consumer script under Node..."
node "$REPO_ROOT/scripts/smoke-consumer.mjs" "$NODE_CONSUMER"

echo ""
echo "==> Post-publish check passed (${PKG})."
