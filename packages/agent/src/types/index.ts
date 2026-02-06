// Core types for mdx-ai/agent

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

export interface AgentState {
	currentTask?: string;
	lastWake?: Date;
	context: Record<string, any>;
}
