# TODO

## Agent Environment — Spec vs Instance Separation

### The Problem

Right now the code conflates **agent spec** with **agent instance**. One directory = one runtime = one chat session. The daemon (`src/daemon/`) tries to manage multiple agents but still treats each as a singleton. This is wrong.

### The Vision

Three distinct concepts:

1. **Agent Spec** (class) — The `.mdx` file. A blueprint. Defines identity, tools, capabilities. Immutable template. `WeatherAssistant/agent.mdx` is a spec, not a running thing.

2. **Agent Instance** (object) — A running instantiation of a spec. Has its own session history, state, memory. Multiple instances of the same spec can exist simultaneously, each independent. Think of them as processes.

3. **Environment** (runtime/container) — Manages the lifecycle of instances. Can spawn, stop, list instances. Instances can appear and disappear. The environment is the thing that persists.

### Current `imps agent <dir>` Behavior

Should stay simple: loads a spec, creates a single implicit instance, runs a chat. This is the "singleton shortcut" — you don't need an environment to just talk to an agent. Equivalent to `new WeatherAssistant()` with a default session.

### Environment Behavior (future)

An environment manages multiple instances across multiple specs:

```
environment/
  specs/              # or just references to agent dirs
    WeatherAssistant/ -> agent.mdx
    CodeReviewer/     -> agent.mdx
  instances/
    weather-eu-1/     # instance of WeatherAssistant
      state/
      sessions/
      logs/
    weather-us-1/     # another instance of WeatherAssistant
      state/
      sessions/
      logs/
    reviewer-1/       # instance of CodeReviewer
      ...
```

Spawning: `spawn("WeatherAssistant", { id: "weather-eu-1", config: { region: "europe" } })`

### Open Questions (unresolved)

- **Does heartbeat require a daemon?** Heartbeat is periodic wake-up scheduling. An instance could manage its own heartbeat timer without a daemon process. Or the environment could be the thing that ticks heartbeats for all its instances. Not clear yet.

- **Workspaces** — Could instances get their own filesystem workspace (a working directory)? Like giving an agent a sandbox to operate in. Related to the `cwd` in `ToolContext`. Feels right but adds complexity.

- **Inter-instance communication** — Can instances within an environment talk to each other? Message passing? Shared state? Or are they fully isolated? This is a big design fork.

- **Daemon vs environment** — Is the daemon just the OS-level process manager (PID file, start/stop), and the environment is the logical concept on top? Or are they the same thing? The current daemon code mixes both concerns.

- **Instance lifecycle** — What triggers spawn/death? User command? Another agent? Heartbeat schedule? External events?

- **Configuration at spawn time** — Can you parameterize an instance when spawning it? Like passing `region: "europe"` to a WeatherAssistant instance? How does that flow into the agent's context?

### What Exists Today (Daemon Code)

The `src/daemon/` directory has:
- `daemon.ts` — discovers agents, creates one runtime per agent, runs heartbeats, manages shutdown
- `agent-discovery.ts` — scans `~/.imps/agents/` for agent dirs with `agent.mdx`
- `multi-heartbeat.ts` — wraps multiple runtimes
- `process-manager.ts` — PID file management, start/stop/status

This code is **not integrated into the CLI** yet. It assumes singleton agents. It would need significant rethinking to support the spec/instance model.

### Recommended Next Steps

1. Don't touch the daemon code yet — the mental model needs to settle first
2. Keep `imps agent <dir>` as the simple "one spec, one instance" path
3. Design the environment concept separately, maybe as `imps env` commands
4. Figure out whether heartbeat belongs to the instance or the environment
