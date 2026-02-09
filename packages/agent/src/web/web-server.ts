import { resolve, dirname } from "path";
import type { ServerWebSocket } from "bun";
import type { AgentRuntime } from "../runtime/agent-runtime.ts";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { SessionManager } from "../tui/session-manager.ts";

// ── Types ──

interface WsData {
  sessionManager: SessionManager;
  activeSessionId: string;
}

interface ClientMessage {
  type: string;
  message?: string;
  images?: Array<{ data: string; mimeType: string }>;
  sessionId?: string;
}

// ── Bundled assets (populated at startup) ──

let bundledAppJs = "";
let bundledAppCss = "";
let indexHtml = "";
let stylesCss = "";
let assistantUiCss = "";

// ── Server ──

export async function startWebServer(
  runtime: AgentRuntime,
  options: { port?: number; sessionId?: string } = {},
) {
  const agentPath = runtime.getAgentPath();
  const initialSessionId = options.sessionId ?? "main";

  // Bundle client assets
  await bundleClient();

  // Find available port
  const basePort = options.port ?? 8080;
  let server: ReturnType<typeof Bun.serve> | null = null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const port = basePort + attempt;
    try {
      server = createServer(runtime, agentPath, initialSessionId, port);
      break;
    } catch (err: any) {
      if (err?.code === "EADDRINUSE" || err?.message?.includes("address already in use")) {
        continue;
      }
      throw err;
    }
  }

  if (!server) {
    throw new Error(`Could not find available port (tried ${basePort}-${basePort + 9})`);
  }

  const url = `http://localhost:${server.port}`;
  console.log(`\namps web → ${url}\n`);

  // Auto-open browser on macOS
  if (process.platform === "darwin") {
    Bun.spawn(["open", url]);
  }

  // Keep alive
  await new Promise(() => {});
  return server;
}

async function bundleClient(): Promise<void> {
  const clientDir = resolve(dirname(new URL(import.meta.url).pathname), "client");

  // Bundle React app with Bun.build
  const result = await Bun.build({
    entrypoints: [resolve(clientDir, "app.tsx")],
    target: "browser",
    minify: true,
  });

  if (!result.success) {
    const errors = result.logs.map((l) => l.message).join("\n");
    throw new Error(`Client bundle failed:\n${errors}`);
  }

  // Bun.build may produce CSS alongside JS when components import CSS
  for (const output of result.outputs) {
    if (output.path.endsWith(".css")) {
      bundledAppCss = await output.text();
    } else {
      bundledAppJs = await output.text();
    }
  }

  // Load static files
  indexHtml = await Bun.file(resolve(clientDir, "index.html")).text();
  stylesCss = await Bun.file(resolve(clientDir, "styles.css")).text();

  // Load assistant-ui pre-compiled CSS
  const auiPkgPath = dirname(require.resolve("@assistant-ui/react-ui/package.json"));
  const auiStylesDir = resolve(auiPkgPath, "dist/styles");
  const auiBase = await Bun.file(resolve(auiStylesDir, "index.css")).text();
  const auiMarkdown = await Bun.file(resolve(auiStylesDir, "markdown.css")).text();
  const auiTheme = await Bun.file(resolve(auiStylesDir, "themes/default.css")).text();
  assistantUiCss = `${auiTheme}\n${auiBase}\n${auiMarkdown}`;
}

function createServer(
  runtime: AgentRuntime,
  agentPath: string,
  initialSessionId: string,
  port: number,
) {
  return Bun.serve<WsData>({
    port,
    fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, {
          data: {
            sessionManager: new SessionManager(agentPath, initialSessionId),
            activeSessionId: initialSessionId,
          } satisfies WsData,
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Static routes
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(indexHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/app.js") {
        return new Response(bundledAppJs, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }

      if (url.pathname === "/styles.css") {
        return new Response(stylesCss, {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        });
      }

      if (url.pathname === "/assistant-ui.css") {
        return new Response(assistantUiCss, {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        });
      }

      if (url.pathname === "/app.css") {
        return new Response(bundledAppCss, {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },

    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        // Send agent identity
        const identity = runtime.getIdentity();
        const tools = runtime["allTools"]?.map((t: any) => t.name) ?? [];
        sendJson(ws, {
          type: "identity",
          name: identity?.name ?? "Agent",
          purpose: identity?.purpose ?? "",
          tools,
        });

        // Send session list
        const sessions = SessionManager.listSessions(agentPath);
        if (!sessions.includes(ws.data.activeSessionId)) {
          sessions.push(ws.data.activeSessionId);
        }
        sendJson(ws, {
          type: "sessions",
          sessions,
          active: ws.data.activeSessionId,
        });

        // Send history for current session
        sendHistory(ws, agentPath);
      },

      async message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
        try {
          const msg: ClientMessage = JSON.parse(typeof raw === "string" ? raw : raw.toString());

          switch (msg.type) {
            case "prompt":
              if (msg.message) {
                await handlePrompt(ws, runtime, msg.message, msg.images);
              }
              break;

            case "history":
              await sendHistory(ws, agentPath);
              break;

            case "clear":
              await ws.data.sessionManager.clearHistory();
              sendJson(ws, { type: "history", messages: [] });
              break;

            case "list_sessions":
              sendSessionList(ws, agentPath);
              break;

            case "switch_session":
              if (msg.sessionId) {
                ws.data.activeSessionId = msg.sessionId;
                ws.data.sessionManager = new SessionManager(agentPath, msg.sessionId);
                sendSessionList(ws, agentPath);
                await sendHistory(ws, agentPath);
              }
              break;

            case "new_session":
              if (msg.sessionId) {
                ws.data.activeSessionId = msg.sessionId;
                ws.data.sessionManager = new SessionManager(agentPath, msg.sessionId);
                sendSessionList(ws, agentPath);
                sendJson(ws, { type: "history", messages: [] });
              }
              break;
          }
        } catch (err: any) {
          sendJson(ws, {
            type: "error",
            message: err?.message ?? "Unknown error",
          });
        }
      },

      close() {
        // Nothing to clean up
      },
    },
  });
}

// ── Handlers ──

async function handlePrompt(
  ws: ServerWebSocket<WsData>,
  runtime: AgentRuntime,
  message: string,
  images?: Array<{ data: string; mimeType: string }>,
): Promise<void> {
  const { sessionManager } = ws.data;
  const history = await sessionManager.loadHistory();

  // Convert images to ImageContent format for the runtime
  const imageContents = images?.map((img) => ({
    type: "image" as const,
    data: img.data,
    mimeType: img.mimeType,
  }));

  try {
    for await (const event of runtime.processTaskStream(message, history, imageContents)) {
      translateEvent(ws, event);
    }

    sendJson(ws, { type: "done" });

    // Persist history after completion
    await sessionManager.saveMessages(runtime.getMessages());
  } catch (err: any) {
    sendJson(ws, { type: "error", message: err?.message ?? "Stream error" });
  }
}

function translateEvent(ws: ServerWebSocket<WsData>, event: AgentEvent): void {
  switch (event.type) {
    case "message_update": {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        sendJson(ws, { type: "text_delta", delta: inner.delta });
      }
      break;
    }

    case "tool_execution_start":
      sendJson(ws, {
        type: "tool_start",
        id: event.toolCallId,
        name: event.toolName,
        args: event.args,
      });
      break;

    case "tool_execution_end": {
      const resultText = event.result?.content?.[0]?.text ?? JSON.stringify(event.result);
      sendJson(ws, {
        type: "tool_end",
        id: event.toolCallId,
        name: event.toolName,
        result: String(resultText).slice(0, 10000),
        isError: event.isError,
      });
      break;
    }
  }
}

// ── Helpers ──

function sendJson(ws: ServerWebSocket<WsData>, data: object): void {
  try {
    ws.send(JSON.stringify(data));
  } catch {
    // Client may have disconnected
  }
}

async function sendHistory(ws: ServerWebSocket<WsData>, _agentPath: string): Promise<void> {
  const { sessionManager } = ws.data;
  const rawHistory = await sessionManager.loadHistory();

  // Convert AgentMessage[] to flat chat history for the client
  const messages: Array<{
    role: "user" | "assistant";
    text: string;
    images?: Array<{ data: string; mimeType: string }>;
    tools?: any[];
  }> = [];

  for (const msg of rawHistory) {
    if (typeof msg !== "object" || !("role" in msg)) continue;

    if (msg.role === "user") {
      // Extract text and images from user message
      const content = (msg as any).content;
      let text = "";
      const images: Array<{ data: string; mimeType: string }> = [];
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === "text") {
            text += c.text;
          } else if (c.type === "image" && c.data) {
            images.push({ data: c.data, mimeType: c.mimeType ?? "image/png" });
          }
        }
      }
      if (text || images.length > 0) {
        messages.push({
          role: "user",
          text,
          images: images.length > 0 ? images : undefined,
        });
      }
    } else if (msg.role === "assistant") {
      const content = (msg as any).content;
      let text = "";
      const tools: any[] = [];

      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "text") {
            text += part.text;
          } else if (part.type === "toolCall") {
            tools.push({
              id: part.id ?? part.toolCallId ?? `tool-${tools.length}`,
              name: part.name ?? part.toolName ?? "tool",
              args: part.arguments ?? part.args ?? {},
            });
          }
        }
      }

      // Find matching tool results
      for (const tool of tools) {
        const result = rawHistory.find(
          (r: any) => r.role === "toolResult" && r.toolCallId && r.toolName === tool.name,
        );
        if (result) {
          const resultContent = (result as any).content;
          if (Array.isArray(resultContent)) {
            tool.result = resultContent
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
              .slice(0, 10000);
          }
          tool.isError = (result as any).isError ?? false;
        }
      }

      if (text || tools.length > 0) {
        messages.push({
          role: "assistant",
          text,
          tools: tools.length > 0 ? tools : undefined,
        });
      }
    }
  }

  sendJson(ws, { type: "history", messages });
}

function sendSessionList(ws: ServerWebSocket<WsData>, agentPath: string): void {
  const sessions = SessionManager.listSessions(agentPath);
  if (!sessions.includes(ws.data.activeSessionId)) {
    sessions.push(ws.data.activeSessionId);
  }
  sendJson(ws, {
    type: "sessions",
    sessions,
    active: ws.data.activeSessionId,
  });
}
