# Worklog

## 2026-02-08 - 9:30 PM

Implemented inline `<Tool>` components for agent `.mdx` files. The big idea: agents should be self-contained single files where tools are defined inline with TypeScript, not hardcoded in source. The LLM sees tool name + schema, never the code.

Built three pieces:
- **mdx-parser.ts** — extracts `<Tool>` blocks (with `<Param />` tags and fenced TS code) from `.mdx` source, strips them, passes remainder through existing markdown identity parser
- **tool-builder.ts** — converts parsed tool defs into pi-agent-core `AgentTool` instances. Builds TypeBox schemas from params, transpiles TS via `Bun.Transpiler`, wraps execution in `new Function()`
- **AgentRuntime integration** — `.mdx`-first file detection, inline tool building, dynamic system prompt tool hints generated from `this.allTools` instead of hardcoded strings

Initially had `.md` fallback but decided to drop it entirely — only `.mdx` now. Simpler, one format to support. Migrated all example agents.

Hit a bug: `ENOENT: open ''` when running ToolsDemo. Root cause: `log()` and `saveState()` in AgentRuntime write to `logsDir`/`stateDir` without creating the directories first. Fixed with `mkdir({ recursive: true })` guards.

Also found that assistant responses weren't persisting in session history from the first run — the ENOENT error was killing the process before the TUI's save could run.

## 2026-02-08 - 10:20 PM

Design discussion: should custom inline tools be grouped under a single meta-tool, or stay flat?

Went deep on the fundamental tradeoffs. The core tension is **selection complexity vs. parameterization complexity**. A tool call is two sequential predictions: pick the tool, then fill the params. LLMs are specifically fine-tuned for discrete tool selection (choosing from a named list) but weaker at generating complex nested schemas. So flat tools play to the model's strength.

But there's a cliff: past ~20-30 tools, selection accuracy degrades and schema tokens crowd out conversation context. At that point you need compression — either grouping (semantically close tools under one meta-tool) or routing (cheap classifier model picks a domain, specialist model picks from a smaller tool set).

Key insight: group by **semantic distance**, not implementation. `create_user`/`delete_user` = good group (same entity). `get_weather`/`calculate` = bad group (unrelated domains). For mdx-ai at ~6 tools, flat is unambiguously correct.

Open thread: when someone builds an agent with 25+ inline tools, the right answer is probably dynamic tool selection (expose relevant subset per turn) rather than static grouping. Not a problem yet.

## 2026-02-08 - 11:00 PM

Wrote `spec.md` — a comprehensive specification for the agent package covering the full `.mdx` format, builtin tools, skills, modules, runtime lifecycle, events, sessions, CLI, and error handling. Useful as both documentation and a contract for test writing.

## 2026-02-08 - 11:30 PM

Wrote comprehensive test suite — 71 tests across 6 files, all passing in ~400ms. Used Bun's built-in test runner with temp directories (no Docker needed).

Test files:
- **mdx-parser** (18 tests) — identity extraction, tool/param parsing, code blocks, edge cases (no frontmatter, empty tools, multiple tools, nested braces in code)
- **tool-builder** (14 tests) — TypeBox schema construction for string/number/boolean/optional params, tool execution, error catching, context access, async/await, Bun globals
- **builtin-tools** (10 tests) — bash (commands, exit codes, stderr, cwd, timeout), read_file (content, offset/limit, missing files, relative paths), write_file (creation, parent dirs, overwrite)
- **session-manager** (7 tests) — empty history, save/load, append, clear, session isolation, default ID, cross-instance persistence
- **skill-loader** (10 tests) — indexing, descriptions, content loading, `{baseDir}` substitution, body without frontmatter, unknown skills, `hasSkill`, XML prompt formatting, empty/missing dirs, caching
- **agent-runtime e2e** (7 tests) — creates fresh agent directories from scratch with `agent.mdx` + heartbeat + skills, verifies identity parsing, skill loading, directory handling, minimal agents, inline tool execution, error propagation

All checks pass: typecheck, lint (0 warnings), format.

## 2026-02-08 - 11:50 PM

Design session: separating the daemon from the agent, and a deeper realization about the data model.

**The confusion that surfaced:** The current code treats an agent spec and a running agent as the same thing. One directory = one runtime = one session. But that's like treating a class and an object as identical. The `.mdx` file is a *spec* (a class). A running agent is an *instance* (an object). You should be able to spawn multiple instances of the same spec, each with independent state and sessions.

**Three concepts emerging:**
- **Agent Spec** = the `.mdx` file. Blueprint. Immutable template.
- **Agent Instance** = a running instantiation. Own state, sessions, memory. Like a process.
- **Environment** = the container that manages instance lifecycles. Spawn, stop, list. This is what the daemon *should* be, but isn't yet.

**Current `mdx-ai agent <dir>` stays simple** — it's the singleton shortcut. Load a spec, make one implicit instance, chat. No environment needed.

**Where it gets fuzzy:**
- Does heartbeat belong to the instance or the environment? An instance could run its own timer. Or the environment could tick all heartbeats centrally. Both are valid, unclear which is right.
- Workspaces — giving instances their own filesystem sandbox. Feels right (agents-as-processes should have a working directory), but it's scope creep right now.
- Inter-instance communication — if two instances of different specs are in the same environment, can they message each other? Big design fork.
- The existing daemon code in `src/daemon/` assumes singletons and isn't wired into the CLI. It needs rethinking, not just integration.

**Decision:** Don't touch the daemon code yet. The mental model needs to settle. Wrote out the full vision and open questions in `TODO.md`. Will revisit once the spec/instance distinction feels solid.

## 2026-02-09 - 12:30 AM

Fixed a significant bug: session history was lossy. We were only storing `{ role: "user"|"assistant", content: string }` — tool calls and tool results were silently dropped. The LLM couldn't see its own prior tool usage, so it would re-call tools or behave inconsistently across turns.

Looked at how pi-coding-agent handles this (via DeepWiki): they store the full `AgentMessage[]` array including `ToolCall` content blocks and `ToolResultMessage` entries, serialized as JSONL. On resume they replay the full array via `replaceMessages()`.

Applied the same pattern: `SessionManager` now stores the complete `AgentMessage[]` from `agent.state.messages`. On load, we call `replaceMessages()` directly — no synthetic message reconstruction. The TUI extracts display text from the full message structure. Deleted the lossy `buildHistoryMessages()` entirely.

## 2026-02-09 - 1:00 AM

Built a more complex inline tool demo (`DevAssistant`) with 6 tools: web_search (DuckDuckGo HTML parsing), glob_files (Bun.Glob), search_files (regex grep), http_fetch, scratchpad (persistent notes), system_info. This is the kind of agent the system is actually designed for — a knowledge/utility agent defined entirely in one `.mdx` file.

## 2026-02-09 - 1:30 AM

Design session: the vision, the runtime question, and security posture.

**The core tension: where does the agent run?** Everything else follows from this one question. Local Bun gives you full filesystem, `new Function()`, `Bun.spawn`, native modules. Cloudflare Workers gives you edge deployment but no filesystem, no `Bun.Transpiler`, no shell. Making it work on both requires a storage abstraction layer and pre-compiled tool bundles.

**Decision for now:** Stay on Bun, don't chase Workers yet. The immediate pitch — "ship an `agents/` directory, version-controlled, comes with TUI, all you write is markdown" — is a local dev tool story. Workers becomes relevant when we want to *host* agents as a service.

**What inline tools actually are:** Serverless functions. Each one is a TypeScript function with a standard signature (`execute(params, ctx) → string`), no build step, deployed by writing it in a document. The `.mdx` file is both the infrastructure definition and the code. `new Function()` gives full Bun runtime access — `fetch`, `Bun.spawn`, `Bun.file`, `import()`. No sandboxing. Powerful but dangerous by design.

**Made bash opt-in:** These aren't coding agents by default — they're knowledge agents (librarian, oracle, connector). Bash is now disabled unless you explicitly set `builtins: read_file, write_file, bash` in frontmatter. Default builtins: `read_file`, `write_file`.

**Dependencies question:** Inline tools can do `await import("some-package")` and Bun resolves it from the project's `node_modules`. No declaration mechanism yet. Future: maybe `dependencies` in frontmatter, or `package.json` per agent directory.

**The north star:** Multi-agent environments. Multiple agents as `.mdx` files in a directory, running as separate processes, possibly communicating. The spec/instance distinction (from the daemon discussion) matters here — you want to spin up multiple instances of the same agent spec. Not building this yet, but it's where this is heading.

**What's still fuzzy:** Memory (filesystem as KV? dedicated memory module?), the storage abstraction (needed for Workers but also for clean local code), and how inline tool dependencies should be managed when agents get distributed.

## 2026-02-09 - 2:00 AM

Made the package publishable as `bun install -g mdx-ai`. Key decisions:

- Removed `private: true`, merged workspace deps into root `package.json`, added `files` array to control tarball contents
- Bun runs `.ts` directly so we keep TypeScript bin entries with `#!/usr/bin/env bun` shebangs — no build step
- Created `.npmignore` to exclude test files, state/session/log dirs, dev configs
- Verified full pipeline: `npm pack` → `bun install -g ./mdx-ai-0.1.0.tgz` → `mdx-ai --version` → `mdx-ai agent <dir> --prompt "ping me"` — all works

Built a Docker smoke test suite (`tests/smoke/`):
- `Dockerfile` — fresh `oven/bun:latest`, installs from tarball, creates test agent with `ping` and `add` inline tools
- `smoke-test.sh` — 7 assertions: CLI basics (version, help, providers), agent init (parses mdx, finds inline tools, bash disabled by default), optional LLM integration tests (with API keys)
- `run.sh` — orchestrator: builds tarball, builds Docker image, runs tests, cleans up. Supports `--with-llm` flag

All 7 smoke tests pass in Docker (OrbStack). Confirms clean install from tarball in a fresh container.

## 2026-02-09 - 3:00 AM

Renamed package from `mdx-ai` to `@idyllic-labs/amps` (Agent MetaProgramming System). `mdx-ai` was taken on npm.

Renamed everything user-facing: CLI command (`amps`), config dir (`~/.amps`), env vars (`AMPS_MODEL`, `AMPS_HOME`), TUI branding, help text, smoke tests. Internal function names updated too (`getMdxAiHome` → `getAmpsHome`). Comments and temp dir prefixes left as-is — not worth the churn.

Restructured the CLI entry point: `bin/amps.js` is a 2-line `.js` wrapper (`#!/usr/bin/env bun` + import) that loads `packages/cli/bin/amps.ts`. This works around npm stripping `.ts` bin entries while keeping all the actual code in TypeScript.

Created package-level READMEs (`packages/agent/README.md`, `packages/workflow/README.md`) with full docs. Root README is now a slim index — project description, install, package table, example links, dev commands. No specs.

Published `@idyllic-labs/amps@0.1.0-alpha.1` to npm. Docker smoke test passes with the new name. All 72 unit tests pass.
