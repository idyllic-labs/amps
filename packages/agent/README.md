# agent

Persistent tool-calling agents defined in Markdown. Write an `agent.mdx` file, get an interactive agent with custom tools, session history, and a terminal UI.

```bash
amps agent examples/agents/WeatherAssistant
```

## Quick start

Create a directory with an `agent.mdx` file:

```
my-agent/
  agent.mdx
```

````mdx
# Agent: Greeter

## Purpose

A friendly agent that greets people.

<Tool name="greet" description="Greet someone by name">
  <Param name="name" type="string" description="Name to greet" />

```typescript
async function execute(params: { name: string }, ctx: any) {
  return `Hello, ${params.name}!`;
}
```
````

</Tool>
```

Run it:

```bash
amps agent my-agent                        # interactive TUI
amps agent my-agent --prompt "Say hi to Alice"  # single prompt
amps agent my-agent --session dev           # named session
```

## Agent format

An agent is a directory containing an `agent.mdx` file. The file is Markdown with optional YAML frontmatter and inline `<Tool>` components.

### Identity sections

All sections are optional. The agent identity is parsed from Markdown headings:

```mdx
---
name: MyAgent
builtins: read_file, write_file
---

# Agent: MyAgent

## Purpose

What this agent does.

## Capabilities

- What it can do

## Constraints

- Rules it should follow

## Personality

How it should communicate.
```

If no sections are provided, the agent still works — it just has a generic system prompt.

### Frontmatter

| Key        | Default                             | Description                             |
| ---------- | ----------------------------------- | --------------------------------------- |
| `name`     | Parsed from `# Agent: Name` heading | Agent display name                      |
| `builtins` | `read_file, write_file`             | Comma-separated builtin tools to enable |

Available builtins: `read_file`, `write_file`, `bash`. Bash is **disabled by default**.

## Inline tools

Tools are defined with `<Tool>` components containing `<Param>` tags and a fenced TypeScript code block:

````mdx
<Tool name="get_weather" description="Get current weather for a city">
  <Param name="city" type="string" description="City name" />
  <Param name="units" type="string" required="false" description="Optional units" />

```typescript
async function execute(params: { city: string; units?: string }, ctx: any) {
  const resp = await fetch(`https://wttr.in/${params.city}?format=3`);
  return await resp.text();
}
```
````

</Tool>
```

### Parameters

- `type` — `string`, `number`, or `boolean`
- `required` — defaults to `true`; set `required="false"` for optional

### Execution context

The `ctx` object passed to every tool:

| Field              | Description                          |
| ------------------ | ------------------------------------ |
| `ctx.agentDir`     | Absolute path to the agent directory |
| `ctx.cwd`          | Working directory                    |
| `ctx.log(message)` | Write to agent log                   |

### Runtime environment

Tool code runs in the **Bun runtime** with full access to:

- `fetch` — HTTP requests
- `Bun.*` APIs — `Bun.file`, `Bun.spawn`, `Bun.Glob`, etc.
- `import()` — dynamic imports from the project's `node_modules`
- `fs` / `path` — Node-compatible filesystem APIs

There is no sandbox. Tools have the same access as the host process.

Code is transpiled from TypeScript via `Bun.Transpiler` and executed via `new Function()`. Each tool must export an `async function execute(params, ctx)` that returns a string.

## Builtin tools

| Tool         | Description                                   | Default      |
| ------------ | --------------------------------------------- | ------------ |
| `read_file`  | Read file contents with optional offset/limit | Enabled      |
| `write_file` | Write/create files, auto-creates parent dirs  | Enabled      |
| `bash`       | Execute shell commands                        | **Disabled** |

Enable bash in frontmatter:

```yaml
---
builtins: read_file, write_file, bash
---
```

## Sessions

Session history persists across conversations. The full message history (including tool calls and results) is saved and replayed on resume.

```bash
amps agent my-agent --session project-a    # named session
amps agent my-agent                        # default session
```

Sessions are stored as JSON in `<agent-dir>/sessions/`.

## CLI

```
amps agent <path>                  Interactive TUI
amps agent <path> --prompt "…"     Single prompt, then exit
amps agent <path> --session <id>   Resume a named session
```

## Examples

### WeatherAssistant

Single tool that fetches weather:

````mdx
# Agent: WeatherAssistant

<Tool name="get_weather" description="Get current weather for a city">
  <Param name="city" type="string" description="City name" />

```typescript
async function execute(params: { city: string }, ctx: any) {
  const resp = await fetch(`https://wttr.in/${encodeURIComponent(params.city)}?format=3`);
  return await resp.text();
}
```
````

</Tool>
```

### DevAssistant

A more capable agent with 6 inline tools: web search (DuckDuckGo), file globbing, content grep, HTTP fetch, persistent scratchpad, and system info. See [`examples/agents/DevAssistant/agent.mdx`](../../examples/agents/DevAssistant/agent.mdx).

### ToolsDemo

Minimal starter — time and arithmetic. See [`examples/agents/ToolsDemo/agent.mdx`](../../examples/agents/ToolsDemo/agent.mdx).
