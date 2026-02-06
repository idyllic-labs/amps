import { existsSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

/**
 * Get the mdx-ai home directory
 * Priority:
 * 1. MDX_AI_HOME environment variable
 * 2. ./mdx-ai-home (for local testing)
 * 3. ~/.mdx-ai (default)
 */
export function getMdxAiHome(): string {
	// Check environment variable
	if (process.env.MDX_AI_HOME) {
		return resolve(process.env.MDX_AI_HOME);
	}

	// Check for local testing directory
	const localHome = resolve(process.cwd(), "mdx-ai-home");
	if (existsSync(localHome)) {
		return localHome;
	}

	// Default to ~/.mdx-ai
	return resolve(homedir(), ".mdx-ai");
}

/**
 * Get the agents directory path
 */
export function getAgentsDir(): string {
	return resolve(getMdxAiHome(), "agents");
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
	return resolve(getMdxAiHome(), "daemon.pid");
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
