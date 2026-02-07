import { AgentRuntime } from "../runtime/agent-runtime.ts";
import type { DiscoveredAgent } from "../types/daemon.ts";
import { logger } from "../shared/logger.ts";

/**
 * Manages multiple agent runtimes simultaneously.
 * Each runtime's modules (including heartbeat) handle their own scheduling.
 */
export class MultiHeartbeatManager {
  private runtimes: Map<string, AgentRuntime> = new Map();

  /**
   * Add an agent and start its runtime (modules handle heartbeat)
   */
  async addAgent(agent: DiscoveredAgent): Promise<void> {
    if (this.runtimes.has(agent.name)) {
      logger.warn(`Agent "${agent.name}" already registered`);
      return;
    }

    try {
      const runtime = new AgentRuntime(agent.path);
      await runtime.initialize();
      await runtime.start();

      this.runtimes.set(agent.name, runtime);
      logger.info(`Started agent "${agent.name}"`);
    } catch (error) {
      logger.error(`Failed to add agent "${agent.name}":`, error);
    }
  }

  /**
   * Remove an agent and stop its runtime
   */
  async removeAgent(agentName: string): Promise<void> {
    const runtime = this.runtimes.get(agentName);
    if (runtime) {
      runtime.stop();
      this.runtimes.delete(agentName);
    }

    logger.info(`Removed agent "${agentName}"`);
  }

  /**
   * Stop all runtimes
   */
  stopAll(): void {
    for (const [name, runtime] of this.runtimes) {
      runtime.stop();
      logger.info(`Stopped agent "${name}"`);
    }

    this.runtimes.clear();
  }

  /**
   * Get list of active agents
   */
  getActiveAgents(): string[] {
    return Array.from(this.runtimes.keys());
  }
}
