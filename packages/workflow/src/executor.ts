/**
 * imps/workflow Executor
 *
 * Executes parsed WorkflowDefinition objects with context accumulation.
 * Each <Generation> sees ALL accumulated context above it.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";
import { getModel, stream, type Context } from "@mariozechner/pi-ai";
import type {
  WorkflowDefinition,
  WorkflowContext,
  WorkflowNode,
  StreamEvent,
  GenerationNode,
  StructuredNode,
  WebSearchNode,
  WebFetchNode,
  LoopNode,
  IfNode,
  SetNode,
  LogNode,
  FlowNode,
  ProseNode,
  PromptNode,
  SelectNode,
  ConfirmNode,
  FieldDef,
  InputResolver,
  PromptInputRequest,
  SelectInputRequest,
  ConfirmInputRequest,
} from "./types";
import { parseModelString, resolveProvider } from "./types";
import { parseWorkflow } from "./parser";
import { interpolateString, evaluateCondition, resolveExpression } from "./expressions";

// ─── Constants ──────────────────────────────────────────────────────────────

const FALLBACK_MODEL = "azure/gpt-5.2";

function getDefaultModel(): string {
  if (process.env.IMPS_MODEL) return process.env.IMPS_MODEL;
  try {
    const configPath = resolve(homedir(), ".imps", "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.defaultModel) return config.defaultModel;
    }
  } catch {}
  return FALLBACK_MODEL;
}

const DEFAULT_MODEL = getDefaultModel();

// ─── WorkflowExecutor ──────────────────────────────────────────────────────

export class WorkflowExecutor {
  private context: WorkflowContext;
  private modelOverride?: string;
  private verbose: boolean;
  private emitEvent?: (event: StreamEvent) => void;
  private inputResolver?: InputResolver;

  /** Base directory for resolving relative paths (Flow src, etc.) */
  private basePath?: string;

  constructor(options: {
    inputs: Record<string, any>;
    modelOverride?: string;
    verbose?: boolean;
    onEvent?: (event: StreamEvent) => void;
    basePath?: string;
    inputResolver?: InputResolver;
  }) {
    this.context = {
      inputs: { ...options.inputs },
      outputs: {},
      contextStack: [],
    };
    this.modelOverride = options.modelOverride;
    this.verbose = options.verbose ?? false;
    this.emitEvent = options.onEvent;
    this.basePath = options.basePath;
    this.inputResolver = options.inputResolver;
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  async execute(workflow: WorkflowDefinition): Promise<Record<string, any>> {
    this.emit({ type: "start", workflow: workflow.name });

    // Apply default values for inputs that weren't provided
    for (const inputDef of workflow.inputs) {
      if (this.context.inputs[inputDef.name] === undefined && inputDef.default !== undefined) {
        this.context.inputs[inputDef.name] = inputDef.default;
      }
    }

    // Execute all top-level nodes in order
    for (const node of workflow.nodes) {
      await this.executeNode(node);
    }

    // Build final outputs
    const allOutputs = { ...this.context.inputs, ...this.context.outputs };
    let result: Record<string, any>;

    if (workflow.outputs && workflow.outputs.length > 0) {
      // Return only specified output keys
      result = {};
      for (const key of workflow.outputs) {
        if (key in allOutputs) {
          result[key] = allOutputs[key];
        }
      }
    } else {
      // Return everything
      result = allOutputs;
    }

    this.emit({ type: "complete", outputs: result });
    return result;
  }

  // ─── Node Dispatch ──────────────────────────────────────────────────────

  private async executeNode(node: WorkflowNode): Promise<void> {
    switch (node.kind) {
      case "prose":
        return this.handleProse(node);
      case "generation":
        return this.handleGeneration(node);
      case "structured":
        return this.handleStructured(node);
      case "websearch":
        return this.handleWebSearch(node);
      case "webfetch":
        return this.handleWebFetch(node);
      case "loop":
        return this.handleLoop(node);
      case "if":
        return this.handleIf(node);
      case "set":
        return this.handleSet(node);
      case "log":
        return this.handleLog(node);
      case "comment":
        return; // Skip entirely
      case "flow":
        return this.handleFlow(node);
      case "prompt":
        return this.handlePrompt(node);
      case "select":
        return this.handleSelect(node);
      case "confirm":
        return this.handleConfirm(node);
    }
  }

  private async executeNodes(nodes: WorkflowNode[]): Promise<void> {
    for (const node of nodes) {
      await this.executeNode(node);
    }
  }

  // ─── Node Handlers ──────────────────────────────────────────────────────

  /** Prose: interpolate expressions, push to context stack */
  private handleProse(node: ProseNode): void {
    const scope = this.buildScope();
    const interpolated = interpolateString(node.content, scope);
    this.context.contextStack.push(interpolated);
    this.log(`[prose] ${interpolated.slice(0, 120)}...`);
  }

  /** Generation: join context, call LLM, store output, push response */
  private async handleGeneration(node: GenerationNode): Promise<void> {
    const modelString = this.modelOverride ?? node.model ?? DEFAULT_MODEL;
    this.emit({ type: "generation:start", name: node.name, model: modelString });

    const prompt = this.context.contextStack.join("\n\n");
    this.log(`[generation:${node.name}] Sending ${prompt.length} chars to ${modelString}`);

    const fullResponse = await this.callLLM(modelString, prompt, {
      temperature: node.temperature,
      maxTokens: node.maxTokens,
      stop: node.stop,
      streamName: node.name,
    });

    this.context.outputs[node.name] = fullResponse;
    this.context.contextStack.push(fullResponse);
    this.emit({ type: "generation:end", name: node.name });
    this.emit({ type: "output", name: node.name, value: fullResponse });
  }

  /** Structured: join context + schema description, call LLM for JSON, parse */
  private async handleStructured(node: StructuredNode): Promise<void> {
    const modelString = this.modelOverride ?? node.model ?? DEFAULT_MODEL;
    this.emit({ type: "structured:start", name: node.name, model: modelString });

    const jsonSchema = buildJsonSchemaFromFields(node.fields);
    const schemaDescription = describeFieldsForPrompt(node.fields);

    const prompt =
      this.context.contextStack.join("\n\n") +
      "\n\n" +
      "Respond with ONLY valid JSON matching this schema:\n" +
      schemaDescription +
      "\n\nJSON Schema:\n```json\n" +
      JSON.stringify(jsonSchema, null, 2) +
      "\n```\n\n" +
      "Output ONLY the JSON object, no markdown fences, no explanation.";

    this.log(`[structured:${node.name}] Sending ${prompt.length} chars to ${modelString}`);

    const rawResponse = await this.callLLM(modelString, prompt, {
      streamName: node.name,
    });

    // Parse JSON from response — strip markdown fences if present
    let parsed: any;
    try {
      const cleaned = rawResponse
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: try to find JSON in the response
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = { _raw: rawResponse, _error: "Failed to parse JSON" };
        }
      } else {
        parsed = { _raw: rawResponse, _error: "No JSON found in response" };
      }
    }

    this.context.outputs[node.name] = parsed;
    this.context.contextStack.push(JSON.stringify(parsed, null, 2));
    this.emit({ type: "structured:end", name: node.name, value: parsed });
    this.emit({ type: "output", name: node.name, value: parsed });
  }

  /** WebSearch: placeholder — resolve query, store results, push to context */
  private handleWebSearch(node: WebSearchNode): void {
    const scope = this.buildScope();
    const query = resolveExpression(node.query, scope);

    this.emit({ type: "tool:start", name: node.name, tool: "WebSearch" });
    this.log(`[websearch:${node.name}] Query: ${query}`);

    // Placeholder results until real API integration
    const results = {
      query: String(query),
      results: [] as Array<{
        title: string;
        url: string;
        snippet: string;
        publishedDate?: string;
      }>,
    };

    this.context.outputs[node.name] = results;

    // Format for context
    const formatted = `[Search results for "${query}"]\n\n(No results — web search not yet integrated)`;
    this.context.contextStack.push(formatted);

    this.emit({ type: "tool:end", name: node.name, results });
    this.emit({ type: "output", name: node.name, value: results });
  }

  /** WebFetch: placeholder — resolve URL, store result, push to context */
  private handleWebFetch(node: WebFetchNode): void {
    const scope = this.buildScope();
    const url = resolveExpression(node.url, scope);

    this.emit({ type: "tool:start", name: node.name, tool: "WebFetch" });
    this.log(`[webfetch:${node.name}] URL: ${url}`);

    // Placeholder result until real fetch integration
    const result = {
      url: String(url),
      title: "",
      content: `(Content from ${url} — web fetch not yet integrated)`,
      fetchedAt: new Date().toISOString(),
    };

    this.context.outputs[node.name] = result;
    this.context.contextStack.push(`[Fetched content from ${url}]\n\n${result.content}`);

    this.emit({ type: "tool:end", name: node.name, results: result });
    this.emit({ type: "output", name: node.name, value: result });
  }

  /** Loop: iterate over array or count, isolated context per iteration */
  private async handleLoop(node: LoopNode): Promise<void> {
    const scope = this.buildScope();

    let items: any[] | undefined;
    let count: number | undefined;

    if (node.over) {
      const resolved = resolveExpression(node.over, scope);
      if (Array.isArray(resolved)) {
        items = resolved;
      } else {
        items = [];
      }
    } else if (node.count) {
      const resolved = resolveExpression(node.count, scope);
      count = typeof resolved === "number" ? resolved : Number(resolved) || 0;
    }

    const total = items ? items.length : (count ?? 0);
    this.emit({ type: "loop:start", name: node.name, total });
    this.log(`[loop:${node.name}] ${total} iterations`);

    // Snapshot pre-loop context
    const preLoopContextStack = [...this.context.contextStack];
    const iterationResults: any[] = [];

    for (let i = 0; i < total; i++) {
      this.emit({ type: "loop:iteration", name: node.name, index: i });

      const currentItem = items ? items[i] : i;

      // Create fresh context for this iteration: pre-loop context
      this.context.contextStack = [...preLoopContextStack];

      // Save current outputs and add loop variables to scope
      const outerOutputs = { ...this.context.outputs };
      const iterationOutputs: Record<string, any> = {};

      // Temporarily inject item and index into outputs for expression scope
      this.context.outputs = {
        ...outerOutputs,
        item: currentItem,
        index: i,
      };

      // Execute children
      await this.executeNodes(node.children);

      // Collect iteration outputs (only outputs created during this iteration)
      for (const [key, value] of Object.entries(this.context.outputs)) {
        if (
          key !== "item" &&
          key !== "index" &&
          !(key in outerOutputs && outerOutputs[key] === value)
        ) {
          iterationOutputs[key] = value;
        }
      }

      iterationResults.push({
        item: currentItem,
        index: i,
        ...iterationOutputs,
      });

      // Restore outer outputs
      this.context.outputs = outerOutputs;
    }

    // Restore pre-loop context and push summary
    this.context.contextStack = preLoopContextStack;

    // Store results
    this.context.outputs[node.name] = iterationResults;

    // Push summary to context
    const summary = `[Loop "${node.name}" completed: ${total} iterations]\n${JSON.stringify(iterationResults, null, 2)}`;
    this.context.contextStack.push(summary);

    this.emit({ type: "loop:end", name: node.name });
    this.emit({ type: "output", name: node.name, value: iterationResults });
  }

  /** If: evaluate condition, execute children or else-children */
  private async handleIf(node: IfNode): Promise<void> {
    const scope = this.buildScope();
    const result = evaluateCondition(node.condition.raw, scope);

    this.emit({ type: "if:eval", condition: node.condition.raw, result });
    this.log(`[if] ${node.condition.raw} → ${result}`);

    if (result) {
      await this.executeNodes(node.children);
    } else if (node.elseChildren) {
      await this.executeNodes(node.elseChildren);
    }
  }

  /** Set: resolve value expression, store in outputs */
  private handleSet(node: SetNode): void {
    const scope = this.buildScope();
    const value = resolveExpression(node.value, scope);

    this.context.outputs[node.name] = value;
    this.emit({ type: "set", name: node.name });
    this.emit({ type: "output", name: node.name, value });
    this.log(`[set:${node.name}] = ${JSON.stringify(value)?.slice(0, 120)}`);
  }

  /** Log: interpolate content, write to stderr */
  private handleLog(node: LogNode): void {
    const scope = this.buildScope();
    const message = interpolateString(node.content, scope);

    const level = node.level ?? "info";
    const prefix = level === "warn" ? "WARN" : level === "debug" ? "DEBUG" : "INFO";
    process.stderr.write(`[${prefix}] ${message}\n`);

    this.emit({ type: "log", level, message });
  }

  /** Flow: load subflow, execute with isolated context, merge outputs */
  private async handleFlow(node: FlowNode): Promise<void> {
    this.emit({ type: "flow:start", name: node.name, src: node.src });
    this.log(`[flow:${node.name}] Loading ${node.src}`);

    // Resolve the subflow path
    const base = this.basePath ?? process.cwd();
    const subflowPath = resolve(base, node.src);

    // Parse the subflow
    const subflowDef = parseWorkflow(subflowPath);

    // Resolve input expressions
    const subflowInputs: Record<string, any> = {};
    if (node.inputs) {
      const scope = this.buildScope();
      for (const [key, expr] of Object.entries(node.inputs)) {
        subflowInputs[key] = resolveExpression(expr, scope);
      }
    }

    // Execute subflow with isolated context
    const subExecutor = new WorkflowExecutor({
      inputs: subflowInputs,
      modelOverride: this.modelOverride,
      verbose: this.verbose,
      onEvent: this.emitEvent,
      basePath: dirname(subflowPath),
      inputResolver: this.inputResolver,
    });

    const subflowOutputs = await subExecutor.execute(subflowDef);

    // Store subflow outputs
    this.context.outputs[node.name] = subflowOutputs;

    // Push formatted summary to parent context
    const summary = `[Subflow "${node.name}" results]\n${JSON.stringify(subflowOutputs, null, 2)}`;
    this.context.contextStack.push(summary);

    this.emit({ type: "flow:end", name: node.name });
    this.emit({ type: "output", name: node.name, value: subflowOutputs });
  }

  /** Prompt: pause for free-text input, store result, push to context */
  private async handlePrompt(node: PromptNode): Promise<void> {
    const scope = this.buildScope();
    const message = String(resolveExpression(node.message, scope));
    const defaultValue = node.default ? String(resolveExpression(node.default, scope)) : undefined;
    const inputType = node.inputType ?? "text";

    this.emit({ type: "input:start", name: node.name, kind: "prompt", message });

    if (!this.inputResolver) {
      if (defaultValue !== undefined) {
        const value = inputType === "number" ? Number(defaultValue) : defaultValue;
        this.context.outputs[node.name] = value;
        this.context.contextStack.push(`[User input "${node.name}": ${value}]`);
        this.emit({ type: "input:end", name: node.name, value });
        this.emit({ type: "output", name: node.name, value });
        return;
      }
      throw new Error(
        `Input "${node.name}" requires a value but no inputResolver is available and no default was specified`,
      );
    }

    const request: PromptInputRequest = {
      kind: "prompt",
      name: node.name,
      message,
      default: defaultValue,
      inputType,
    };

    const rawValue = await this.inputResolver(request);
    const value = inputType === "number" ? Number(rawValue) : String(rawValue);

    this.context.outputs[node.name] = value;
    this.context.contextStack.push(`[User input "${node.name}": ${value}]`);
    this.emit({ type: "input:end", name: node.name, value });
    this.emit({ type: "output", name: node.name, value });
    this.log(`[prompt:${node.name}] = ${JSON.stringify(value)}`);
  }

  /** Select: pause for option selection, store result, push to context */
  private async handleSelect(node: SelectNode): Promise<void> {
    const scope = this.buildScope();
    const message = String(resolveExpression(node.message, scope));
    const rawOptions = resolveExpression(node.options, scope);

    // Normalize options into {value, label} shape
    let options: Array<{ value: string; label: string; description?: string }>;
    if (Array.isArray(rawOptions)) {
      options = rawOptions.map((opt: any) => {
        if (typeof opt === "string") {
          return { value: opt, label: opt };
        }
        const value = node.valueKey ? String(opt[node.valueKey]) : JSON.stringify(opt);
        const label = node.labelKey ? String(opt[node.labelKey]) : value;
        return { value, label };
      });
    } else {
      options = [];
    }

    this.emit({ type: "input:start", name: node.name, kind: "select", message });

    if (!this.inputResolver) {
      const value = options.length > 0 ? options[0].value : "";
      this.context.outputs[node.name] = value;
      this.context.contextStack.push(`[User selected "${node.name}": ${value}]`);
      this.emit({ type: "input:end", name: node.name, value });
      this.emit({ type: "output", name: node.name, value });
      return;
    }

    const request: SelectInputRequest = {
      kind: "select",
      name: node.name,
      message,
      options,
    };

    const value = await this.inputResolver(request);

    this.context.outputs[node.name] = value;
    this.context.contextStack.push(
      `[User selected "${node.name}": ${typeof value === "string" ? value : JSON.stringify(value)}]`,
    );
    this.emit({ type: "input:end", name: node.name, value });
    this.emit({ type: "output", name: node.name, value });
    this.log(`[select:${node.name}] = ${JSON.stringify(value)}`);
  }

  /** Confirm: pause for yes/no, store boolean result, push to context */
  private async handleConfirm(node: ConfirmNode): Promise<void> {
    const scope = this.buildScope();
    const message = String(resolveExpression(node.message, scope));
    const defaultValue = node.default ? Boolean(resolveExpression(node.default, scope)) : true;

    this.emit({ type: "input:start", name: node.name, kind: "confirm", message });

    if (!this.inputResolver) {
      this.context.outputs[node.name] = defaultValue;
      this.context.contextStack.push(`[User confirmed "${node.name}": ${defaultValue}]`);
      this.emit({ type: "input:end", name: node.name, value: defaultValue });
      this.emit({ type: "output", name: node.name, value: defaultValue });
      return;
    }

    const request: ConfirmInputRequest = {
      kind: "confirm",
      name: node.name,
      message,
      default: defaultValue,
    };

    const value = Boolean(await this.inputResolver(request));

    this.context.outputs[node.name] = value;
    this.context.contextStack.push(`[User confirmed "${node.name}": ${value}]`);
    this.emit({ type: "input:end", name: node.name, value });
    this.emit({ type: "output", name: node.name, value });
    this.log(`[confirm:${node.name}] = ${value}`);
  }

  // ─── LLM Call ───────────────────────────────────────────────────────────

  private async callLLM(
    modelString: string,
    prompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stop?: string[];
      streamName?: string;
    },
  ): Promise<string> {
    const { provider, model } = parseModelString(modelString);
    const piProvider = resolveProvider(provider);
    const llmModel = getModel(piProvider as any, model as any);

    const context: Context = {
      messages: [
        {
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        },
      ],
      systemPrompt: "",
    };

    const s = stream(llmModel, context);
    let fullResponse = "";

    for await (const event of s) {
      if (event.type === "text_delta") {
        fullResponse += event.delta;
        if (options?.streamName) {
          this.emit({
            type: "generation:chunk",
            name: options.streamName,
            content: event.delta,
          });
        }
      }
    }

    return fullResponse;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Build the expression evaluation scope from inputs + outputs */
  private buildScope(): Record<string, any> {
    return { ...this.context.inputs, ...this.context.outputs };
  }

  /** Emit a stream event if a listener is attached */
  private emit(event: StreamEvent): void {
    this.emitEvent?.(event);
  }

  /** Log a message in verbose mode */
  private log(message: string): void {
    if (this.verbose) {
      process.stderr.write(`[verbose] ${message}\n`);
    }
  }
}

// ─── Schema Helpers ───────────────────────────────────────────────────────

/** Convert FieldDef[] to a JSON Schema object */
function buildJsonSchemaFromFields(fields: FieldDef[]): Record<string, any> {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields) {
    if (!field.name) continue;
    properties[field.name] = fieldDefToJsonSchema(field);
    required.push(field.name);
  }

  return {
    type: "object",
    properties,
    required,
  };
}

function fieldDefToJsonSchema(field: FieldDef): Record<string, any> {
  switch (field.type) {
    case "text":
      return { type: "string", description: field.description };
    case "number":
      return { type: "number", description: field.description };
    case "boolean":
      return { type: "boolean", description: field.description };
    case "list": {
      const itemSchema =
        field.children && field.children.length > 0
          ? field.children[0].name
            ? buildJsonSchemaFromFields(field.children)
            : fieldDefToJsonSchema(field.children[0])
          : { type: "string" };
      return {
        type: "array",
        items: itemSchema,
        description: field.description,
      };
    }
    case "object": {
      if (field.children && field.children.length > 0) {
        return buildJsonSchemaFromFields(field.children);
      }
      return { type: "object", description: field.description };
    }
    default:
      return { type: "string" };
  }
}

/** Describe fields in natural language for the LLM prompt */
function describeFieldsForPrompt(fields: FieldDef[], indent = 0): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];

  for (const field of fields) {
    const name = field.name ?? "(element)";
    const desc = field.description ? ` — ${field.description}` : "";

    if (field.type === "list" && field.children) {
      lines.push(`${pad}- "${name}": array of:`);
      lines.push(describeFieldsForPrompt(field.children, indent + 1));
    } else if (field.type === "object" && field.children) {
      lines.push(`${pad}- "${name}": object with:`);
      lines.push(describeFieldsForPrompt(field.children, indent + 1));
    } else {
      lines.push(`${pad}- "${name}": ${field.type}${desc}`);
    }
  }

  return lines.join("\n");
}
