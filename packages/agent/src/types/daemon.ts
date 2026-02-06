import type { AgentIdentity, HeartbeatConfig } from "./index.ts";

/**
 * Discovered agent metadata
 */
export interface DiscoveredAgent {
  name: string;
  path: string;
  agentMdPath: string;
  heartbeatMdPath: string;
  skillsDir: string;
  identity?: AgentIdentity;
  heartbeatConfig?: HeartbeatConfig;
}
