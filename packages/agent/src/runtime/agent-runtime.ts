import type { AgentIdentity, AgentState, ToolContext } from "../types/index.ts";
import type { AgentModule, ModuleContext, PromptResult } from "../types/module.ts";
import { parseAgentMdx, type ParsedToolDef } from "./mdx-parser.ts";
import { buildToolsFromDefs } from "./tool-builder.ts";
import { SkillLoader } from "./skill-loader.ts";
import { createBuiltinTools } from "./tools.ts";
import { loadModules } from "./module-loader.ts";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@mariozechner/pi-agent-core";
import { getModel, type Message } from "@mariozechner/pi-ai";

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

  private agentMdxPath: string;
  private frontmatter: Record<string, string> = {};
  private inlineToolDefs: ParsedToolDef[] = [];
  private allTools: AgentTool<any>[] = [];
  private skillsDir: string;
  private stateDir: string;
  private memoryDir: string;
  private logsDir: string;
  private lastModelInfo?: { id: string; provider: string; contextWindow: number };

  private agent?: Agent;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
    this.agentMdxPath = `${agentDir}/agent.mdx`;
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
    console.log("Initializing amps agent runtime...\n");

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

    // 7. Collect tools: built-in + inline (mdx) + module-provided
    // Parse builtins from frontmatter (e.g. "builtins: read_file, write_file, bash")
    const enabledBuiltins = this.frontmatter.builtins
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const builtinTools = createBuiltinTools(this.agentDir, enabledBuiltins);
    const moduleTools = this.modules.flatMap((m) => {
      try {
        return m.tools();
      } catch (err) {
        console.error(`Module ${m.describe().name} tools() failed:`, err);
        return [];
      }
    });

    if (builtinTools.length > 0) {
      console.log(`Builtin tools: ${builtinTools.map((t) => t.name).join(", ")}`);
    }

    // Build inline tools from .mdx <Tool> definitions
    const toolCtx: ToolContext = {
      agentDir: this.agentDir,
      cwd: this.agentDir,
      log: (message: string) => this.log(message),
    };
    const inlineTools = buildToolsFromDefs(this.inlineToolDefs, toolCtx);
    if (inlineTools.length > 0) {
      console.log(`Inline tools: ${inlineTools.map((t) => t.name).join(", ")}`);
    }

    this.allTools = [...builtinTools, ...inlineTools, ...moduleTools];

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
    this.agent.setTools(this.allTools);

    this.lastModelInfo = {
      id: model.id,
      provider: model.provider,
      contextWindow: model.contextWindow,
    };

    console.log("\nRuntime initialized successfully");
  }

  /**
   * Load agent.mdx and parse identity + inline tool definitions
   */
  private async loadAgentIdentity(): Promise<void> {
    const content = await Bun.file(this.agentMdxPath).text();
    const def = parseAgentMdx(content);
    this.identity = def.identity;
    this.inlineToolDefs = def.tools;
    this.frontmatter = def.frontmatter;

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
    history?: AgentMessage[],
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

    // Replay full message history (includes tool calls and results)
    this.agent.replaceMessages(history ?? []);

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

    // Tool hints — dynamically generated from all registered tools
    prompt += `## Tools\n\n`;
    prompt += `You have access to the following tools:\n`;
    for (const tool of this.allTools) {
      prompt += `- **${tool.name}**: ${tool.description}\n`;
    }
    prompt += `\nUse tools to accomplish tasks. You can call multiple tools in sequence.\n`;

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
    if (!existsSync(this.stateDir)) {
      await mkdir(this.stateDir, { recursive: true });
    }
    const statePath = `${this.stateDir}/agent-state.json`;
    await Bun.write(statePath, JSON.stringify(this.state, null, 2));
  }

  private async log(message: string): Promise<void> {
    if (!existsSync(this.logsDir)) {
      await mkdir(this.logsDir, { recursive: true });
    }
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
   * Get the full message history from the agent's internal state.
   * Includes user messages, assistant messages (with tool calls), and tool results.
   */
  getMessages(): AgentMessage[] {
    return this.agent?.state.messages ?? [];
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
