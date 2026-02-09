import { existsSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

/**
 * Get the amps home directory
 * Priority:
 * 1. AMPS_HOME environment variable
 * 2. ./amps-home (for local testing)
 * 3. ~/.amps (default)
 */
export function getAmpsHome(): string {
  // Check environment variable
  if (process.env.AMPS_HOME) {
    return resolve(process.env.AMPS_HOME);
  }

  // Check for local testing directory
  const localHome = resolve(process.cwd(), "amps-home");
  if (existsSync(localHome)) {
    return localHome;
  }

  // Default to ~/.amps
  return resolve(homedir(), ".amps");
}

/**
 * Get the agents directory path
 */
export function getAgentsDir(): string {
  return resolve(getAmpsHome(), "agents");
}

/**
 * Get a specific agent's directory path
 */
export function getAgentDir(agentName: string): string {
  return resolve(getAgentsDir(), agentName);
}

/**
 * Get the daemon PID file path
 */
export function getDaemonPidPath(): string {
  return resolve(getAmpsHome(), "daemon.pid");
}

/**
 * Get the templates directory path
 * Development: ./templates
 * Production: relative to this file's location
 */
export function getTemplatesDir(): string {
  const devTemplates = resolve(process.cwd(), "templates");
  if (existsSync(devTemplates)) {
    return devTemplates;
  }

  // Production: relative to compiled location
  // Assuming compiled to dist/, templates at root
  return resolve(__dirname, "../../templates");
}

/**
 * Ensure a directory exists, create if not
 */
export async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await Bun.$`mkdir -p ${dirPath}`;
  }
}
