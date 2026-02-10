import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  type ChatModelAdapter,
  type ChatModelRunResult,
  useLocalRuntime,
  AssistantRuntimeProvider,
  SimpleImageAttachmentAdapter,
  makeAssistantToolUI,
} from "@assistant-ui/react";
import { Thread, makeMarkdownText } from "@assistant-ui/react-ui";

// ── Types ──

interface IdentityMsg {
  type: "identity";
  name: string;
  purpose: string;
  tools: string[];
}

interface SessionsMsg {
  type: "sessions";
  sessions: string[];
  active: string;
}

interface HistoryMsg {
  type: "history";
  messages: HistoryEntry[];
}

interface HistoryEntry {
  role: "user" | "assistant";
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  tools?: ToolCallEntry[];
}

interface ToolCallEntry {
  id: string;
  name: string;
  args: any;
  result?: string;
  isError?: boolean;
}

interface TextDeltaMsg {
  type: "text_delta";
  delta: string;
}
interface ToolStartMsg {
  type: "tool_start";
  id: string;
  name: string;
  args: any;
}
interface ToolEndMsg {
  type: "tool_end";
  id: string;
  name: string;
  result: string;
  isError: boolean;
}
interface DoneMsg {
  type: "done";
}
interface ErrorMsg {
  type: "error";
  message: string;
}

type StreamEvent = TextDeltaMsg | ToolStartMsg | ToolEndMsg | DoneMsg | ErrorMsg;

type ServerMessage = IdentityMsg | SessionsMsg | HistoryMsg | StreamEvent;

// ── WsEventBridge ──
// Converts push-based WS events into pull-based async iteration for the adapter.

class WsEventBridge {
  private queue: StreamEvent[] = [];
  private resolve: ((event: StreamEvent) => void) | null = null;
  private closed = false;

  push(event: StreamEvent) {
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(event);
    } else {
      this.queue.push(event);
    }
  }

  pull(): Promise<StreamEvent> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    if (this.closed) {
      return Promise.resolve({ type: "done" });
    }
    return new Promise<StreamEvent>((resolve) => {
      this.resolve = resolve;
    });
  }

  close() {
    this.closed = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ type: "done" });
    }
  }
}

// ── Markdown text renderer ──

const MarkdownText = makeMarkdownText();

// ── ToolFallback ──
// Generic tool UI for all tool calls — collapsible block with status/args/result.

const ToolFallback = makeAssistantToolUI<any, any>({
  toolName: "*",
  render: function ToolFallbackRender({ toolName, args, result, status }) {
    const [open, setOpen] = useState(false);
    const isRunning = status.type === "running";
    const isError = status.type === "incomplete" && status.reason === "error";

    let argsPreview = "";
    if (toolName === "bash" && args?.command) {
      argsPreview = args.command;
    } else if ((toolName === "read_file" || toolName === "write_file") && args?.path) {
      argsPreview = args.path;
    } else {
      argsPreview = JSON.stringify(args);
    }
    if (argsPreview && argsPreview.length > 100) {
      argsPreview = argsPreview.slice(0, 97) + "...";
    }

    const resultText = result != null ? String(result) : undefined;

    return (
      <details
        className="tool-block mb-2 border border-border rounded-lg overflow-hidden"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex items-center gap-2 px-3 py-2 bg-bg-surface hover:bg-bg-hover transition-colors text-xs">
          <span
            className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${isRunning ? "bg-yellow-500 streaming-dot" : isError ? "bg-red-500" : "bg-green-500"}`}
          />
          <span className="font-mono text-gray-400">{toolName}</span>
          <span className="text-gray-600 truncate">{argsPreview}</span>
          <span className="ml-auto text-gray-600">{open ? "\u25b4" : "\u25be"}</span>
        </summary>
        {open && (
          <div className="px-3 py-2 border-t border-border text-xs">
            <div className="mb-2">
              <span className="text-gray-500">Args: </span>
              <pre className="mt-1 bg-bg rounded p-2 overflow-x-auto text-gray-400 whitespace-pre-wrap">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
            {resultText !== undefined && (
              <div>
                <span className={isError ? "text-red-400" : "text-gray-500"}>
                  {isError ? "Error: " : "Result: "}
                </span>
                <pre className="mt-1 bg-bg rounded p-2 overflow-x-auto text-gray-400 whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {resultText}
                </pre>
              </div>
            )}
          </div>
        )}
      </details>
    );
  },
});

// ── App ──

function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const bridgeRef = useRef<WsEventBridge>(new WsEventBridge());
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<IdentityMsg | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);
  const [activeSession, setActiveSession] = useState("main");
  const [adapterKey, setAdapterKey] = useState(0);
  const pendingHistoryRef = useRef<any[] | null>(null);

  // Build the ChatModelAdapter. We recreate it (via adapterKey) when the thread
  // switches so the runtime resets its internal message state.
  const adapter: ChatModelAdapter = useMemo(
    () => ({
      async *run({ messages, abortSignal }) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new Error("WebSocket not connected");
        }

        // Extract last user message text + images and send to server
        const lastMsg = messages[messages.length - 1];
        let promptText = "";
        const images: Array<{ data: string; mimeType: string }> = [];

        const extractDataUrl = (dataUrl: string | undefined) => {
          const match = dataUrl?.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            images.push({ data: match[2], mimeType: match[1] });
          }
        };

        if (lastMsg?.role === "user") {
          for (const part of lastMsg.content) {
            if (part.type === "text") {
              promptText += part.text;
            } else if (part.type === "image") {
              extractDataUrl((part as any).image);
            }
          }
          // Also extract images from attachments (SimpleImageAttachmentAdapter
          // puts image data in attachment.content, not message.content)
          if ("attachments" in lastMsg) {
            for (const att of (lastMsg as any).attachments ?? []) {
              for (const part of att.content ?? []) {
                if (part.type === "image") {
                  extractDataUrl(part.image);
                }
              }
            }
          }
        }

        // Reset bridge and send prompt
        bridgeRef.current = new WsEventBridge();
        if (promptText || images.length > 0) {
          const payload: any = { type: "prompt", message: promptText };
          if (images.length > 0) payload.images = images;
          ws.send(JSON.stringify(payload));
        }

        const bridge = bridgeRef.current;
        const content: ChatModelRunResult["content"] & any[] = [];
        let textAccum = "";

        while (!abortSignal.aborted) {
          const event = await bridge.pull();

          switch (event.type) {
            case "text_delta": {
              textAccum += event.delta;
              // Update existing text part or add new one
              const lastIdx = content.length - 1;
              if (lastIdx >= 0 && (content[lastIdx] as any).type === "text") {
                content[lastIdx] = {
                  type: "text" as const,
                  text: textAccum,
                };
              } else {
                content.push({
                  type: "text" as const,
                  text: textAccum,
                });
              }
              yield { content: [...content] };
              break;
            }

            case "tool_start": {
              content.push({
                type: "tool-call" as const,
                toolCallId: event.id,
                toolName: event.name,
                args: event.args,
              });
              yield { content: [...content] };
              break;
            }

            case "tool_end": {
              // Find matching tool-call and add result
              const idx = content.findIndex(
                (c: any) => c.type === "tool-call" && c.toolCallId === event.id,
              );
              if (idx >= 0) {
                content[idx] = {
                  ...content[idx],
                  result: event.result,
                };
              }
              yield { content: [...content] };
              break;
            }

            case "done":
              yield {
                content: [...content],
                status: {
                  type: "complete" as const,
                  reason: "stop" as const,
                },
              };
              return;

            case "error":
              yield {
                content: [...content],
                status: {
                  type: "incomplete" as const,
                  reason: "error" as const,
                  error: event.message,
                },
              };
              return;
          }
        }

        // Aborted
        yield {
          content: [...content],
          status: {
            type: "incomplete" as const,
            reason: "cancelled" as const,
          },
        };
      },
    }),
    [adapterKey],
  );

  const runtime = useLocalRuntime(adapter, {
    maxSteps: 100,
    adapters: {
      attachments: new SimpleImageAttachmentAdapter(),
    },
  });

  // When adapterKey changes (thread switch), load pending history into the runtime
  useEffect(() => {
    const history = pendingHistoryRef.current;
    if (history) {
      pendingHistoryRef.current = null;
      runtime.thread.reset(history);
    }
  }, [adapterKey, runtime]);

  // WebSocket connection
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws`);
    wsRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => {
      setConnected(false);
      bridgeRef.current.close();
    };

    socket.onmessage = (ev) => {
      const msg: ServerMessage = JSON.parse(ev.data);

      switch (msg.type) {
        case "identity":
          setIdentity(msg);
          break;
        case "sessions":
          setSessions(msg.sessions);
          setActiveSession(msg.active);
          break;
        case "history": {
          // Convert server history into ThreadMessageLike[] and load into runtime
          bridgeRef.current = new WsEventBridge();
          const threadMessages = msg.messages.flatMap((entry: HistoryEntry) => {
            const msgs: Array<{
              role: "user" | "assistant";
              content: any[];
              status?: any;
            }> = [];

            if (entry.role === "user") {
              const userContent: any[] = [];
              // Add images first (if any), then text
              if (entry.images) {
                for (const img of entry.images) {
                  userContent.push({
                    type: "image" as const,
                    image: `data:${img.mimeType};base64,${img.data}`,
                  });
                }
              }
              if (entry.text) {
                userContent.push({ type: "text" as const, text: entry.text });
              }
              msgs.push({
                role: "user",
                content: userContent,
              });
            } else {
              const content: any[] = [];
              if (entry.tools) {
                for (const tool of entry.tools) {
                  content.push({
                    type: "tool-call" as const,
                    toolCallId: tool.id,
                    toolName: tool.name,
                    args: tool.args,
                    result: tool.result,
                  });
                }
              }
              if (entry.text) {
                content.push({ type: "text" as const, text: entry.text });
              }
              if (content.length > 0) {
                msgs.push({
                  role: "assistant",
                  content,
                  status: { type: "complete", reason: "stop" },
                });
              }
            }
            return msgs;
          });
          pendingHistoryRef.current = threadMessages;
          setAdapterKey((k) => k + 1);
          break;
        }
        // Stream events go to the bridge
        case "text_delta":
        case "tool_start":
        case "tool_end":
        case "done":
        case "error":
          bridgeRef.current.push(msg);
          break;
      }
    };

    return () => socket.close();
  }, []);

  const send = useCallback((data: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  const switchSession = useCallback(
    (id: string) => {
      send({ type: "switch_session", sessionId: id });
    },
    [send],
  );

  const newSession = useCallback(() => {
    const id = `session-${Date.now()}`;
    send({ type: "new_session", sessionId: id });
  }, [send]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-screen">
        {/* Sidebar */}
        <ThreadSidebar
          sessions={sessions}
          active={activeSession}
          onSwitch={switchSession}
          onNew={newSession}
        />

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          <Header identity={identity} connected={connected} />
          <div className="flex-1 min-h-0">
            <Thread
              tools={[ToolFallback]}
              assistantMessage={{
                components: { Text: MarkdownText },
              }}
              composer={{ allowAttachments: true }}
              welcome={{
                message: identity?.purpose || "Start a conversation",
              }}
            />
          </div>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}

// ── ThreadSidebar ──

function ThreadSidebar({
  sessions,
  active,
  onSwitch,
  onNew,
}: {
  sessions: string[];
  active: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="w-60 flex-shrink-0 border-r border-border bg-bg-surface flex flex-col h-full">
      <div className="px-3 py-3 border-b border-border">
        <button
          onClick={onNew}
          className="w-full text-left text-xs px-3 py-2 rounded-md bg-bg hover:bg-bg-hover border border-border text-gray-300 transition-colors"
        >
          + New thread
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {sessions.map((s) => (
          <button
            key={s}
            onClick={() => onSwitch(s)}
            className={`w-full text-left text-xs px-4 py-2 transition-colors truncate ${
              s === active
                ? "bg-bg-hover text-accent border-r-2 border-accent"
                : "text-gray-400 hover:bg-bg-hover hover:text-gray-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Header ──

function Header({ identity, connected }: { identity: IdentityMsg | null; connected: boolean }) {
  return (
    <header className="flex-shrink-0 border-b border-border px-4 py-3 bg-bg-surface">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <div>
            <h1 className="text-sm font-semibold text-gray-100">
              {identity?.name || "imps agent"}
            </h1>
            {identity?.purpose && (
              <p className="text-xs text-gray-500 mt-0.5">{identity.purpose}</p>
            )}
          </div>
        </div>
        {identity && (
          <span className="text-xs text-gray-500">
            {identity.tools.length} tool
            {identity.tools.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </header>
  );
}

// ── Mount ──

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
