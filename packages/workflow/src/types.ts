/**
 * amps/workflow type definitions
 * All shared types for the workflow parser, executor, and CLI
 */

// ─── Expression ─────────────────────────────────────────────────────────────

/** Represents a value that is either a static literal or a dynamic JS expression */
export interface Expression {
  raw: string;
  isStatic: boolean;
}

// ─── Input Definitions ──────────────────────────────────────────────────────

export type InputType = "text" | "number" | "boolean" | "list" | "object";

export interface InputDef {
  name: string;
  type: InputType;
  required: boolean;
  default?: any;
  description?: string;
  /** For list<T> — the element type */
  elementType?: InputType;
  /** For object type — nested fields */
  children?: Record<string, InputDef>;
}

// ─── Field Definitions (for Structured) ─────────────────────────────────────

export interface FieldDef {
  name?: string;
  type: "text" | "number" | "boolean" | "list" | "object";
  description?: string;
  children?: FieldDef[];
}

// ─── Workflow Nodes ─────────────────────────────────────────────────────────

export interface ProseNode {
  kind: "prose";
  content: string;
}

export interface GenerationNode {
  kind: "generation";
  name: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

export interface StructuredNode {
  kind: "structured";
  name: string;
  model?: string;
  fields: FieldDef[];
}

export interface WebSearchNode {
  kind: "websearch";
  name: string;
  query: Expression;
  maxResults?: number;
  provider?: "exa" | "serp";
}

export interface WebFetchNode {
  kind: "webfetch";
  name: string;
  url: Expression;
  maxTokens?: number;
  selector?: string;
}

export interface LoopNode {
  kind: "loop";
  name: string;
  over?: Expression;
  count?: Expression;
  children: WorkflowNode[];
}

export interface IfNode {
  kind: "if";
  condition: Expression;
  children: WorkflowNode[];
  elseChildren?: WorkflowNode[];
}

export interface SetNode {
  kind: "set";
  name: string;
  value: Expression;
}

export interface LogNode {
  kind: "log";
  level?: "info" | "debug" | "warn";
  content: string;
}

export interface CommentNode {
  kind: "comment";
}

export interface FlowNode {
  kind: "flow";
  name: string;
  src: string;
  inputs?: Record<string, Expression>;
}

export interface PromptNode {
  kind: "prompt";
  name: string;
  message: Expression;
  default?: Expression;
  inputType?: "text" | "number";
}

export interface SelectNode {
  kind: "select";
  name: string;
  message: Expression;
  options: Expression;
  labelKey?: string;
  valueKey?: string;
}

export interface ConfirmNode {
  kind: "confirm";
  name: string;
  message: Expression;
  default?: Expression;
}

export type WorkflowNode =
  | ProseNode
  | GenerationNode
  | StructuredNode
  | WebSearchNode
  | WebFetchNode
  | LoopNode
  | IfNode
  | SetNode
  | LogNode
  | CommentNode
  | FlowNode
  | PromptNode
  | SelectNode
  | ConfirmNode;

// ─── Workflow Definition ────────────────────────────────────────────────────

export interface WorkflowDefinition {
  name: string;
  description?: string;
  inputs: InputDef[];
  outputs?: string[];
  nodes: WorkflowNode[];
}

// ─── Execution Context ──────────────────────────────────────────────────────

export interface WorkflowContext {
  /** User-provided inputs */
  inputs: Record<string, any>;
  /** Named outputs from components */
  outputs: Record<string, any>;
  /** Accumulated context strings for LLM calls */
  contextStack: string[];
}

// ─── Stream Events ──────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "start"; workflow: string }
  | { type: "generation:start"; name: string; model: string }
  | { type: "generation:chunk"; name: string; content: string }
  | { type: "generation:end"; name: string }
  | { type: "structured:start"; name: string; model: string }
  | { type: "structured:end"; name: string; value: any }
  | { type: "tool:start"; name: string; tool: string }
  | { type: "tool:end"; name: string; results: any }
  | { type: "loop:start"; name: string; total: number }
  | { type: "loop:iteration"; name: string; index: number }
  | { type: "loop:end"; name: string }
  | { type: "flow:start"; name: string; src: string }
  | { type: "flow:end"; name: string }
  | { type: "if:eval"; condition: string; result: boolean }
  | { type: "set"; name: string }
  | { type: "log"; level: string; message: string }
  | { type: "output"; name: string; value: any }
  | { type: "input:start"; name: string; kind: "prompt" | "select" | "confirm"; message: string }
  | { type: "input:end"; name: string; value: any }
  | { type: "error"; message: string; node?: string }
  | { type: "complete"; outputs: Record<string, any> };

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationError {
  message: string;
  line?: number;
  column?: number;
}

// ─── Model Config ───────────────────────────────────────────────────────────

export interface ModelConfig {
  provider: string;
  model: string;
}

/** Parse a "provider/model" string into provider and model parts */
export function parseModelString(str: string): ModelConfig {
  const slash = str.indexOf("/");
  if (slash === -1) {
    return { provider: "azure", model: str };
  }
  return {
    provider: str.slice(0, slash),
    model: str.slice(slash + 1),
  };
}

// ─── Input Request / Resolver ────────────────────────────────────────────────

export interface PromptInputRequest {
  kind: "prompt";
  name: string;
  message: string;
  default?: string;
  inputType: "text" | "number";
}

export interface SelectInputRequest {
  kind: "select";
  name: string;
  message: string;
  options: Array<{ value: string; label: string; description?: string }>;
}

export interface ConfirmInputRequest {
  kind: "confirm";
  name: string;
  message: string;
  default: boolean;
}

export type InputRequest = PromptInputRequest | SelectInputRequest | ConfirmInputRequest;

export type InputResolver = (request: InputRequest) => Promise<any>;

/** Map provider shorthand to pi-ai provider name */
export function resolveProvider(provider: string): string {
  const map: Record<string, string> = {
    azure: "azure-openai-responses",
    openai: "openai-responses",
    anthropic: "anthropic",
    google: "google",
  };
  return map[provider] || provider;
}
