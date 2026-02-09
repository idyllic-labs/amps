import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SessionManager } from "../src/tui/session-manager.ts";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { UserMessage, AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "amps-session-"));
});

afterAll(() => {
  // Clean up any remaining temp dirs
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

function makeUserMessage(content: string): UserMessage {
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

function makeAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "azure-openai-responses",
    provider: "azure-openai-responses",
    model: "gpt-5.2",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makeToolResult(toolCallId: string, toolName: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

describe("SessionManager", () => {
  test("returns empty history for new session", async () => {
    const sm = new SessionManager(tempDir, "test");
    const history = await sm.loadHistory();
    expect(history).toEqual([]);
  });

  test("saves and loads messages", async () => {
    const sm = new SessionManager(tempDir, "test");
    const messages: AgentMessage[] = [makeUserMessage("hello"), makeAssistantMessage("hi there")];
    await sm.saveMessages(messages);

    const history = await sm.loadHistory();
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
  });

  test("preserves full message structure including tool calls", async () => {
    const sm = new SessionManager(tempDir, "test");
    const assistantWithToolCall: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "get_time", arguments: {} }],
      api: "azure-openai-responses",
      provider: "azure-openai-responses",
      model: "gpt-5.2",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.02 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    };

    const messages: AgentMessage[] = [
      makeUserMessage("what time is it"),
      assistantWithToolCall,
      makeToolResult("call-1", "get_time", "2026-02-09T07:00:00Z"),
      makeAssistantMessage("The time is 2026-02-09T07:00:00Z"),
    ];
    await sm.saveMessages(messages);

    const history = await sm.loadHistory();
    expect(history).toHaveLength(4);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
    expect(history[2].role).toBe("toolResult");
    expect(history[3].role).toBe("assistant");

    // Verify tool call is preserved
    const restored = history[1] as AssistantMessage;
    expect(restored.content).toHaveLength(1);
    expect(restored.content[0].type).toBe("toolCall");
    if (restored.content[0].type === "toolCall") {
      expect(restored.content[0].name).toBe("get_time");
      expect(restored.content[0].id).toBe("call-1");
    }

    // Verify tool result is preserved
    const toolResult = history[2] as ToolResultMessage;
    expect(toolResult.toolCallId).toBe("call-1");
    expect(toolResult.toolName).toBe("get_time");
    expect(toolResult.isError).toBe(false);
  });

  test("replaces entire history on save", async () => {
    const sm = new SessionManager(tempDir, "test");

    await sm.saveMessages([makeUserMessage("first")]);
    expect(await sm.loadHistory()).toHaveLength(1);

    await sm.saveMessages([makeUserMessage("a"), makeAssistantMessage("b")]);
    const history = await sm.loadHistory();
    expect(history).toHaveLength(2);
    // First message should be the new one, not accumulated
    expect((history[0] as UserMessage).content).toBe("a");
  });

  test("clears history", async () => {
    const sm = new SessionManager(tempDir, "test");
    await sm.saveMessages([makeUserMessage("will be cleared")]);
    await sm.clearHistory();

    const history = await sm.loadHistory();
    expect(history).toEqual([]);
  });

  test("isolates different session IDs", async () => {
    const sm1 = new SessionManager(tempDir, "session-a");
    const sm2 = new SessionManager(tempDir, "session-b");

    await sm1.saveMessages([makeUserMessage("from session a")]);
    await sm2.saveMessages([makeUserMessage("from session b")]);

    const history1 = await sm1.loadHistory();
    const history2 = await sm2.loadHistory();
    expect(history1).toHaveLength(1);
    expect((history1[0] as UserMessage).content).toBe("from session a");
    expect(history2).toHaveLength(1);
    expect((history2[0] as UserMessage).content).toBe("from session b");
  });

  test("defaults to 'main' session", async () => {
    const sm = new SessionManager(tempDir);
    await sm.saveMessages([makeUserMessage("default session")]);

    // Verify it wrote to sessions/main/
    const historyPath = join(tempDir, "sessions", "main", "history.json");
    const content = await Bun.file(historyPath).text();
    const parsed = JSON.parse(content);
    expect(parsed).toHaveLength(1);
  });

  test("persists across instances", async () => {
    const sm1 = new SessionManager(tempDir, "persist");
    await sm1.saveMessages([makeUserMessage("first")]);

    // New instance, same path and session
    const sm2 = new SessionManager(tempDir, "persist");
    const history = await sm2.loadHistory();
    expect(history).toHaveLength(1);
    expect((history[0] as UserMessage).content).toBe("first");
  });
});
