import {
  TUI,
  Container,
  Text,
  Editor,
  Spacer,
  Markdown,
  CombinedAutocompleteProvider,
  type SlashCommand,
} from "@mariozechner/pi-tui";
import type { AgentRuntime } from "../runtime/agent-runtime.ts";
import { SessionManager, type ChatMessage } from "./session-manager.ts";
import { FooterComponent, type FooterStats } from "./components/footer.ts";
import { theme } from "./theme.ts";
import { InterceptTerminal } from "./terminal.ts";

const thinkingIndicator = "thinking off";

const editorTheme = {
  prompt: `${theme.primary}>${theme.reset} `,
  text: theme.reset,
  selection: "\x1b[7m",
  placeholder: theme.muted,
  cursor: "\x1b[7m \x1b[0m",
  borderColor: (str: string) => `${theme.accent}${str}${theme.reset}`,
  selectList: {
    selectedPrefix: (text: string) => `${theme.success}${text}${theme.reset}`,
    selectedText: (text: string) => `${theme.primary}${text}${theme.reset}`,
    description: (text: string) => `${theme.muted}${text}${theme.reset}`,
    scrollInfo: (text: string) => `\x1b[34m${text}\x1b[0m`,
    noMatch: (text: string) => `${theme.error}${text}${theme.reset}`,
  },
};

const markdownTheme = {
  text: (t: string) => t,
  bold: (t: string) => `\x1b[1m${t}\x1b[22m`,
  italic: (t: string) => `\x1b[3m${t}\x1b[23m`,
  strikethrough: (t: string) => `\x1b[9m${t}\x1b[29m`,
  underline: (t: string) => `\x1b[4m${t}\x1b[24m`,
  heading: (t: string) => `\x1b[1m${t}\x1b[22m`,
  code: (t: string) => `${theme.accent}${t}${theme.reset}`,
  codeBlock: (t: string) => `\x1b[90m${t}\x1b[0m`,
  codeBlockBorder: (t: string) => `\x1b[90m${t}\x1b[0m`,
  link: (t: string) => `\x1b[34m${t}\x1b[0m`,
  linkUrl: (t: string) => `\x1b[90m${t}\x1b[0m`,
  list: (t: string) => t,
  listBullet: (t: string) => `${theme.accent}${t}${theme.reset}`,
  quote: (t: string) => `\x1b[90m${t}\x1b[0m`,
  quoteBorder: (t: string) => `\x1b[90m${t}\x1b[0m`,
  hr: (t: string) => `\x1b[90m${t}\x1b[0m`,
  tableBorder: (t: string) => `\x1b[90m${t}\x1b[0m`,
};

function formatToolArgs(toolName: string, args: any): string {
  if (toolName === "bash" && args?.command) {
    const cmd = args.command as string;
    return cmd.length > 120 ? cmd.slice(0, 117) + "..." : cmd;
  }
  if (toolName === "read_file" && args?.path) {
    return args.path;
  }
  if (toolName === "write_file" && args?.path) {
    return args.path;
  }
  return JSON.stringify(args).slice(0, 100);
}

/**
 * Agent TUI - Matching pi-coding-agent structure
 */
export class AgentTUI {
  private tui: TUI;
  private terminal: InterceptTerminal;
  private runtime: AgentRuntime;
  private sessionManager: SessionManager;
  private agentName: string;

  // Containers (exact pi-coding-agent order)
  private headerContainer: Container;
  private chatContainer: Container;
  private pendingMessagesContainer: Container;
  private statusContainer: Container;
  private editorContainer: Container;
  private footer!: FooterComponent;
  private historyCache: ChatMessage[] = [];
  private modelInfo: { id: string; provider: string; contextWindow: number } | undefined;

  // Components
  private editor!: Editor;
  private isProcessing: boolean = false;
  private readonly defaultWorkingMessage = "Working...";
  private lastCtrlCTime = 0;

  // Streaming tracking
  private streamingMessageText: string = "";
  private streamingComponent?: Markdown;

  constructor(runtime: AgentRuntime, agentName: string, sessionId: string = "main") {
    this.runtime = runtime;
    this.agentName = agentName;
    this.sessionManager = new SessionManager(runtime.getAgentPath(), sessionId);
    this.terminal = new InterceptTerminal();
    this.terminal.setCtrlCHandler(() => this.handleCtrlC());
    this.tui = new TUI(this.terminal);
    this.tui.setClearOnShrink(true);

    // Initialize containers
    this.headerContainer = new Container();
    this.chatContainer = new Container();
    this.pendingMessagesContainer = new Container();
    this.pendingMessagesContainer.addChild(new Spacer(1)); // permanent gap between chat and editor
    this.statusContainer = new Container();
    this.editorContainer = new Container();

    // Build UI
    this.buildHeader();
    this.buildEditor();
    this.setupAutocomplete();
    this.buildFooter();

    // Assemble TUI (exact pi-coding-agent order)
    this.tui.addChild(this.headerContainer);
    this.tui.addChild(this.chatContainer);
    this.tui.addChild(this.pendingMessagesContainer);
    this.tui.addChild(this.statusContainer);
    this.tui.addChild(this.editorContainer);
    this.tui.addChild(this.footer);

    // Set focus
    this.tui.setFocus(this.editor);
  }

  private buildHeader() {
    const identity = this.runtime.getIdentity();
    const logo =
      `${theme.primary}╔═══════════════════════════════════════════╗\n` +
      `║  ${theme.success}mdx-ai${theme.reset} ${theme.muted}→ ${theme.primary}${this.agentName}${theme.reset}                          ${theme.primary}║\n` +
      `${theme.primary}╚═══════════════════════════════════════════╝${theme.reset}\n`;

    const purpose = identity?.purpose ? `${theme.muted}${identity.purpose}${theme.reset}\n` : "";
    const keybindings = `${theme.muted}Ctrl+C twice: exit | /help: commands | /: menu${theme.reset}`;

    this.headerContainer.addChild(new Text(logo));
    if (purpose) this.headerContainer.addChild(new Text(purpose));
    this.headerContainer.addChild(new Text(keybindings));
    this.headerContainer.addChild(new Spacer(1));
  }

  private setupAutocomplete() {
    const slashCommands: SlashCommand[] = [
      { name: "help", description: "Show commands" },
      { name: "skills", description: "List skills" },
      { name: "clear", description: "Clear chat" },
      { name: "quit", description: "Exit" },
    ];

    const skillCommands: SlashCommand[] = this.runtime
      .getSkillLoader()
      .getAvailableSkillNames()
      .map((skill) => ({ name: `skill:${skill}`, description: `Invoke ${skill}` }));

    const provider = new CombinedAutocompleteProvider(
      [...slashCommands, ...skillCommands],
      process.cwd(),
    );
    this.editor.setAutocompleteProvider(provider);
  }

  private buildEditor() {
    this.editor = new Editor(this.tui, editorTheme, { paddingX: 2 });
    this.editor.onSubmit = async (text: string) => {
      await this.handleSubmit(text);
    };

    // Patch render to inject `>` prompt on each content line.
    // Editor content lines start with spaces (paddingX); border lines don't.
    const originalRender = this.editor.render.bind(this.editor);
    this.editor.render = (width: number) => {
      const lines = originalRender(width);
      return lines.map((line) => {
        if (line.length > 0 && line[0] === " ") {
          return `${theme.muted}>${theme.reset}` + line.slice(1);
        }
        return line;
      });
    };

    this.editorContainer.addChild(this.editor);
  }

  private buildFooter() {
    this.footer = new FooterComponent(
      () => this.getFooterStats(),
      () => this.tui.requestRender(),
    );
  }

  private async handleSubmit(text: string) {
    if (!text.trim() || this.isProcessing) return;

    this.editor.setText("");

    if (text.startsWith("/")) {
      await this.handleCommand(text);
      return;
    }

    this.isProcessing = true;

    this.showWorkingStatus();

    this.modelInfo = this.runtime.getLastModelInfo();

    // Show user message (spacer before separates from previous assistant response)
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(`${theme.userBg} ${text} ${theme.reset}`, 1, 0));
    this.chatContainer.addChild(new Spacer(1));
    this.tui.requestRender();

    // Save user message
    await this.sessionManager.saveMessage({
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    });

    try {
      // Reset streaming state — component created lazily on first text_delta
      this.streamingMessageText = "";
      this.streamingComponent = undefined;
      let fullResponseText = "";

      this.historyCache = (await this.sessionManager.loadHistory()).filter(
        (message): message is ChatMessage & { role: "user" | "assistant" } =>
          message.role === "user" || message.role === "assistant",
      );

      // Process stream — now yields AgentEvent
      const filteredHistory = this.historyCache.filter(
        (message): message is ChatMessage & { role: "user" | "assistant" } =>
          message.role === "user" || message.role === "assistant",
      );

      for await (const event of this.runtime.processTaskStream(text, filteredHistory)) {
        switch (event.type) {
          case "message_update": {
            const inner = event.assistantMessageEvent;
            if (inner.type === "text_delta") {
              // Lazily create streaming component on first delta (or after tool events)
              if (!this.streamingComponent) {
                this.streamingComponent = new Markdown("", 1, 0, markdownTheme);
                this.chatContainer.addChild(new Spacer(1));
                this.chatContainer.addChild(this.streamingComponent);
              }
              this.streamingMessageText += inner.delta;
              fullResponseText += inner.delta;
              this.streamingComponent.setText(this.streamingMessageText);
              this.tui.requestRender();
            } else if (inner.type === "done") {
              this.modelInfo = {
                id: inner.message.model,
                provider: inner.message.provider,
                contextWindow: this.runtime.getLastModelInfo()?.contextWindow || 0,
              };
              this.tui.requestRender();
            } else if (inner.type === "error") {
              throw new Error(inner.error?.errorMessage || "Unknown error");
            }
            break;
          }

          case "tool_execution_start": {
            // Finalize streaming component before tool output — next text_delta
            // will create a fresh Markdown below the tool results
            this.streamingComponent = undefined;
            this.streamingMessageText = "";

            const display = formatToolArgs(event.toolName, event.args);
            this.chatContainer.addChild(
              new Text(
                `${theme.muted}[tool:${event.toolName}]${theme.reset} ${theme.accent}${display}${theme.reset}`,
                1,
                0,
              ),
            );
            this.tui.requestRender();
            break;
          }

          case "tool_execution_end": {
            if (event.isError) {
              const errText = event.result?.content?.[0]?.text ?? JSON.stringify(event.result);
              this.chatContainer.addChild(
                new Text(
                  `${theme.error}  Error: ${String(errText).slice(0, 200)}${theme.reset}`,
                  1,
                  0,
                ),
              );
            } else {
              const resultText = event.result?.content?.[0]?.text ?? JSON.stringify(event.result);
              const truncated =
                String(resultText).length > 200
                  ? String(resultText).slice(0, 197) + "..."
                  : String(resultText);
              this.chatContainer.addChild(
                new Text(`${theme.muted}  ${truncated}${theme.reset}`, 1, 0),
              );
            }
            this.tui.requestRender();
            break;
          }

          case "message_end":
            // No-op — keep streaming into the same Markdown component across
            // consecutive text turns. Only tool_execution_start breaks the component.
            break;

          case "agent_end":
            break;
        }
      }

      // Save full assistant response (accumulated across all turns)
      if (fullResponseText.trim()) {
        await this.sessionManager.saveMessage({
          role: "assistant",
          content: fullResponseText,
          timestamp: new Date().toISOString(),
        });
      }

      this.historyCache = await this.sessionManager.loadHistory();

      this.streamingComponent = undefined;
      this.tui.requestRender();
    } catch (error) {
      this.clearStatus();
      const children = (this.statusContainer as any).children || [];
      for (const child of children) this.statusContainer.removeChild(child);
      this.statusContainer.addChild(new Text(`${theme.error}Error: ${error}${theme.reset}`, 1, 0));
      this.tui.requestRender();
    } finally {
      this.isProcessing = false;
      this.clearStatus();
    }
  }

  private async handleCommand(command: string) {
    const cmd = command.toLowerCase().trim();

    switch (cmd) {
      case "/help":
        this.chatContainer.addChild(
          new Text(`${theme.muted}Commands: /clear /skills /quit${theme.reset}`, 1, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
        this.tui.requestRender();
        break;

      case "/skills": {
        const skills = this.runtime.getSkillLoader().getAvailableSkillNames();
        this.chatContainer.addChild(
          new Text(`${theme.muted}Skills: ${skills.join(", ")}${theme.reset}`, 1, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
        this.tui.requestRender();
        break;
      }

      case "/clear":
        await this.sessionManager.clearHistory();
        this.historyCache = [];
        {
          const children = (this.chatContainer as any).children || [];
          for (const child of children) this.chatContainer.removeChild(child);
        }
        this.tui.requestRender();
        break;

      case "/quit":
      case "/exit":
        this.stop();
        process.exit(0);
        break;

      default:
        this.chatContainer.addChild(
          new Text(`${theme.muted}Unknown: ${command}${theme.reset}`, 1, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
        this.tui.requestRender();
    }
  }

  private async loadChatHistory() {
    const history = await this.sessionManager.loadHistory();
    this.historyCache = history;
    for (const msg of history) {
      if (msg.role === "user") {
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
          new Text(`${theme.userBg} ${msg.content} ${theme.reset}`, 1, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      } else if (msg.role === "assistant") {
        this.chatContainer.addChild(new Markdown(msg.content, 1, 0, markdownTheme));
        this.chatContainer.addChild(new Spacer(1));
      }
    }
  }

  async start() {
    await this.loadChatHistory();

    this.modelInfo = this.runtime.getLastModelInfo();

    if ((await this.sessionManager.loadHistory()).length === 0) {
      this.chatContainer.addChild(
        new Text(`${theme.success}Welcome to mdx-ai!${theme.reset}`, 1, 0),
      );
      this.chatContainer.addChild(new Spacer(1));
    }

    this.tui.start();
  }

  stop() {
    this.clearStatus();
    this.runtime.stop();
    this.tui.stop();
  }

  private showWorkingStatus() {
    this.footer.startAnimation();
    this.tui.requestRender();
  }

  private clearStatus() {
    this.footer.stopAnimation();
    this.tui.requestRender();
  }

  private handleCtrlC(): boolean {
    const now = Date.now();
    const thresholdMs = 800;
    if (now - this.lastCtrlCTime <= thresholdMs) {
      this.stop();
      process.exit(0);
    }
    this.lastCtrlCTime = now;
    this.clearStatus();
    this.statusContainer.addChild(
      new Text(`${theme.muted}Press Ctrl+C again to exit${theme.reset}`, 1, 0),
    );
    this.tui.requestRender();
    return true;
  }

  private getFooterStats(): FooterStats {
    return {
      modelId: this.modelInfo?.id,
      provider: this.modelInfo?.provider,
      sessionName: "main",
      workingMessage: this.isProcessing
        ? `${this.defaultWorkingMessage} (${thinkingIndicator})`
        : undefined,
      thinkingLevel: !this.isProcessing ? thinkingIndicator : undefined,
    };
  }
}
