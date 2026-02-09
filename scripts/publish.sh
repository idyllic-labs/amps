#!/bin/bash
# Publish @idyllic-labs/amps to npm.
#
# Usage:
#   ./scripts/publish.sh           # publish current version
#   ./scripts/publish.sh --dry-run # preview without publishing
#
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

VERSION=$(node -p "require('./package.json').version")
echo "Publishing @idyllic-labs/amps@$VERSION"

# Pre-flight checks
echo ""
echo "Running checks..."
bun run test 2>&1 | tail -1
bun run lint 2>&1 | tail -1
echo "Checks passed."

# Build and publish
echo ""
if [ "$1" = "--dry-run" ]; then
  echo "Dry run — packing only..."
  npm pack
  echo ""
  echo "Would publish: @idyllic-labs/amps@$VERSION"
  rm -f idyllic-labs-amps-*.tgz
else
  npm publish --tag alpha --access public
  echo ""
  echo "Published @idyllic-labs/amps@$VERSION"
  echo "Install: bun install -g @idyllic-labs/amps@$VERSION"
fi
