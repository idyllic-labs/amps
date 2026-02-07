#!/usr/bin/env bun

/**
 * mdx-ai workflow CLI
 * Execute markdown workflows as agent programs
 */

import { parseWorkflow, validateWorkflow } from "../src/parser";
import { WorkflowExecutor } from "../src/executor";
import type { StreamEvent, WorkflowDefinition, InputDef, InputResolver } from "../src/types";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

// ─── Help Text ──────────────────────────────────────────────────────────────

const HELP = `\x1b[36mmdx-ai workflow\x1b[0m — Execute markdown workflows as agent programs

\x1b[33mUsage:\x1b[0m
  mdx-ai workflow run <file.mdx> [options]    Execute a workflow
  mdx-ai workflow check <file.mdx>            Validate a workflow

\x1b[33mOptions:\x1b[0m
  --input key=value    Pass an input value (repeatable)
  --inputs <file>      Load inputs from JSON file
  --output <format>    Output format: pretty, json, yaml (default: pretty)
  --stream             Stream NDJSON events to stdout
  --model <model>      Override model (e.g., azure/gpt-5.2)
  --interactive        Interactive TUI mode (auto-detected in TTY)
  --no-interactive     Disable interactive mode
  --verbose            Show execution context at each step
  --retry <n>          Retry failed operations n times
  --retry-delay <ms>   Base retry delay in milliseconds
  --help               Show this help

\x1b[33mEnvironment:\x1b[0m
  AZURE_OPENAI_API_KEY        Azure OpenAI API key
  AZURE_OPENAI_RESOURCE_NAME  Azure resource name
  MDX_AI_DEFAULT_MODEL         Default model (default: azure/gpt-5.2)
`;

// ─── Arg Parsing ────────────────────────────────────────────────────────────

interface CLIArgs {
  command: "run" | "check" | "help";
  file?: string;
  inputs: Record<string, any>;
  inputsFile?: string;
  outputFormat: "pretty" | "json" | "yaml";
  stream: boolean;
  interactive?: boolean;
  model?: string;
  verbose: boolean;
  retry: number;
  retryDelay: number;
}

function parseInputValue(value: string): any {
  try {
    return JSON.parse(value);
  } catch {}
  return value;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    command: "help",
    inputs: {},
    outputFormat: "pretty",
    stream: false,
    verbose: false,
    retry: 0,
    retryDelay: 1000,
  };

  const raw = argv.slice(2);
  let positionalIdx = 0;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];

    if (arg === "--help" || arg === "-h") {
      args.command = "help";
      return args;
    }

    if (arg === "--input") {
      const next = raw[++i];
      if (!next) {
        error("--input requires a key=value argument", 1);
      }
      const eqIdx = next.indexOf("=");
      if (eqIdx === -1) {
        error(`--input value must be key=value, got: ${next}`, 1);
      }
      const key = next.slice(0, eqIdx);
      let val = next.slice(eqIdx + 1);
      // Consume subsequent non-flag args as part of the value (handles unquoted spaces)
      while (i + 1 < raw.length && !raw[i + 1].startsWith("--")) {
        val += " " + raw[++i];
      }
      args.inputs[key] = parseInputValue(val);
      continue;
    }

    if (arg === "--inputs") {
      args.inputsFile = raw[++i];
      if (!args.inputsFile) {
        error("--inputs requires a file path", 1);
      }
      continue;
    }

    if (arg === "--output") {
      const fmt = raw[++i];
      if (fmt !== "pretty" && fmt !== "json" && fmt !== "yaml") {
        error(`--output must be pretty, json, or yaml, got: ${fmt}`, 1);
      }
      args.outputFormat = fmt;
      continue;
    }

    if (arg === "--stream") {
      args.stream = true;
      continue;
    }

    if (arg === "--interactive") {
      args.interactive = true;
      continue;
    }

    if (arg === "--no-interactive") {
      args.interactive = false;
      continue;
    }

    if (arg === "--model") {
      args.model = raw[++i];
      if (!args.model) {
        error("--model requires a value", 1);
      }
      continue;
    }

    if (arg === "--verbose") {
      args.verbose = true;
      continue;
    }

    if (arg === "--retry") {
      const val = raw[++i];
      args.retry = parseInt(val, 10);
      if (isNaN(args.retry)) {
        error(`--retry requires a number, got: ${val}`, 1);
      }
      continue;
    }

    if (arg === "--retry-delay") {
      const val = raw[++i];
      args.retryDelay = parseInt(val, 10);
      if (isNaN(args.retryDelay)) {
        error(`--retry-delay requires a number, got: ${val}`, 1);
      }
      continue;
    }

    if (arg.startsWith("-")) {
      error(`Unknown flag: ${arg}`, 1);
    }

    // Positional arguments
    if (positionalIdx === 0) {
      if (arg === "run" || arg === "check") {
        args.command = arg;
      } else {
        error(`Unknown command: ${arg}. Use 'run' or 'check'.`, 1);
      }
      positionalIdx++;
    } else if (positionalIdx === 1) {
      args.file = arg;
      positionalIdx++;
    } else {
      error(`Unexpected argument: ${arg}`, 1);
    }
  }

  return args;
}

// ─── Error Helpers ──────────────────────────────────────────────────────────

function error(msg: string, code: number): never {
  process.stderr.write(`\x1b[31mError:\x1b[0m ${msg}\n`);
  process.exit(code);
}

// ─── Input Resolution ───────────────────────────────────────────────────────

function resolveInputs(args: CLIArgs, inputDefs: InputDef[]): Record<string, any> {
  let inputs: Record<string, any> = {};

  // Load from JSON file first
  if (args.inputsFile) {
    const inputsPath = resolve(args.inputsFile);
    if (!existsSync(inputsPath)) {
      error(`Inputs file not found: ${args.inputsFile}`, 1);
    }
    try {
      const raw = readFileSync(inputsPath, "utf-8");
      inputs = JSON.parse(raw);
    } catch (e: any) {
      error(`Failed to parse inputs file: ${e.message}`, 1);
    }
  }

  // CLI --input flags override file inputs
  Object.assign(inputs, args.inputs);

  // Apply defaults for optional inputs
  for (const def of inputDefs) {
    if (inputs[def.name] === undefined) {
      if (def.default !== undefined) {
        inputs[def.name] = def.default;
      } else if (def.required) {
        error(`Missing required input: ${def.name}`, 3);
      }
    }
  }

  return inputs;
}

// ─── Output Formatting ─────────────────────────────────────────────────────

function formatPretty(outputs: Record<string, any>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(outputs)) {
    const bar = "━".repeat(Math.max(1, 40 - key.length - 5));
    lines.push(`\x1b[36m━━━ ${key} ${bar}\x1b[0m`);
    if (typeof value === "string") {
      lines.push(value);
    } else {
      lines.push(JSON.stringify(value, null, 2));
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatJson(outputs: Record<string, any>): string {
  return JSON.stringify(outputs, null, 2);
}

function formatYaml(outputs: Record<string, any>): string {
  return toYaml(outputs, 0);
}

function toYaml(value: any, indent: number): string {
  const prefix = "  ".repeat(indent);
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    if (value.includes("\n")) {
      const lines = value.split("\n");
      const indented = lines.map((l) => `${prefix}  ${l}`).join("\n");
      return `|\n${indented}`;
    }
    // Quote if contains special YAML chars
    if (
      /[:{}[\],&*?|>!'"%@`#]/.test(value) ||
      value === "" ||
      value === "true" ||
      value === "false" ||
      value === "null"
    ) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => {
      const rendered = toYaml(item, indent + 1);
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        // Object items: first key on same line as dash
        const firstNewline = rendered.indexOf("\n");
        if (firstNewline === -1) {
          return `${prefix}- ${rendered}`;
        }
        return `${prefix}- ${rendered}`;
      }
      return `${prefix}- ${rendered}`;
    });
    return "\n" + items.join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([k, v]) => {
      const rendered = toYaml(v, indent + 1);
      if (typeof v === "object" && v !== null) {
        return `${prefix}${k}:${rendered.startsWith("\n") ? rendered : " " + rendered}`;
      }
      return `${prefix}${k}: ${rendered}`;
    });
    return "\n" + lines.join("\n");
  }
  return String(value);
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function runCheck(filePath: string): Promise<void> {
  let workflow: WorkflowDefinition;
  try {
    workflow = parseWorkflow(filePath);
  } catch (e: any) {
    if (e.name === "ParseError") {
      const lineInfo = e.line ? ` at line ${e.line}` : "";
      error(`Parse error${lineInfo}: ${e.message}`, 2);
    }
    error(`Parse error: ${e.message}`, 2);
  }

  const basePath = dirname(filePath);
  const errors = validateWorkflow(workflow, basePath);

  if (errors.length > 0) {
    process.stderr.write(`\x1b[31mError: Validation failed\x1b[0m\n\n`);
    for (const err of errors) {
      const lineInfo = err.line ? ` (line ${err.line})` : "";
      process.stderr.write(`  - ${err.message}${lineInfo}\n`);
    }
    process.exit(3);
  }

  const nodeCount = countNodes(workflow.nodes);
  const inputCount = workflow.inputs.length;
  process.stdout.write(
    `\x1b[32m✓\x1b[0m Valid workflow with ${nodeCount} nodes, ${inputCount} inputs\n`,
  );
}

function countNodes(nodes: WorkflowDefinition["nodes"]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if ("children" in node && Array.isArray((node as any).children)) {
      count += countNodes((node as any).children);
    }
    if ("elseChildren" in node && Array.isArray((node as any).elseChildren)) {
      count += countNodes((node as any).elseChildren);
    }
  }
  return count;
}

async function runExecute(args: CLIArgs, filePath: string): Promise<void> {
  let workflow: WorkflowDefinition;
  try {
    workflow = parseWorkflow(filePath);
  } catch (e: any) {
    if (e.name === "ParseError") {
      const lineInfo = e.line ? ` at line ${e.line}` : "";
      error(`Parse error${lineInfo}: ${e.message}`, 2);
    }
    error(`Parse error: ${e.message}`, 2);
  }

  const basePath = dirname(filePath);
  const validationErrors = validateWorkflow(workflow, basePath);
  if (validationErrors.length > 0) {
    process.stderr.write(`\x1b[31mError: Validation failed\x1b[0m\n\n`);
    for (const err of validationErrors) {
      const lineInfo = err.line ? ` (line ${err.line})` : "";
      process.stderr.write(`  - ${err.message}${lineInfo}\n`);
    }
    process.exit(3);
  }

  const inputs = resolveInputs(args, workflow.inputs);

  // Determine interactive mode: explicit flag > auto-detect (TTY + pretty format + not streaming)
  const interactive =
    args.interactive ?? (process.stdout.isTTY && !args.stream && args.outputFormat === "pretty");

  if (interactive) {
    const { WorkflowTUI } = await import("../src/tui/workflow-tui");
    const workflowTui = new WorkflowTUI(workflow, inputs, { model: args.model });
    const inputResolver = workflowTui.createInputResolver();

    const executor = new WorkflowExecutor({
      inputs,
      modelOverride: args.model,
      verbose: args.verbose,
      onEvent: (event) => workflowTui.handleEvent(event),
      basePath,
      inputResolver,
    });

    workflowTui.start();

    try {
      await executor.execute(workflow);
    } catch (e: any) {
      workflowTui.handleEvent({ type: "error", message: e.message });
    }

    // Keep TUI alive until Ctrl+C (double-press exits via InterceptTerminal handler)
    await new Promise(() => {});
    return;
  }

  // Non-interactive path
  const onEvent: ((event: StreamEvent) => void) | undefined = args.stream
    ? (event: StreamEvent) => {
        process.stdout.write(JSON.stringify(event) + "\n");
      }
    : undefined;

  // CLI-based input resolver: reads from --input flags, falls back to defaults
  const cliInputResolver: InputResolver = async (request) => {
    if (request.name in inputs) {
      const provided = inputs[request.name];
      switch (request.kind) {
        case "prompt":
          return request.inputType === "number" ? Number(provided) : String(provided);
        case "select":
          return String(provided);
        case "confirm":
          return provided === true || provided === "true" || provided === "yes" || provided === "1";
      }
    }
    switch (request.kind) {
      case "prompt":
        if (request.default !== undefined) return request.default;
        error(
          `Interactive input "${request.name}" requires a value in non-interactive mode. Use --input ${request.name}=value`,
          1,
        );
      case "select":
        if (request.options.length > 0) return request.options[0].value;
        error(`Select "${request.name}" has no options and no --input value`, 1);
      case "confirm":
        return request.default;
    }
  };

  const executor = new WorkflowExecutor({
    inputs,
    modelOverride: args.model,
    verbose: args.verbose,
    onEvent,
    basePath,
    inputResolver: cliInputResolver,
  });

  let outputs: Record<string, any>;
  try {
    outputs = await executor.execute(workflow);
  } catch (e: any) {
    error(`Runtime error: ${e.message}`, 1);
  }

  // If streaming, the events already went to stdout — final output is the complete event
  if (args.stream) {
    return;
  }

  // Format and print outputs
  switch (args.outputFormat) {
    case "json":
      process.stdout.write(formatJson(outputs) + "\n");
      break;
    case "yaml":
      process.stdout.write(formatYaml(outputs).trimStart() + "\n");
      break;
    case "pretty":
    default:
      process.stdout.write(formatPretty(outputs));
      break;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.command === "help") {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (!args.file) {
    error("Missing file argument. Usage: mdx-ai workflow <command> <file.mdx>", 1);
  }

  const filePath = resolve(args.file);
  if (!existsSync(filePath)) {
    error(`File not found: ${args.file}`, 1);
  }

  if (args.command === "check") {
    await runCheck(filePath);
  } else if (args.command === "run") {
    await runExecute(args, filePath);
  }
}

main().catch((e) => {
  error(e.message || String(e), 1);
});
