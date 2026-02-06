import { readdirSync, existsSync, statSync } from "fs";
import { resolve } from "path";
import { getAgentsDir, getAgentDir } from "../shared/config.ts";
import { parseMarkdown, parseAgentIdentity, parseHeartbeat } from "../runtime/markdown-parser.ts";
import type { DiscoveredAgent } from "../types/daemon.ts";
import { logger } from "../shared/logger.ts";

/**
 * Discover all agents in the agents directory
 */
export async function discoverAgents(): Promise<DiscoveredAgent[]> {
	const agentsDir = getAgentsDir();

	// Check if agents directory exists
	if (!existsSync(agentsDir)) {
		logger.warn(`Agents directory not found: ${agentsDir}`);
		return [];
	}

	const agents: DiscoveredAgent[] = [];

	// Scan directory for agent folders
	const entries = readdirSync(agentsDir);

	for (const entry of entries) {
		const agentPath = resolve(agentsDir, entry);

		// Skip if not a directory
		if (!statSync(agentPath).isDirectory()) {
			continue;
		}

		try {
			const agent = await loadAgent(entry);
			agents.push(agent);
		} catch (error) {
			logger.error(`Failed to load agent "${entry}":`, error);
		}
	}

	return agents;
}

/**
 * Load a specific agent by name
 */
export async function loadAgent(agentName: string): Promise<DiscoveredAgent> {
	const agentPath = getAgentDir(agentName);

	if (!existsSync(agentPath)) {
		throw new Error(`Agent "${agentName}" not found at ${agentPath}`);
	}

	const agentMdPath = resolve(agentPath, "agent.md");
	const heartbeatMdPath = resolve(agentPath, "heartbeat.md");
	const skillsDir = resolve(agentPath, "skills");

	// Check required files exist
	if (!existsSync(agentMdPath)) {
		throw new Error(`agent.md not found for "${agentName}"`);
	}

	if (!existsSync(heartbeatMdPath)) {
		throw new Error(`heartbeat.md not found for "${agentName}"`);
	}

	// Parse agent identity
	let identity;
	try {
		const agentMdContent = await Bun.file(agentMdPath).text();
		const agentMd = parseMarkdown(agentMdContent);
		identity = parseAgentIdentity(agentMd);
	} catch (error) {
		logger.warn(`Failed to parse agent.md for "${agentName}":`, error);
	}

	// Parse heartbeat config
	let heartbeatConfig;
	try {
		const heartbeatMdContent = await Bun.file(heartbeatMdPath).text();
		const heartbeatMd = parseMarkdown(heartbeatMdContent);
		heartbeatConfig = parseHeartbeat(heartbeatMd);
	} catch (error) {
		logger.warn(`Failed to parse heartbeat.md for "${agentName}":`, error);
	}

	return {
		name: agentName,
		path: agentPath,
		agentMdPath,
		heartbeatMdPath,
		skillsDir,
		identity,
		heartbeatConfig,
	};
}
