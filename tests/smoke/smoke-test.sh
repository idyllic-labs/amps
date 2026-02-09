#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass=0
fail=0

check() {
  local desc="$1"
  local cmd="$2"
  local expect="$3"

  echo -n "  $desc... "
  output=$(eval "$cmd" 2>&1) || true

  if echo "$output" | grep -q "$expect"; then
    echo -e "${GREEN}PASS${NC}"
    pass=$((pass + 1))
  else
    echo -e "${RED}FAIL${NC}"
    echo "    Expected: $expect"
    echo "    Got: $(echo "$output" | head -5)"
    fail=$((fail + 1))
  fi
}

echo ""
echo "=== amps Smoke Test ==="
echo ""

# 1. CLI basics
echo "CLI:"
check "version" "amps --version" "0.1.0"
check "help" "amps --help" "Agent MetaProgramming System"
check "agent help" "amps agent --help" "agent-path"
check "providers" "amps providers" "amps providers"

# 2. Agent initialization (doesn't need API key)
echo ""
echo "Agent init:"
check "parses agent.mdx" \
  "amps agent /test/agent --prompt 'hi' 2>&1 || true" \
  "Agent: SmokeTest"
check "finds inline tools" \
  "amps agent /test/agent --prompt 'hi' 2>&1 || true" \
  "Inline tools: ping, add"
check "no bash by default" \
  "amps agent /test/agent --prompt 'hi' 2>&1 || true" \
  "Builtin tools: read_file, write_file"

# 3. If API keys are available, test actual LLM interaction
echo ""
if [ -n "$AZURE_OPENAI_API_KEY" ] || [ -n "$OPENAI_API_KEY" ]; then
  echo "LLM integration (live):"
  check "agent responds" \
    "amps agent /test/agent --prompt 'ping me using the ping tool' --session smoke1" \
    "pong"
  check "tool execution" \
    "amps agent /test/agent --prompt 'what is 3 + 4 using the add tool' --session smoke2" \
    "7"
else
  echo "LLM integration: SKIPPED (no API keys in environment)"
fi

# Summary
echo ""
echo "========================="
echo -e "  ${GREEN}$pass passed${NC}, ${RED}$fail failed${NC}"
echo "========================="
echo ""

[ $fail -eq 0 ] && exit 0 || exit 1
