# @mdx-ai/agent Specification

## Overview

An agent is a directory containing an `agent.mdx` file that defines identity, behavior, and tools in a single self-contained document. The runtime parses this file, builds tools, connects to an LLM, and runs an interactive tool-use loop.

```
my-agent/
  agent.mdx          # Required. Identity + inline tools
  heartbeat.md       # Optional. Periodic wake-up schedule
  skills/            # Optional. Loadable skill documents
    skill-name/
      SKILL.md
  modules/           # Optional. Custom TypeScript modules
    custom.ts
  sessions/          # Auto-created. Chat history per session
  state/             # Auto-created. Persisted agent state
  logs/              # Auto-created. Daily log files
```

---

## agent.mdx Format

An `.mdx` file combining markdown (for identity) with JSX-like `<Tool>` components (for inline tools).

### Identity

Standard markdown sections parsed into `AgentIdentity`:

```mdx
---
name: MyAgent
---

# Agent: MyAgent

## Purpose

What this agent does.

## Capabilities

- Can do X
- Can do Y

## Constraints

- Must not do Z

## Personality

Tone and style description.
```

All sections are optional except Purpose. The `# Agent: Name` heading provides the agent name (fallback: "UnnamedAgent"). Capabilities and Constraints are extracted as bullet lists.

### Inline Tools

Tools are defined with `<Tool>` components containing `<Param />` tags and a fenced TypeScript code block:

````mdx
<Tool name="tool_name" description="What this tool does">
  <Param name="city" type="string" description="City name" />
  <Param name="verbose" type="boolean" required="false" description="Show details" />

```typescript
async function execute(params: { city: string; verbose?: boolean }, ctx: any) {
  const resp = await fetch(`https://example.com/api?city=${params.city}`);
  return await resp.text();
}
```
````

</Tool>
```

#### Tool Props

| Prop          | Required | Description                       |
| ------------- | -------- | --------------------------------- |
| `name`        | Yes      | Tool name exposed to the LLM      |
| `description` | Yes      | What the tool does (shown to LLM) |

#### Param Props

| Prop          | Required | Default    | Description                            |
| ------------- | -------- | ---------- | -------------------------------------- |
| `name`        | Yes      |            | Parameter name                         |
| `type`        | No       | `"string"` | `"string"`, `"number"`, or `"boolean"` |
| `description` | No       |            | Shown to LLM for parameter guidance    |
| `required`    | No       | `"true"`   | Set `"false"` for optional params      |

#### Code Block Contract

The fenced code block (` ```typescript ` or ` ```ts `) must define:

```typescript
async function execute(params: T, ctx: ToolContext): Promise<string>;
```

- **params** — object matching the declared `<Param />` tags
- **ctx** — `{ agentDir: string, cwd: string, log(msg: string): Promise<void> }`
- **return** — string result shown to the LLM

The code is transpiled from TypeScript to JavaScript via `Bun.Transpiler` and executed via `new Function()`. It runs in the Bun runtime with access to `fetch`, `Bun`, and other globals. The LLM never sees the code — only the tool name, description, and parameter schema.

Errors thrown during execution are caught and returned to the LLM as error text.

---

## Builtin Tools

Every agent has three builtin tools regardless of what's defined in `agent.mdx`:

| Tool         | Params                                              | Description                                                  |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| `bash`       | `command: string`, `timeout?: number`               | Run a shell command (default 30s timeout, cwd = agent dir)   |
| `read_file`  | `path: string`, `offset?: number`, `limit?: number` | Read file contents. Relative paths resolve against agent dir |
| `write_file` | `path: string`, `content: string`                   | Write file. Creates parent directories automatically         |

---

## Skills

Skills are markdown documents in `skills/*/SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill provides
---

Instructions for the agent when this skill is activated.
References relative to {baseDir} are resolved automatically.
```

Skills are indexed at startup and listed in the system prompt as available resources. The LLM can read skill files via `read_file`. Users can invoke skills with `/skill:name args` syntax, which expands the skill body into the prompt.

---

## Modules

Modules are TypeScript files that extend the agent with custom tools, system prompt sections, and lifecycle hooks.

### Builtin: Heartbeat

Loaded automatically. Reads `heartbeat.md` for periodic wake-up scheduling:

```markdown
## Schedule

@every: 15m

## On Wake

- Check for new messages
- Review pending tasks

## Routine Tasks

- Every morning at 09:00: Daily summary
- Every hour: Check system health

## Context Reconstruction

- Read state/priorities.md
- Read state/current-task.md
```

If `heartbeat.md` is absent, the module disables itself silently.

### Custom Modules

Place `*.ts` files in `modules/` with a default export implementing `AgentModule`:

```typescript
interface AgentModule {
  describe(): { name: string; description: string };
  initialize(ctx: ModuleContext): Promise<void>;
  tools(): AgentTool<any>[];
  systemPrompt(): string;
  start(): Promise<void>;
  stop(): void;
}

interface ModuleContext {
  readonly agentDir: string;
  prompt(message: string): Promise<PromptResult>;
  log(message: string): Promise<void>;
}
```

Modules can provide additional tools, contribute system prompt sections, and run background work. They can call `ctx.prompt()` to send messages through the agent loop programmatically.

---

## Runtime Lifecycle

### Initialization

```
1. Parse agent.mdx → identity + inline tool definitions
2. Index skills (scan skills/*/SKILL.md)
3. Load persisted state (state/agent-state.json)
4. Load modules (builtin heartbeat + agent-local modules/*.ts)
5. Initialize each module with ModuleContext
6. Build tool registry: builtin + inline + module tools
7. Create pi-agent-core Agent with system prompt + tools
```

### System Prompt Construction

Built dynamically on each task from:

1. **Identity** — name, purpose, capabilities, constraints, personality
2. **Skills** — XML listing of available skills with descriptions and paths
3. **Module sections** — each module contributes via `systemPrompt()`
4. **Tool hints** — auto-generated list of all registered tools with descriptions

### Task Processing

```
1. Update system prompt and model
2. Rebuild LLM message history from session
3. Expand /skill: commands
4. Stream prompt through pi-agent-core Agent loop
5. Yield AgentEvent stream (text deltas, tool calls, results)
6. Enforce MAX_TURNS (50) safety limit
7. Log task + persist state
```

The Agent loop handles tool-use automatically: the LLM decides which tools to call, the runtime executes them, and results are fed back until the LLM produces a final text response or hits the turn limit.

### Events

The runtime yields `AgentEvent` objects for UI rendering:

| Event                                              | Description                          |
| -------------------------------------------------- | ------------------------------------ |
| `agent_start`                                      | Agent loop began                     |
| `turn_start` / `turn_end`                          | One LLM call + tool execution cycle  |
| `message_start` / `message_update` / `message_end` | Streaming LLM response (text deltas) |
| `tool_execution_start`                             | Tool call initiated (name + args)    |
| `tool_execution_update`                            | Partial tool result                  |
| `tool_execution_end`                               | Tool completed (result + isError)    |
| `agent_end`                                        | Agent loop finished                  |

---

## Session Persistence

Chat history stored as JSON arrays in `sessions/{sessionId}/history.json`:

```json
[
  { "role": "user", "content": "...", "timestamp": "2026-02-08T..." },
  { "role": "assistant", "content": "...", "timestamp": "2026-02-08T..." }
]
```

Default session ID is `"main"`. Use `--session <id>` for named sessions.

---

## CLI

```bash
# Interactive TUI mode
mdx-ai agent <agent-dir>

# Non-interactive (single prompt, exits)
mdx-ai agent <agent-dir> --prompt "What time is it?"

# Named session
mdx-ai agent <agent-dir> --session work
```

### TUI Commands

| Command          | Description             |
| ---------------- | ----------------------- |
| `/help`          | Show available commands |
| `/clear`         | Clear session history   |
| `/skills`        | List available skills   |
| `/skill:name`    | Invoke a skill          |
| `/quit`          | Exit                    |
| `Ctrl+C` (twice) | Exit                    |

---

## Error Handling

| Error source             | Behavior                                      |
| ------------------------ | --------------------------------------------- |
| Module init failure      | Logged, runtime continues without that module |
| Missing skills directory | Warning, no skills available                  |
| Missing heartbeat.md     | Heartbeat module disables silently            |
| Tool execution error     | Caught, returned as error text to LLM         |
| LLM error                | Propagated as event, displayed to user        |
| State/log write failure  | Directory auto-created, retried               |

---

## Extension Points

1. **Inline tools** — `<Tool>` in agent.mdx (simplest, no build step)
2. **Skills** — markdown documents for domain knowledge and procedures
3. **Modules** — TypeScript for custom tools, background work, system prompt injection
4. **Sessions** — named session isolation for different conversation threads
