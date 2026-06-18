#!/usr/bin/env bash
# Node smoke test for @tnezdev/agentic and @tnezdev/agentic-runtime-local
#
# Validates that the npm-packed tarball is consumable by Node.js (the
# Bun-only constraint we lifted in #32). Mirrors smoke-test.sh but runs
# the consumer under Node instead of Bun.
#
#   1. npm pack → tarballs (prepack runs `bun run build` → dist/)
#   2. Install tarballs in a temp directory under npm
#   3. Run the plain-JS consumer script with Node
#
# Usage: bash scripts/smoke-test-node.sh
# Requires: bun (for build), npm, node
#
# This complements smoke-test.sh — both must pass before we ship.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="$REPO_ROOT/packages/agentic"
RUNTIME_PACKAGE_DIR="$REPO_ROOT/packages/agentic-runtime-local"
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

echo "==> Packing Agentic tarball (runs prepack → bun run build)..."
TARBALL=$(cd "$PACKAGE_DIR" && npm pack --silent --pack-destination "$TMPDIR_BASE" 2>/dev/null)
TARBALL_PATH="$TMPDIR_BASE/$TARBALL"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "FAIL: npm pack did not produce a tarball"
  exit 1
fi
echo "    Tarball: $TARBALL"

echo "==> Packing local runtime tarball (runs prepack → bun run build)..."
RUNTIME_TARBALL=$(cd "$RUNTIME_PACKAGE_DIR" && npm pack --silent --pack-destination "$TMPDIR_BASE" 2>/dev/null)
RUNTIME_TARBALL_PATH="$TMPDIR_BASE/$RUNTIME_TARBALL"

if [ ! -f "$RUNTIME_TARBALL_PATH" ]; then
  echo "FAIL: npm pack did not produce a local runtime tarball"
  exit 1
fi
echo "    Tarball: $RUNTIME_TARBALL"

echo "==> Setting up Node consumer project..."
CONSUMER="$TMPDIR_BASE/consumer"
mkdir -p "$CONSUMER"
cat > "$CONSUMER/package.json" <<'PKG'
{ "name": "smoke-consumer-node", "version": "0.0.0", "type": "module" }
PKG

echo "==> Installing from tarballs under npm..."
(cd "$CONSUMER" && npm install --silent "$TARBALL_PATH" "$RUNTIME_TARBALL_PATH" 2>&1)

echo "==> Running consumer script under Node..."
node "$REPO_ROOT/scripts/smoke-consumer.mjs" "$CONSUMER"

echo ""
echo "==> Node smoke test passed."
