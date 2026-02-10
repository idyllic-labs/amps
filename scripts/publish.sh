#!/bin/bash
# Release @idyllic-labs/imps — bumps version, tags, and pushes.
# The GitHub Action handles npm publish.
#
# Usage:
#   ./scripts/publish.sh
#
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CURRENT=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT"
echo ""

read -p "New version: " VERSION
if [ -z "$VERSION" ]; then
	echo "No version entered, aborting."
	exit 1
fi

echo ""
echo "This will:"
echo "  1. Set version to $VERSION in package.json"
echo "  2. Commit, tag v$VERSION, and push to origin"
echo "  3. GitHub Action will publish to npm"
echo ""
read -p "Proceed? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
	echo "Aborted."
	exit 0
fi

# Update version in root package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

git add package.json
git commit -m "v$VERSION"
git tag "v$VERSION"
git push origin main "v$VERSION"

echo ""
echo "Pushed v$VERSION — GitHub Action will publish to npm."
