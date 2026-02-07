import type { AgentTool } from "@mariozechner/pi-agent-core";

export interface PromptResult {
  text: string;
  error?: string;
}

export interface ModuleContext {
  readonly agentDir: string;
  prompt(message: string): Promise<PromptResult>;
  log(message: string): Promise<void>;
}

export interface ModuleDescriptor {
  name: string;
  description: string;
}

export interface AgentModule {
  describe(): ModuleDescriptor;
  initialize(ctx: ModuleContext): Promise<void>;
  tools(): AgentTool<any>[];
  systemPrompt(): string;
  start(): Promise<void>;
  stop(): void;
}
