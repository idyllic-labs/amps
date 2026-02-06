import { existsSync } from "fs";
import { resolve } from "path";
import { ensureDir } from "../shared/config.ts";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

/**
 * Manages chat session storage
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
   * Load chat history from session
   */
  async loadHistory(): Promise<ChatMessage[]> {
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
   * Save a message to session history
   */
  async saveMessage(message: ChatMessage): Promise<void> {
    const history = await this.loadHistory();
    history.push(message);

    await ensureDir(this.sessionPath);
    await Bun.write(this.historyPath, JSON.stringify(history, null, 2));
  }

  /**
   * Clear session history
   */
  async clearHistory(): Promise<void> {
    await ensureDir(this.sessionPath);
    await Bun.write(this.historyPath, JSON.stringify([], null, 2));
  }
}
