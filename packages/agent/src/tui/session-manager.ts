import { existsSync, readdirSync } from "fs";
import { resolve } from "path";
import { ensureDir } from "../shared/config.ts";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

/**
 * Manages chat session storage.
 * Stores the full AgentMessage[] array (including tool calls and results)
 * so history can be replayed exactly via agent.replaceMessages().
 */
export class SessionManager {
  private agentPath: string;
  private sessionId: string;
  private sessionPath: string;
  private historyPath: string;

  constructor(agentPath: string, sessionId: string = "main") {
    this.agentPath = agentPath;
    this.sessionId = sessionId;
    this.sessionPath = resolve(agentPath, "sessions", sessionId);
    this.historyPath = resolve(this.sessionPath, "history.json");
  }

  /**
   * List all session IDs for an agent
   */
  static listSessions(agentPath: string): string[] {
    const sessionsDir = resolve(agentPath, "sessions");
    if (!existsSync(sessionsDir)) {
      return [];
    }
    try {
      const entries = readdirSync(sessionsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * Load full message history from session
   */
  async loadHistory(): Promise<AgentMessage[]> {
    if (!existsSync(this.historyPath)) {
      return [];
    }

    try {
      const content = await Bun.file(this.historyPath).text();
      return JSON.parse(content);
    } catch (error) {
      console.error("Failed to load history:", error);
      return [];
    }
  }

  /**
   * Save the full message array to session history.
   * This replaces the entire history file with the current state.
   */
  async saveMessages(messages: AgentMessage[]): Promise<void> {
    await ensureDir(this.sessionPath);
    await Bun.write(this.historyPath, JSON.stringify(messages, null, 2));
  }

  /**
   * Clear session history
   */
  async clearHistory(): Promise<void> {
    await ensureDir(this.sessionPath);
    await Bun.write(this.historyPath, JSON.stringify([], null, 2));
  }
}
