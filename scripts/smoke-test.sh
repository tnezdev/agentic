#!/usr/bin/env bash
# Pre-publish smoke test for @tnezdev/agentic and @tnezdev/agentic-runtime-local
#
# Validates that the npm-packed tarball is consumable by Bun:
#   1. npm pack → tarballs
#   2. Install tarballs in a temp directory
#   3. Import the public APIs under Bun and verify exports
#
# Usage: bash scripts/smoke-test.sh
# Requires: bun, npm

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

echo "==> Setting up consumer project..."
CONSUMER="$TMPDIR_BASE/consumer"
mkdir -p "$CONSUMER"
cat > "$CONSUMER/package.json" <<'PKG'
{ "name": "smoke-consumer", "version": "0.0.0", "type": "module" }
PKG

echo "==> Installing from tarballs..."
(cd "$CONSUMER" && bun add "$TARBALL_PATH" "$RUNTIME_TARBALL_PATH" 2>&1)

echo "==> Running consumer script under Bun..."
bun run "$REPO_ROOT/scripts/smoke-consumer.mjs" "$CONSUMER"

echo ""
echo "==> Smoke test passed."
