#!/usr/bin/env bash
# Post-publish validation for @tnezdev/agentic and @tnezdev/agentic-runtime-local
#
# Installs the packages from the npm registry (not local tarballs) and
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
CORE_PKG="@tnezdev/agentic@${VERSION}"
RUNTIME_PKG="@tnezdev/agentic-runtime-local@${VERSION}"

TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

BUN_CONSUMER="$TMPDIR_BASE/bun-consumer"
mkdir -p "$BUN_CONSUMER"
cat > "$BUN_CONSUMER/package.json" <<'PKG_JSON'
{ "name": "post-publish-bun-consumer", "version": "0.0.0", "type": "module" }
PKG_JSON

echo "==> Installing ${CORE_PKG} and ${RUNTIME_PKG} from registry under Bun..."
(cd "$BUN_CONSUMER" && bun add "$CORE_PKG" "$RUNTIME_PKG" 2>&1)

BUN_INSTALLED=$(cd "$BUN_CONSUMER" && bun -e "const p = require('./node_modules/@tnezdev/agentic/package.json'); console.log(p.version)")
echo "    Bun installed version: ${BUN_INSTALLED}"
BUN_RUNTIME_INSTALLED=$(cd "$BUN_CONSUMER" && bun -e "const p = require('./node_modules/@tnezdev/agentic-runtime-local/package.json'); console.log(p.version)")
echo "    Bun runtime installed version: ${BUN_RUNTIME_INSTALLED}"

echo "==> Running consumer script under Bun..."
bun run "$REPO_ROOT/scripts/smoke-consumer.mjs" "$BUN_CONSUMER"

NODE_CONSUMER="$TMPDIR_BASE/node-consumer"
mkdir -p "$NODE_CONSUMER"
cat > "$NODE_CONSUMER/package.json" <<'PKG_JSON'
{ "name": "post-publish-node-consumer", "version": "0.0.0", "type": "module" }
PKG_JSON

echo "==> Installing ${CORE_PKG} and ${RUNTIME_PKG} from registry under npm..."
(cd "$NODE_CONSUMER" && npm install --silent "$CORE_PKG" "$RUNTIME_PKG" 2>&1)

NODE_INSTALLED=$(cd "$NODE_CONSUMER" && node -e "const p = require('./node_modules/@tnezdev/agentic/package.json'); console.log(p.version)")
echo "    Node installed version: ${NODE_INSTALLED}"
NODE_RUNTIME_INSTALLED=$(cd "$NODE_CONSUMER" && node -e "const p = require('./node_modules/@tnezdev/agentic-runtime-local/package.json'); console.log(p.version)")
echo "    Node runtime installed version: ${NODE_RUNTIME_INSTALLED}"

echo "==> Running consumer script under Node..."
node "$REPO_ROOT/scripts/smoke-consumer.mjs" "$NODE_CONSUMER"

echo ""
echo "==> Post-publish check passed (${CORE_PKG}, ${RUNTIME_PKG})."
