import { discoverAgents } from "./agent-discovery.ts";
import { MultiHeartbeatManager } from "./multi-heartbeat.ts";
import { logger } from "../shared/logger.ts";
import { getMdxAiHome } from "../shared/config.ts";

/**
 * Main daemon process - orchestrates all agents' heartbeats
 */
export class Daemon {
	private heartbeatManager: MultiHeartbeatManager;
	private running: boolean = false;

	constructor() {
		this.heartbeatManager = new MultiHeartbeatManager();
	}

	/**
	 * Start the daemon
	 */
	async start(): Promise<void> {
		logger.info("mdx-ai agent daemon starting...");
		logger.info(`Home directory: ${getMdxAiHome()}`);

		// Discover all agents
		const agents = await discoverAgents();
		logger.info(`Found ${agents.length} agent(s)`);

		if (agents.length === 0) {
			logger.warn("No agents found. Create one with 'mdx-ai agent new'");
			logger.info("Daemon will stay running and check for agents periodically...");
		}

		// Start heartbeats for each agent
		for (const agent of agents) {
			await this.heartbeatManager.addAgent(agent);
		}

		// Set up graceful shutdown handlers
		process.on("SIGTERM", () => this.shutdown());
		process.on("SIGINT", () => this.shutdown());

		this.running = true;
		logger.info("Daemon started successfully");

		// Keep alive
		while (this.running) {
			await Bun.sleep(1000);
		}
	}

	/**
	 * Shutdown the daemon gracefully
	 */
	private shutdown(): void {
		if (!this.running) return;

		logger.info("Shutting down daemon...");
		this.running = false;

		// Stop all heartbeats
		this.heartbeatManager.stopAll();

		logger.info("Daemon stopped");
		process.exit(0);
	}
}

/**
 * Entry point when daemon is run directly
 */
if (import.meta.main) {
	const daemon = new Daemon();
	daemon.start().catch((error) => {
		logger.error("Daemon crashed:", error);
		process.exit(1);
	});
}
