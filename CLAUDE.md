# mdx-ai

Scriptable AI tools that run locally. Monorepo with two packages.

## Stack

- **Runtime**: Bun.js
- **Language**: TypeScript (ESNext, strict, ESM)
- **Build**: Turbo (workspace orchestration, no bundler — Bun runs .ts directly)
- **Linter**: oxlint
- **Formatter**: oxfmt
- **CLI framework**: commander
- **LLM**: Azure OpenAI via `@mariozechner/pi-ai`
- **TUI**: `@mariozechner/pi-tui`

## Commands

```bash
bun install              # Install dependencies
bun run typecheck        # Typecheck all packages (via turbo)
bun run lint             # Lint with oxlint
bun run format           # Format with oxfmt
bun run format:check     # Check formatting without writing
bun run mdx-ai           # Run the CLI
```

## Structure

```
bin/mdx-ai.ts                          # Unified CLI dispatcher (commander)
packages/workflow/                      # @mdx-ai/workflow — parser, executor, TUI
  bin/mdx-ai-workflow.ts                # Workflow sub-CLI
  src/types.ts                          # All shared types
  src/parser.ts                         # Regex-based MDX parser
  src/executor.ts                       # Execution engine
  src/expressions.ts                    # Expression evaluator
  src/tui/                              # Workflow TUI
packages/agent/                         # @mdx-ai/agent — persistent agent runtime
  bin/mdx-ai-agent.ts                   # Agent sub-CLI
  src/runtime/                          # Agent runtime, skill loader
  src/tui/                              # Agent TUI
examples/workflows/                     # Example .mdx workflows
examples/agents/                        # Example agents
```

## Conventions

- Use `bun` for all package management (not npm/yarn/pnpm)
- Tabs for indentation (enforced by oxfmt)
- No semicolons where avoidable (oxfmt default)
- Run `bun run lint` and `bun run format:check` before committing
- Model string format: `provider/model` (e.g. `azure/gpt-5.2`)
- Config precedence: `MDX_AI_MODEL` env var > `~/.mdx-ai/config.json` > `azure/gpt-5.2`

## Key Design

**Context accumulation**: Prose pushes onto a context stack. `<Generation>` reads the full stack as prompt, appends its result back. Each LLM call sees everything above it.

**Human-in-the-loop**: `<Prompt>`, `<Select>`, `<Confirm>` suspend the executor via an `inputResolver` callback. The TUI creates pi-tui widgets (Input/SelectList), routes keyboard focus, and resolves when the user submits. Non-interactive mode reads from `--input` flags.

**Parser**: Direct regex parsing (no MDX compiler). Extracts frontmatter (YAML), JSX-like components, prose blocks. Handles nested components (Loop, If, Structured>Field).
