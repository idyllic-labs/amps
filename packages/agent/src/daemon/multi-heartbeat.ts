import { AgentRuntime } from "../runtime/agent-runtime.ts";
import { HeartbeatManager } from "../runtime/heartbeat.ts";
import type { DiscoveredAgent } from "../types/daemon.ts";
import { logger } from "../shared/logger.ts";

/**
 * Manages heartbeats for multiple agents simultaneously
 */
export class MultiHeartbeatManager {
  private heartbeats: Map<string, HeartbeatManager> = new Map();
  private runtimes: Map<string, AgentRuntime> = new Map();

  /**
   * Add an agent and start its heartbeat
   */
  async addAgent(agent: DiscoveredAgent): Promise<void> {
    if (this.heartbeats.has(agent.name)) {
      logger.warn(`Agent "${agent.name}" already registered`);
      return;
    }

    try {
      // Create runtime instance for agent
      const runtime = new AgentRuntime(agent.path);
      await runtime.initialize();

      // Get heartbeat config
      const heartbeatConfig = agent.heartbeatConfig;
      if (!heartbeatConfig) {
        logger.warn(`No heartbeat config for "${agent.name}", skipping`);
        return;
      }

      // Create and start heartbeat manager
      const heartbeat = new HeartbeatManager(heartbeatConfig);

      // Start heartbeat with onWake callback
      heartbeat.start(async () => {
        await this.onAgentWake(agent.name, runtime);
      });

      // Store in maps
      this.heartbeats.set(agent.name, heartbeat);
      this.runtimes.set(agent.name, runtime);

      logger.info(`Started heartbeat for "${agent.name}" (${heartbeatConfig.schedule})`);
    } catch (error) {
      logger.error(`Failed to add agent "${agent.name}":`, error);
    }
  }

  /**
   * Remove an agent and stop its heartbeat
   */
  async removeAgent(agentName: string): Promise<void> {
    const heartbeat = this.heartbeats.get(agentName);
    if (heartbeat) {
      heartbeat.stop();
      this.heartbeats.delete(agentName);
    }

    const runtime = this.runtimes.get(agentName);
    if (runtime) {
      runtime.stop();
      this.runtimes.delete(agentName);
    }

    logger.info(`Removed agent "${agentName}"`);
  }

  /**
   * Stop all heartbeats
   */
  stopAll(): void {
    for (const [name, heartbeat] of this.heartbeats) {
      heartbeat.stop();
      logger.info(`Stopped heartbeat for "${name}"`);
    }

    for (const [name, runtime] of this.runtimes) {
      runtime.stop();
    }

    this.heartbeats.clear();
    this.runtimes.clear();
  }

  /**
   * Get list of active agents
   */
  getActiveAgents(): string[] {
    return Array.from(this.heartbeats.keys());
  }

  /**
   * Called when an agent's heartbeat fires
   */
  private async onAgentWake(agentName: string, runtime: AgentRuntime): Promise<void> {
    logger.info(`Agent "${agentName}" wake event`);

    try {
      // Execute wake steps (this is handled by runtime.onWake internally)
      // The runtime already has logic for executing wake steps
      // We're just triggering it here
      await runtime["onWake"]?.();
    } catch (error) {
      logger.error(`Error during "${agentName}" wake:`, error);
    }
  }
}
