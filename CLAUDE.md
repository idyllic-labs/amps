# amps

Agent MetaProgramming System. Scriptable AI tools that run locally. Monorepo with three packages.

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
bun run amps             # Run the CLI
```

## Structure

```
bin/amps.js                            # CLI entry point (thin wrapper)
packages/cli/bin/amps.ts               # CLI dispatcher (commander)
packages/workflow/                      # workflow — parser, executor, TUI
  bin/amps-workflow.ts                  # Workflow sub-CLI
  src/types.ts                          # All shared types
  src/parser.ts                         # Regex-based MDX parser
  src/executor.ts                       # Execution engine
  src/expressions.ts                    # Expression evaluator
  src/tui/                              # Workflow TUI
packages/agent/                         # agent — persistent agent runtime
  bin/amps-agent.ts                     # Agent sub-CLI
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
- Config precedence: `AMPS_MODEL` env var > `~/.amps/config.json` > `azure/gpt-5.2`

## Key Design

**Context accumulation**: Prose pushes onto a context stack. `<Generation>` reads the full stack as prompt, appends its result back. Each LLM call sees everything above it.

**Human-in-the-loop**: `<Prompt>`, `<Select>`, `<Confirm>` suspend the executor via an `inputResolver` callback. The TUI creates pi-tui widgets (Input/SelectList), routes keyboard focus, and resolves when the user submits. Non-interactive mode reads from `--input` flags.

**Parser**: Direct regex parsing (no MDX compiler). Extracts frontmatter (YAML), JSX-like components, prose blocks. Handles nested components (Loop, If, Structured>Field).

## Worklog

Maintain a `WORKLOG.md` at the repo root. After each working session, append an entry capturing what happened. Format:

```markdown
## 2026-02-08 - 10:26 PM

Brief description of what was done, challenges considered, design tensions,
resolutions, and open questions. Write like notes for a future you — enough
context to reconstruct what happened and why, but not verbose.
```

Keep entries brief and humanly relatable. Capture: decisions made, tradeoffs weighed, bugs hit, things learned, open threads.
