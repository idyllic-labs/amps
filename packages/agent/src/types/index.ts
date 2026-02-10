// Core types for imps/agent

// Re-export agent-core types for consumers
export type { AgentTool, AgentEvent, AgentToolResult } from "@mariozechner/pi-agent-core";

// Re-export module types
export type { AgentModule, ModuleContext, ModuleDescriptor, PromptResult } from "./module.ts";

export interface AgentIdentity {
  name: string;
  purpose: string;
  capabilities: string[];
  constraints: string[];
  personality?: string;
}

export interface HeartbeatConfig {
  schedule: string; // cron expression or @every:duration
  onWake: string[]; // steps to execute on wake
  routineTasks: RoutineTask[];
  contextReconstruction?: string[];
}

export interface RoutineTask {
  schedule: string;
  description: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
}

export interface MarkdownSection {
  heading: string;
  level: number;
  content: string;
}

export interface CodeBlock {
  language: string;
  code: string;
}

export interface ParsedMarkdown {
  frontmatter?: Record<string, string>;
  sections: MarkdownSection[];
  codeBlocks: CodeBlock[];
  rawContent: string;
}

export interface ToolContext {
  agentDir: string;
  cwd: string;
  log: (message: string) => Promise<void>;
}

export interface AgentState {
  currentTask?: string;
  lastWake?: Date;
  context: Record<string, any>;
}
