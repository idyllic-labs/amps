import type { AgentIdentity, HeartbeatConfig, AgentState } from "../types/index.ts";
import { parseMarkdown, parseAgentIdentity, parseHeartbeat } from "./markdown-parser.ts";
import { SkillLoader } from "./skill-loader.ts";
import { HeartbeatManager } from "./heartbeat.ts";
import {
  getModel,
  stream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Message,
  type Model,
  type TextContent,
} from "@mariozechner/pi-ai";
import { logger } from "../shared/logger.ts";

/**
 * Main mdx-ai/agent runtime
 * Orchestrates markdown-based agent configuration with pi-mono agent loop
 */
export class AgentRuntime {
  private agentDir: string;
  private identity?: AgentIdentity;
  private heartbeat?: HeartbeatManager;
  private skillLoader: SkillLoader;
  private state: AgentState = { context: {} };

  private agentMdPath: string;
  private heartbeatMdPath: string;
  private skillsDir: string;
  private stateDir: string;
  private memoryDir: string;
  private logsDir: string;
  private lastModelInfo?: { id: string; provider: string; contextWindow: number };

  constructor(agentDir: string) {
    this.agentDir = agentDir;
    this.agentMdPath = `${agentDir}/agent.md`;
    this.heartbeatMdPath = `${agentDir}/heartbeat.md`;
    this.skillsDir = `${agentDir}/skills`;
    this.stateDir = `${agentDir}/state`;
    this.memoryDir = `${agentDir}/memory`;
    this.logsDir = `${agentDir}/logs`;

    this.skillLoader = new SkillLoader(this.skillsDir);
  }

  /**
   * Initialize the runtime - load all markdown configs
   */
  async initialize(): Promise<void> {
    console.log("Initializing mdx-ai agent runtime...\n");

    // Load agent identity
    await this.loadAgentIdentity();

    // Load heartbeat configuration
    await this.loadHeartbeatConfig();

    // Index available skills
    await this.skillLoader.indexSkills();

    // Load persisted state if exists
    await this.loadState();

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
   * Load heartbeat.md and setup scheduler
   */
  private async loadHeartbeatConfig(): Promise<void> {
    const content = await Bun.file(this.heartbeatMdPath).text();
    const markdown = parseMarkdown(content);
    const config = parseHeartbeat(markdown);

    this.heartbeat = new HeartbeatManager(config);

    console.log(`Heartbeat: ${config.schedule}`);
    console.log(`Wake steps: ${config.onWake.length}`);
    console.log(`Routine tasks: ${config.routineTasks.length}`);
  }

  /**
   * Start the agent with heartbeat
   */
  async start(): Promise<void> {
    if (!this.heartbeat) {
      throw new Error("Heartbeat not configured");
    }

    console.log("\n=== Starting Agent ===\n");

    // Start heartbeat scheduler
    this.heartbeat.start(async () => {
      await this.onWake();
    });
  }

  /**
   * Execute on wake-up
   */
  private async onWake(): Promise<void> {
    this.state.lastWake = new Date();

    // Log wake event
    await this.log(`Wake event at ${this.state.lastWake.toISOString()}`);

    // Execute wake steps
    const steps = this.heartbeat?.getWakeSteps() || [];
    for (const step of steps) {
      console.log(`  - ${step}`);
      await this.executeWakeStep(step);
    }

    // Check for routine tasks
    const routineTasks = this.heartbeat?.checkRoutineTasks() || [];
    if (routineTasks.length > 0) {
      console.log("\nRoutine tasks:");
      for (const task of routineTasks) {
        console.log(`  - ${task}`);
        await this.log(`Routine task: ${task}`);
      }
    }

    // Save state
    await this.saveState();
  }

  /**
   * Execute a wake step
   */
  private async executeWakeStep(step: string): Promise<void> {
    // Check for current task
    if (step.toLowerCase().includes("current-task")) {
      const taskPath = `${this.stateDir}/current-task.md`;
      const taskFile = Bun.file(taskPath);

      if (await taskFile.exists()) {
        const task = await taskFile.text();
        console.log(`    Found task: ${task.split("\n")[0]}`);
        this.state.currentTask = task;
      } else {
        console.log("    No current task");
      }
    }

    // Check for goals
    if (step.toLowerCase().includes("goals")) {
      const goalsPath = `${this.memoryDir}/goals.md`;
      const goalsFile = Bun.file(goalsPath);

      if (await goalsFile.exists()) {
        const goals = await goalsFile.text();
        console.log(`    Found goals: ${goals.substring(0, 50)}...`);
      } else {
        console.log("    No goals defined");
      }
    }
  }

  /**
   * Process a user task/prompt using Azure GPT-5.2 with streaming
   * Returns an async generator that yields stream events
   */
  async *processTaskStream(
    taskDescription: string,
    history?: Array<{ role: "user" | "assistant"; content: string; timestamp?: string }>
  ): AsyncGenerator<AssistantMessageEvent> {
    // Build system prompt with identity and skills
    const systemPrompt = this.buildSystemPrompt();
    const expandedTask = await this.expandSkillCommand(taskDescription);

    try {
      // Get Azure OpenAI model (gpt-5.2)
      const model = getModel("azure-openai-responses", "gpt-5.2");
      this.lastModelInfo = {
        id: model.id,
        provider: model.provider,
        contextWindow: model.contextWindow,
      };

      // Build context
      const priorMessages = this.buildHistoryMessages(history, model);
      const context: Context = {
        messages: [
          ...priorMessages,
          {
            role: "user",
            content: expandedTask,
            timestamp: Date.now(),
          },
        ],
        systemPrompt,
      };

      // Stream the response
      const s = stream(model, context);

      // Yield each event to the caller
      for await (const event of s) {
        yield event;
      }

      // Get final response for logging
      const response = await s.result();
      let result = "";
      for (const block of response.content) {
        if (block.type === "text") {
          result += block.text;
        }
      }

      // Log the interaction
      await this.log(`Task: ${expandedTask}`);
      await this.log(`Response: ${result.substring(0, 200)}...`);

      // Update state
      this.state.currentTask = expandedTask;
      await this.saveState();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Build system prompt with agent identity and available skills
   */
  private buildSystemPrompt(): string {
    let prompt = "";

    // Add agent identity
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

    // Add available skills in XML format
    const skillsXml = this.skillLoader.formatSkillsForPrompt();
    if (skillsXml) {
      prompt += skillsXml;
      prompt += "\n\n";
    }

    return prompt;
  }

  /**
   * Build context for agent from markdown files
   */
  private buildContext(taskDescription: string): string {
    let context = "";

    // Add identity
    if (this.identity) {
      context += `# Agent Identity\n\n`;
      context += `Name: ${this.identity.name}\n`;
      context += `Purpose: ${this.identity.purpose}\n\n`;
      context += `## Capabilities\n`;
      for (const cap of this.identity.capabilities) {
        context += `- ${cap}\n`;
      }
      context += `\n## Constraints\n`;
      for (const constraint of this.identity.constraints) {
        context += `- ${constraint}\n`;
      }
      context += "\n";
    }

    // Add skill descriptions (Agent Skills standard)
    context += this.skillLoader.formatSkillsForPrompt();

    // Add current task
    context += `# Current Task\n\n${taskDescription}\n\n`;

    return context;
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
    model: Model<any>
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

  /**
   * Load persisted state
   */
  private async loadState(): Promise<void> {
    const statePath = `${this.stateDir}/agent-state.json`;
    const stateFile = Bun.file(statePath);

    if (await stateFile.exists()) {
      const content = await stateFile.text();
      this.state = JSON.parse(content);
      console.log("Loaded persisted state");
    }
  }

  /**
   * Save current state
   */
  private async saveState(): Promise<void> {
    const statePath = `${this.stateDir}/agent-state.json`;
    await Bun.write(statePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Log message to logs directory
   */
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

  /**
   * Get agent identity
   */
  getIdentity(): AgentIdentity | undefined {
    return this.identity;
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.state;
  }

  /**
   * Get agent directory path
   */
  getAgentPath(): string {
    return this.agentDir;
  }

  /**
   * Get skill loader
   */
  getSkillLoader() {
    return this.skillLoader;
  }

  getLastModelInfo(): { id: string; provider: string; contextWindow: number } | undefined {
    return this.lastModelInfo;
  }

  /**
   * Stop the runtime
   */
  stop(): void {
    this.heartbeat?.stop();
    console.log("\n=== Agent Stopped ===");
  }
}
