#!/usr/bin/env bun

import { resolve } from "path";
import { existsSync } from "fs";
import { AgentRuntime } from "../src/runtime/agent-runtime.ts";
import { AgentTUI } from "../src/tui/agent-tui.ts";

const args = process.argv.slice(2);
const agentPath = args[0];

async function main() {
  // Show help
  if (!agentPath || agentPath === "help" || agentPath === "--help" || agentPath === "-h") {
    printHelp();
    process.exit(agentPath ? 0 : 1);
  }

  // Resolve path
  const fullPath = resolve(agentPath);

  // Check if agent directory exists
  if (!existsSync(fullPath)) {
    console.error(`\x1b[31mError:\x1b[0m Agent directory not found: ${fullPath}`);
    process.exit(1);
  }

  // Check if AGENT.md exists
  const agentMdPath = resolve(fullPath, "AGENT.md");
  if (!existsSync(agentMdPath)) {
    console.error(`\x1b[31mError:\x1b[0m AGENT.md not found in: ${fullPath}`);
    console.error(`\x1b[33mTip:\x1b[0m Make sure you're pointing to an agent directory with AGENT.md`);
    process.exit(1);
  }

  // Extract agent name from path
  const agentName = agentPath.split("/").pop() || "Agent";

  console.log(`\x1b[36mStarting ${agentName}...\x1b[0m\n`);

  // Initialize runtime
  const runtime = new AgentRuntime(fullPath);
  await runtime.initialize();

  // Start TUI
  const tui = new AgentTUI(runtime, agentName);
  await tui.start();
}

function printHelp() {
  console.log(`
\x1b[36mmdx-ai agent\x1b[0m — Markdown-first agent runtime

\x1b[33mUsage:\x1b[0m
  mdx-ai agent <agent-path>

\x1b[33mArguments:\x1b[0m
  \x1b[36magent-path\x1b[0m           Path to agent directory (must contain AGENT.md)

\x1b[33mExamples:\x1b[0m
  mdx-ai agent ./agents/WeatherAssistant
  mdx-ai agent agents/CodeReviewer
  mdx-ai agent .                         # If current dir has AGENT.md

\x1b[33mAgent Structure:\x1b[0m
  my-agent/
    AGENT.md                        # Agent definition (required)
    skills/                         # Skills directory (optional)
      skill1.js
      skill2.js
`);
}

main().catch((error) => {
  console.error("\x1b[31mError:\x1b[0m", error.message);
  process.exit(1);
});
