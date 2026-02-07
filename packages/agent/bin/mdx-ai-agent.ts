#!/usr/bin/env bun

import { resolve } from "path";
import { existsSync } from "fs";
import { Command } from "commander";
import { AgentRuntime } from "../src/runtime/agent-runtime.ts";
import { AgentTUI } from "../src/tui/agent-tui.ts";
import { SessionManager } from "../src/tui/session-manager.ts";

const program = new Command();

program
  .name("mdx-ai-agent")
  .description("Markdown-first agent runtime")
  .argument("<agent-path>", "Path to agent directory (must contain agent.md)")
  .option("-p, --prompt <text>", "Run non-interactively with the given prompt")
  .option("-s, --session <id>", "Session ID for history", "main")
  .action(async (agentPath: string, opts: { prompt?: string; session: string }) => {
    const fullPath = resolve(agentPath);

    if (!existsSync(fullPath)) {
      console.error(`\x1b[31mError:\x1b[0m Agent directory not found: ${fullPath}`);
      process.exit(1);
    }

    // Check for agent.md (lowercase)
    const agentMdPath = resolve(fullPath, "agent.md");
    if (!existsSync(agentMdPath)) {
      console.error(`\x1b[31mError:\x1b[0m agent.md not found in: ${fullPath}`);
      console.error(
        `\x1b[33mTip:\x1b[0m Make sure you're pointing to an agent directory with agent.md`,
      );
      process.exit(1);
    }

    const agentName = agentPath.split("/").pop() || "Agent";

    // Initialize runtime
    const runtime = new AgentRuntime(fullPath);
    await runtime.initialize();

    if (opts.prompt) {
      // Non-interactive mode
      await runNonInteractive(runtime, opts.prompt, opts.session);
    } else {
      // TUI mode
      console.log(`\x1b[36mStarting ${agentName}...\x1b[0m\n`);
      const tui = new AgentTUI(runtime, agentName, opts.session);
      await tui.start();
    }
  });

program.parse();

async function runNonInteractive(
  runtime: AgentRuntime,
  prompt: string,
  sessionId: string,
): Promise<void> {
  const sessionManager = new SessionManager(runtime.getAgentPath(), sessionId);

  // Load history
  const history = (await sessionManager.loadHistory()).filter(
    (m): m is typeof m & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant",
  );

  // Save user message
  await sessionManager.saveMessage({
    role: "user",
    content: prompt,
    timestamp: new Date().toISOString(),
  });

  let fullText = "";

  try {
    for await (const event of runtime.processTaskStream(prompt, history)) {
      switch (event.type) {
        case "message_update": {
          const inner = event.assistantMessageEvent;
          if (inner.type === "text_delta") {
            process.stdout.write(inner.delta);
            fullText += inner.delta;
          } else if (inner.type === "error") {
            process.stderr.write(
              `\x1b[31mError:\x1b[0m ${inner.error?.errorMessage || "Unknown error"}\n`,
            );
            process.exit(1);
          }
          break;
        }

        case "tool_execution_start": {
          const display = formatToolArgsCli(event.toolName, event.args);
          process.stderr.write(`\x1b[90m[tool:${event.toolName}]\x1b[0m ${display}\n`);
          break;
        }

        case "tool_execution_end": {
          if (event.isError) {
            const errText = event.result?.content?.[0]?.text ?? JSON.stringify(event.result);
            process.stderr.write(`\x1b[31m  Error: ${String(errText).slice(0, 200)}\x1b[0m\n`);
          }
          break;
        }

        case "agent_end":
          break;
      }
    }

    // Ensure trailing newline
    if (fullText && !fullText.endsWith("\n")) {
      process.stdout.write("\n");
    }

    // Save assistant response
    if (fullText.trim()) {
      await sessionManager.saveMessage({
        role: "assistant",
        content: fullText,
        timestamp: new Date().toISOString(),
      });
    }

    runtime.stop();
    process.exit(0);
  } catch (error: any) {
    process.stderr.write(`\x1b[31mError:\x1b[0m ${error.message}\n`);
    runtime.stop();
    process.exit(1);
  }
}

function formatToolArgsCli(toolName: string, args: any): string {
  if (toolName === "bash" && args?.command) {
    const cmd = args.command as string;
    return cmd.length > 120 ? cmd.slice(0, 117) + "..." : cmd;
  }
  if (toolName === "read_file" && args?.path) {
    return args.path;
  }
  if (toolName === "write_file" && args?.path) {
    return args.path;
  }
  return JSON.stringify(args).slice(0, 100);
}
