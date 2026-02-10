FROM oven/bun:latest

WORKDIR /test

# Install imps from the local tarball (mounted at build time)
COPY idyllic-labs-imps-*.tgz /tmp/imps.tgz
RUN bun install -g /tmp/imps.tgz && bun pm -g trust @idyllic-labs/imps

# Create a minimal test agent
RUN mkdir -p /test/agent && cat > /test/agent/agent.mdx << 'AGENT'
# Agent: SmokeTest

## Purpose
Verify imps works after a fresh install.

<Tool name="ping" description="Returns pong to verify inline tools work">

```typescript
async function execute(params: {}, ctx: any) {
  return "pong from inline tool"
}
```
</Tool>

<Tool name="add" description="Add two numbers">
  <Param name="a" type="number" description="First number" />
  <Param name="b" type="number" description="Second number" />

```typescript
async function execute(params: { a: number; b: number }, ctx: any) {
  return String(params.a + params.b)
}
```
</Tool>
AGENT

# Copy the test script
COPY smoke-test.sh /test/smoke-test.sh
RUN chmod +x /test/smoke-test.sh

ENTRYPOINT ["/test/smoke-test.sh"]
