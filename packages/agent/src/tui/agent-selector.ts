import type { DiscoveredAgent } from "../types/daemon.ts";
import * as readline from "readline";

/**
 * Simple agent selector (console-based for now)
 * TODO: Enhance with pi-tui SelectList component
 */
export async function showAgentSelector(
  agents: DiscoveredAgent[]
): Promise<DiscoveredAgent> {
  console.log("\n\x1b[36mSelect an agent:\x1b[0m\n");

  // Display agents with numbers
  agents.forEach((agent, index) => {
    console.log(`  ${index + 1}. \x1b[36m${agent.name}\x1b[0m`);
    if (agent.identity?.purpose) {
      console.log(`     \x1b[90m${agent.identity.purpose}\x1b[0m`);
    }
  });

  console.log();

  // Prompt for selection
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question("Enter number (or Ctrl+C to cancel): ", (answer) => {
      rl.close();

      const selection = parseInt(answer.trim(), 10);
      if (isNaN(selection) || selection < 1 || selection > agents.length) {
        reject(new Error("Invalid selection"));
        return;
      }

      resolve(agents[selection - 1]);
    });
  });
}
