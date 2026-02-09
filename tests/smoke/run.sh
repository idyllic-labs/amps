#!/bin/bash
# Smoke test: build tarball, install in Docker, verify everything works.
#
# Usage:
#   ./tests/smoke/run.sh                    # Without LLM (init-only tests)
#   ./tests/smoke/run.sh --with-llm         # With LLM (pass API keys from env)
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Building tarball..."
cd "$ROOT_DIR"
npm pack --quiet

TARBALL=$(ls idyllic-labs-amps-*.tgz | head -1)
cp "$TARBALL" "$SCRIPT_DIR/"

echo "Building Docker image..."
cd "$SCRIPT_DIR"
docker build -t amps-smoke . --quiet

echo "Running smoke tests..."
DOCKER_ARGS=()

if [ "$1" = "--with-llm" ]; then
  # Pass through API key env vars
  for var in AZURE_OPENAI_API_KEY AZURE_OPENAI_RESOURCE_NAME OPENAI_API_KEY ANTHROPIC_API_KEY; do
    if [ -n "${!var}" ]; then
      DOCKER_ARGS+=(-e "$var=${!var}")
    fi
  done
fi

docker run --rm "${DOCKER_ARGS[@]}" amps-smoke
EXIT_CODE=$?

# Cleanup
rm -f "$SCRIPT_DIR"/idyllic-labs-amps-*.tgz
rm -f "$ROOT_DIR"/idyllic-labs-amps-*.tgz

exit $EXIT_CODE
