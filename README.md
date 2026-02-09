# amps

**Agent MetaProgramming System** — scriptable AI agents defined in Markdown. The document is the program.

```bash
# Workflow: prose becomes prompt, components become actions
amps workflow run examples/workflows/blog-post.mdx --input topic="distributed systems"

# Agent: markdown defines identity, inline tools define capabilities
amps agent examples/agents/WeatherAssistant
```

From [Idyllic Labs](https://idylliclabs.com), where we research composable primitives for programmable intelligence.

## Install

**Bun-only.** Runs TypeScript source directly via Bun APIs. Node.js is not supported.

```bash
bun install -g @idyllic-labs/amps
```

## Packages

| Package | Description |
|---------|-------------|
| [`agent`](packages/agent) | Persistent tool-calling agents — identity and inline tools in a single `.mdx` file |
| [`workflow`](packages/workflow) | Deterministic document execution — prose accumulates context, components control flow |
| [`cli`](packages/cli) | Unified CLI dispatcher |

## Examples

- [`examples/agents/`](examples/agents) — WeatherAssistant, DevAssistant, ToolsDemo
- [`examples/workflows/`](examples/workflows) — blog-post, interview-prep, product-naming, lesson-plan, code-review

## Development

```bash
bun install              # install deps
bun run typecheck        # typecheck all packages
bun run test             # run tests
bun run lint && bun run format   # lint + format
```

## License

MIT

---

[Idyllic Labs](https://idylliclabs.com) · San Francisco
