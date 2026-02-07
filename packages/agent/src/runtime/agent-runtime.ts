import type { AgentIdentity, AgentState } from "../types/index.ts";
import type { AgentModule, ModuleContext, PromptResult } from "../types/module.ts";
import { parseMarkdown, parseAgentIdentity } from "./markdown-parser.ts";
import { SkillLoader } from "./skill-loader.ts";
import { createBuiltinTools } from "./tools.ts";
import { loadModules } from "./module-loader.ts";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import {
  getModel,
  type AssistantMessage,
  type Message,
  type Model,
  type TextContent,
} from "@mariozechner/pi-ai";

const MAX_TURNS = 50;

/**
 * Main mdx-ai/agent runtime
 * Orchestrates markdown-based agent configuration with pi-agent-core Agent loop
 */
export class AgentRuntime {
  private agentDir: string;
  private identity?: AgentIdentity;
  private skillLoader: SkillLoader;
  private state: AgentState = { context: {} };
  private modules: AgentModule[] = [];

  private agentMdPath: string;
  private skillsDir: string;
  private stateDir: string;
  private memoryDir: string;
  private logsDir: string;
  private lastModelInfo?: { id: string; provider: string; contextWindow: number };

  private agent?: Agent;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
    this.agentMdPath = `${agentDir}/agent.md`;
    this.skillsDir = `${agentDir}/skills`;
    this.stateDir = `${agentDir}/state`;
    this.memoryDir = `${agentDir}/memory`;
    this.logsDir = `${agentDir}/logs`;

    this.skillLoader = new SkillLoader(this.skillsDir);
  }

  /**
   * Initialize the runtime — load configs, modules, and create Agent instance
   */
  async initialize(): Promise<void> {
    console.log("Initializing mdx-ai agent runtime...\n");

    // 1. Load agent identity
    await this.loadAgentIdentity();

    // 2. Index available skills
    await this.skillLoader.indexSkills();

    // 3. Load persisted state
    await this.loadState();

    // 4. Load modules (built-in + agent-local)
    const { modules, errors } = await loadModules(this.agentDir);
    for (const err of errors) {
      console.warn(`Module load error [${err.source}]: ${err.error.message}`);
    }

    // 5. Create module context
    const ctx: ModuleContext = {
      agentDir: this.agentDir,
      prompt: (message: string) => this.modulePrompt(message),
      log: (message: string) => this.log(message),
    };

    // 6. Initialize each module
    for (const mod of modules) {
      const desc = mod.describe();
      try {
        await mod.initialize(ctx);
        this.modules.push(mod);
        console.log(`Module: ${desc.name} — ${desc.description}`);
      } catch (err) {
        console.error(`Module ${desc.name} failed to initialize:`, err);
      }
    }

    // 7. Collect tools: built-in + module-provided
    const builtinTools = createBuiltinTools(this.agentDir);
    const moduleTools = this.modules.flatMap((m) => {
      try {
        return m.tools();
      } catch (err) {
        console.error(`Module ${m.describe().name} tools() failed:`, err);
        return [];
      }
    });

    // 8. Create Agent instance
    const model = getModel("azure-openai-responses", "gpt-5.2");
    const systemPrompt = this.buildSystemPrompt();

    this.agent = new Agent({
      convertToLlm: (messages) => {
        const result: Message[] = [];
        for (const msg of messages) {
          if (
            typeof msg === "object" &&
            "role" in msg &&
            (msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult")
          ) {
            result.push(msg as Message);
          }
        }
        return result;
      },
    });
    this.agent.setSystemPrompt(systemPrompt);
    this.agent.setModel(model);
    this.agent.setTools([...builtinTools, ...moduleTools]);

    this.lastModelInfo = {
      id: model.id,
      provider: model.provider,
      contextWindow: model.contextWindow,
    };

    console.log("\nRuntime initialized successfully");
  }

  /**
   * Load agent.md and parse identity
   */
  private async loadAgentIdentity(): Promise<void> {
    const content = await Bun.file(this.agentMdPath).text();
    const markdown = parseMarkdown(content);
    this.identity = parseAgentIdentity(markdown);

    console.log(`Agent: ${this.identity.name}`);
    console.log(`Purpose: ${this.identity.purpose}`);
    console.log(`Capabilities: ${this.identity.capabilities.length}`);
    console.log(`Constraints: ${this.identity.constraints.length}`);
  }

  /**
   * Start the agent — starts all modules
   */
  async start(): Promise<void> {
    console.log("\n=== Starting Agent ===\n");

    for (const mod of this.modules) {
      const desc = mod.describe();
      try {
        await mod.start();
        console.log(`Module started: ${desc.name}`);
      } catch (err) {
        console.error(`Module ${desc.name} failed to start:`, err);
      }
    }
  }

  /**
   * Process a user task/prompt using the Agent tool-use loop.
   * Yields AgentEvent for the caller to render.
   */
  async *processTaskStream(
    taskDescription: string,
    history?: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }>,
  ): AsyncGenerator<AgentEvent> {
    if (!this.agent) {
      throw new Error("Agent not initialized — call initialize() first");
    }

    // Update system prompt (skills/modules may have changed)
    const systemPrompt = this.buildSystemPrompt();
    this.agent.setSystemPrompt(systemPrompt);

    // Update model
    const model = getModel("azure-openai-responses", "gpt-5.2");
    this.agent.setModel(model);
    this.lastModelInfo = {
      id: model.id,
      provider: model.provider,
      contextWindow: model.contextWindow,
    };

    // Rebuild message history
    const priorMessages = this.buildHistoryMessages(history, model);
    this.agent.replaceMessages(priorMessages);

    // Expand skill commands
    const expandedTask = await this.expandSkillCommand(taskDescription);

    // Event queue: subscribe collects events, generator yields them
    const eventQueue: AgentEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let done = false;

    const unsub = this.agent.subscribe((event: AgentEvent) => {
      eventQueue.push(event);
      if (event.type === "agent_end") {
        done = true;
      }
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    });

    // Fire the prompt (don't await — we yield events as they arrive)
    const promptPromise = this.agent.prompt(expandedTask);

    // Track turns for safety
    let turnCount = 0;

    try {
      while (!done) {
        if (eventQueue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
          });
        }

        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;

          if (event.type === "turn_start") {
            turnCount++;
            if (turnCount > MAX_TURNS) {
              this.agent.abort();
              done = true;
              break;
            }
          }

          yield event;

          if (event.type === "agent_end") {
            done = true;
            break;
          }
        }
      }

      await promptPromise;
    } finally {
      unsub();
    }

    await this.log(`Task: ${expandedTask}`);
    this.state.currentTask = expandedTask;
    await this.saveState();
  }

  /**
   * Execute an LLM prompt on behalf of a module.
   * Runs through the same Agent tool-use loop as user prompts.
   */
  private async modulePrompt(message: string): Promise<PromptResult> {
    if (!this.agent) {
      return { text: "", error: "Agent not initialized" };
    }

    try {
      this.agent.setSystemPrompt(this.buildSystemPrompt());

      let resultText = "";
      const unsub = this.agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          resultText += event.assistantMessageEvent.delta;
        }
      });

      try {
        await this.agent.prompt(message);
      } finally {
        unsub();
      }

      return { text: resultText };
    } catch (err) {
      return { text: "", error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Build system prompt with agent identity, skills, module sections, and tool hints
   */
  private buildSystemPrompt(): string {
    let prompt = "";

    if (this.identity) {
      prompt += `You are ${this.identity.name}.\n\n`;
      prompt += `Purpose: ${this.identity.purpose}\n\n`;

      if (this.identity.capabilities.length > 0) {
        prompt += `Capabilities:\n`;
        for (const cap of this.identity.capabilities) {
          prompt += `- ${cap}\n`;
        }
        prompt += "\n";
      }

      if (this.identity.constraints.length > 0) {
        prompt += `Constraints:\n`;
        for (const constraint of this.identity.constraints) {
          prompt += `- ${constraint}\n`;
        }
        prompt += "\n";
      }

      if (this.identity.personality) {
        prompt += `Personality: ${this.identity.personality}\n\n`;
      }
    }

    // Skills
    const skillsXml = this.skillLoader.formatSkillsForPrompt();
    if (skillsXml) {
      prompt += skillsXml;
      prompt += "\n\n";
    }

    // Module prompt sections
    for (const mod of this.modules) {
      try {
        const section = mod.systemPrompt();
        if (section) {
          prompt += section + "\n\n";
        }
      } catch (err) {
        console.error(`Module ${mod.describe().name} systemPrompt() failed:`, err);
      }
    }

    // Tool hints
    prompt += `## Tools\n\n`;
    prompt += `You have access to the following tools:\n`;
    prompt += `- **bash**: Run shell commands. Use for fetching data (curl), running scripts, installing packages, etc.\n`;
    prompt += `- **read_file**: Read file contents. Supports offset/limit for large files.\n`;
    prompt += `- **write_file**: Write content to a file. Creates parent directories automatically.\n\n`;
    prompt += `Use tools to accomplish tasks. You can call multiple tools in sequence.\n`;

    return prompt;
  }

  private async expandSkillCommand(text: string): Promise<string> {
    if (!text.startsWith("/skill:")) return text;

    const spaceIndex = text.indexOf(" ");
    const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

    if (!skillName) return text;

    const metadata = this.skillLoader.getSkillMetadata(skillName);
    if (!metadata) return text;

    const body = await this.skillLoader.loadSkillBody(skillName);
    if (!body) return text;

    const skillBlock =
      `<skill name="${metadata.name}" location="${metadata.filePath}">\n` +
      `References are relative to ${metadata.baseDir}.\n\n` +
      `${body}\n` +
      "</skill>";

    return args ? `${skillBlock}\n\n${args}` : skillBlock;
  }

  private buildHistoryMessages(
    history: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }> | undefined,
    model: Model<any>,
  ): Message[] {
    if (!history || history.length === 0) return [];

    const messages: Message[] = [];
    for (const entry of history) {
      if (!entry.content || !entry.content.trim()) continue;
      const timestamp = entry.timestamp ? Date.parse(entry.timestamp) : Date.now();
      if (entry.role === "user") {
        messages.push({
          role: "user",
          content: entry.content,
          timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
        });
      } else {
        const content: TextContent[] = [{ type: "text", text: entry.content }];
        const assistantMessage: AssistantMessage = {
          role: "assistant",
          content,
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
        };
        messages.push(assistantMessage);
      }
    }

    return messages;
  }

  private async loadState(): Promise<void> {
    const statePath = `${this.stateDir}/agent-state.json`;
    const stateFile = Bun.file(statePath);

    if (await stateFile.exists()) {
      const content = await stateFile.text();
      this.state = JSON.parse(content);
      console.log("Loaded persisted state");
    }
  }

  private async saveState(): Promise<void> {
    const statePath = `${this.stateDir}/agent-state.json`;
    await Bun.write(statePath, JSON.stringify(this.state, null, 2));
  }

  private async log(message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const date = timestamp.split("T")[0];
    const logPath = `${this.logsDir}/${date}.log`;

    const logEntry = `[${timestamp}] ${message}\n`;
    const file = Bun.file(logPath);
    const writer = file.writer();
    writer.write(logEntry);
    await writer.end();
  }

  getIdentity(): AgentIdentity | undefined {
    return this.identity;
  }

  getState(): AgentState {
    return this.state;
  }

  getAgentPath(): string {
    return this.agentDir;
  }

  getSkillLoader() {
    return this.skillLoader;
  }

  getLastModelInfo(): { id: string; provider: string; contextWindow: number } | undefined {
    return this.lastModelInfo;
  }

  /**
   * Stop the runtime — aborts agent, stops all modules in reverse order
   */
  stop(): void {
    this.agent?.abort();

    for (let i = this.modules.length - 1; i >= 0; i--) {
      const mod = this.modules[i];
      try {
        mod.stop();
      } catch (err) {
        console.error(`Module ${mod.describe().name} failed to stop:`, err);
      }
    }

    console.log("\n=== Agent Stopped ===");
  }
}
