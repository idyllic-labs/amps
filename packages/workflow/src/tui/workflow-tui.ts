import {
  TUI,
  Container,
  Text,
  Spacer,
  Markdown,
  Input,
  SelectList,
  type Component,
  type SelectItem,
  type SelectListTheme,
  visibleWidth,
} from "@mariozechner/pi-tui";
import type {
  WorkflowDefinition,
  WorkflowNode,
  StreamEvent,
  InputRequest,
  InputResolver,
} from "../types.ts";
import { InterceptTerminal } from "./terminal.ts";
import { theme, icons, nodeLabels, markdownTheme } from "./theme.ts";
import { WorkflowFooter } from "./components/footer.ts";

// ─── StatusLine Component ────────────────────────────────────────────────────

/** A single-line component with icon + label on left, info on right */
class StatusLine implements Component {
  icon: string;
  readonly indent: number;
  rightText: string;
  private label: string;
  private name: string;

  constructor(icon: string, label: string, name: string, rightText: string, indent: number) {
    this.icon = icon;
    this.label = label;
    this.name = name;
    this.rightText = rightText;
    this.indent = indent;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const prefix = " ".repeat(this.indent);
    const left = `${prefix}${this.icon} ${this.label}  ${theme.reset}${this.name}`;
    const right = this.rightText ? `${theme.muted}${this.rightText}${theme.reset}` : "";

    if (!right) return [left];

    const leftW = visibleWidth(left);
    const rightW = visibleWidth(right);
    const padding = Math.max(2, width - leftW - rightW - 1);
    return [left + " ".repeat(padding) + right];
  }
}

// ─── HeaderBox Component ─────────────────────────────────────────────────────

class HeaderBox implements Component {
  private name: string;
  private inputLines: string[];

  constructor(name: string, inputs: Record<string, any>) {
    this.name = name;
    this.inputLines = [];
    const entries = Object.entries(inputs);
    if (entries.length > 0) {
      const parts = entries.map(
        ([k, v]) => `${k} = ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`,
      );
      this.inputLines.push(`Inputs: ${parts.join(", ")}`);
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const innerWidth = Math.max(40, width - 4);
    const titleBar = `─ ${this.name} `;
    const topLine = `${theme.primary} ╭${titleBar}${"─".repeat(Math.max(0, innerWidth - titleBar.length))}╮${theme.reset}`;
    const lines = [topLine];

    for (const line of this.inputLines) {
      const padded = line + " ".repeat(Math.max(0, innerWidth - line.length));
      lines.push(`${theme.primary} │${theme.reset}  ${padded}${theme.primary}│${theme.reset}`);
    }
    if (this.inputLines.length === 0) {
      const empty = " ".repeat(innerWidth);
      lines.push(`${theme.primary} │${theme.reset}${empty}${theme.primary}│${theme.reset}`);
    }

    lines.push(`${theme.primary} ╰${"─".repeat(innerWidth)}╯${theme.reset}`);
    return lines;
  }
}

// ─── NodeEntry ───────────────────────────────────────────────────────────────

interface NodeEntry {
  status: "pending" | "active" | "complete" | "error";
  kind: string;
  statusLine: StatusLine;
  contentContainer: Container;
  streamingMarkdown?: Markdown;
  streamedText?: string;
  /** For loops: total iteration count */
  loopTotal?: number;
  /** For loops: names of child node entries to reset per iteration */
  childNames?: string[];
}

// ─── WorkflowTUI ─────────────────────────────────────────────────────────────

export class WorkflowTUI {
  private tui: TUI;
  private terminal: InterceptTerminal;
  private footer: WorkflowFooter;
  private documentContainer: Container;
  private nodeEntries = new Map<string, NodeEntry>();
  private ifEntries = new Map<string, NodeEntry>();
  private workflowName: string;
  private model: string;
  private lastCtrlCTime = 0;

  constructor(
    workflow: WorkflowDefinition,
    inputs: Record<string, any>,
    options?: { model?: string },
  ) {
    this.workflowName = workflow.name;
    this.model = options?.model ?? "azure/gpt-5.2";

    this.terminal = new InterceptTerminal();
    this.terminal.setCtrlCHandler(() => this.handleCtrlC());
    this.tui = new TUI(this.terminal);
    this.tui.setClearOnShrink(true);

    // Header
    const header = new HeaderBox(workflow.name, inputs);
    this.tui.addChild(header);
    this.tui.addChild(new Spacer(1));

    // Document area
    this.documentContainer = new Container();
    this.tui.addChild(this.documentContainer);

    // Build skeleton from workflow nodes
    this.buildSkeleton(workflow.nodes, this.documentContainer, 1);

    this.tui.addChild(new Spacer(1));

    // Footer
    this.footer = new WorkflowFooter(workflow.name, this.model, () => this.tui.requestRender());
    this.tui.addChild(this.footer);
  }

  // ─── Skeleton Building ───────────────────────────────────────────────────

  private buildSkeleton(nodes: WorkflowNode[], parent: Container, indent: number): void {
    for (const node of nodes) {
      switch (node.kind) {
        case "prose": {
          const content = node.content.trim();
          if (content) {
            parent.addChild(new Markdown(content, indent, 0, markdownTheme));
            parent.addChild(new Spacer(1));
          }
          break;
        }
        case "generation": {
          const sl = new StatusLine(
            icons.pending,
            nodeLabels.generation,
            node.name,
            "pending",
            indent,
          );
          const cc = new Container();
          parent.addChild(sl);
          parent.addChild(cc);
          parent.addChild(new Spacer(1));
          this.nodeEntries.set(node.name, {
            status: "pending",
            kind: "generation",
            statusLine: sl,
            contentContainer: cc,
          });
          break;
        }
        case "structured": {
          const sl = new StatusLine(
            icons.pending,
            nodeLabels.structured,
            node.name,
            "pending",
            indent,
          );
          const cc = new Container();
          parent.addChild(sl);
          parent.addChild(cc);
          parent.addChild(new Spacer(1));
          this.nodeEntries.set(node.name, {
            status: "pending",
            kind: "structured",
            statusLine: sl,
            contentContainer: cc,
          });
          break;
        }
        case "websearch": {
          const sl = new StatusLine(
            icons.pending,
            nodeLabels.websearch,
            node.name,
            "pending",
            indent,
          );
          const cc = new Container();
          parent.addChild(sl);
          parent.addChild(cc);
          parent.addChild(new Spacer(1));
          this.nodeEntries.set(node.name, {
            status: "pending",
            kind: "websearch",
            statusLine: sl,
            contentContainer: cc,
          });
          break;
        }
        case "webfetch": {
          const sl = new StatusLine(
            icons.pending,
            nodeLabels.webfetch,
            node.name,
            "pending",
            indent,
          );
          const cc = new Container();
          parent.addChild(sl);
          parent.addChild(cc);
          parent.addChild(new Spacer(1));
          this.nodeEntries.set(node.name, {
            status: "pending",
            kind: "webfetch",
            statusLine: sl,
            contentContainer: cc,
          });
          break;
        }
        case "set": {
          const sl = new StatusLine(icons.pending, nodeLabels.set, node.name, "", indent);
          const cc = new Container();
          parent.addChild(sl);
          parent.addChild(cc);
          this.nodeEntries.set(node.name, {
            status: "pending",
            kind: "set",
            statusLine: sl,
            contentContainer: cc,
          });
          break;
        }
        case "log":
          break;
        case "flow": {
          const sl = new StatusLine(icons.pending, nodeLabels.flow, node.name, node.src, indent);
          const cc = new Container();
          parent.addChild(sl);
          parent.addChild(cc);
          parent.addChild(new Spacer(1));
          this.nodeEntries.set(node.name, {
            status: "pending",
            kind: "flow",
            statusLine: sl,
            contentContainer: cc,
          });
          break;
        }
        case "loop": {
          const sl = new StatusLine(icons.loop, nodeLabels.loop, node.name, "", indent);
          parent.addChild(sl);

          const bodyContainer = new Container();
          parent.addChild(bodyContainer);

          const childNames: string[] = [];
          this.collectChildNames(node.children, childNames);

          this.buildSkeleton(node.children, bodyContainer, indent + 2);
          parent.addChild(new Spacer(1));

          this.nodeEntries.set(node.name, {
            status: "pending",
            kind: "loop",
            statusLine: sl,
            contentContainer: bodyContainer,
            childNames,
          });
          break;
        }
        case "if": {
          const conditionLabel =
            node.condition.raw.length > 30
              ? node.condition.raw.slice(0, 27) + "..."
              : node.condition.raw;
          const sl = new StatusLine(icons.pending, nodeLabels.if, conditionLabel, "", indent);
          const cc = new Container();
          parent.addChild(sl);

          const bodyContainer = new Container();
          parent.addChild(bodyContainer);
          this.buildSkeleton(node.children, bodyContainer, indent + 2);

          if (node.elseChildren && node.elseChildren.length > 0) {
            parent.addChild(
              new Text(" ".repeat(indent) + `${theme.muted}Else${theme.reset}`, 0, 0),
            );
            const elseContainer = new Container();
            parent.addChild(elseContainer);
            this.buildSkeleton(node.elseChildren, elseContainer, indent + 2);
          }

          const key = `if:${node.condition.raw}`;
          this.ifEntries.set(key, {
            status: "pending",
            kind: "if",
            statusLine: sl,
            contentContainer: cc,
          });
          break;
        }
        case "prompt":
        case "select":
        case "confirm": {
          const label =
            node.kind === "prompt"
              ? nodeLabels.prompt
              : node.kind === "select"
                ? nodeLabels.select
                : nodeLabels.confirm;
          const sl = new StatusLine(icons.input, label, node.name, "waiting", indent);
          const cc = new Container();
          parent.addChild(sl);
          parent.addChild(cc);
          parent.addChild(new Spacer(1));
          this.nodeEntries.set(node.name, {
            status: "pending",
            kind: node.kind,
            statusLine: sl,
            contentContainer: cc,
          });
          break;
        }
        case "comment":
          break;
      }
    }
  }

  private collectChildNames(nodes: WorkflowNode[], names: string[]): void {
    for (const node of nodes) {
      if ("name" in node && typeof (node as any).name === "string") {
        names.push((node as any).name);
      }
      if ("children" in node && Array.isArray((node as any).children)) {
        this.collectChildNames((node as any).children, names);
      }
      if ("elseChildren" in node && Array.isArray((node as any).elseChildren)) {
        this.collectChildNames((node as any).elseChildren, names);
      }
    }
  }

  // ─── Event Handling ──────────────────────────────────────────────────────

  handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case "start":
        break;

      case "generation:start": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "active";
        entry.statusLine.icon = icons.active;
        entry.statusLine.rightText = event.model;

        const md = new Markdown("", entry.statusLine.indent + 2, 0, markdownTheme);
        entry.contentContainer.addChild(md);
        entry.streamingMarkdown = md;
        entry.streamedText = "";

        this.footer.setModel(event.model);
        this.tui.requestRender();
        break;
      }

      case "generation:chunk": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry || !entry.streamingMarkdown) break;
        entry.streamedText = (entry.streamedText ?? "") + event.content;
        entry.streamingMarkdown.setText(entry.streamedText);
        this.tui.requestRender();
        break;
      }

      case "generation:end": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "complete";
        entry.statusLine.icon = icons.complete;
        entry.statusLine.rightText = "done";
        entry.streamingMarkdown = undefined;
        this.tui.requestRender();
        break;
      }

      case "structured:start": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "active";
        entry.statusLine.icon = icons.active;
        entry.statusLine.rightText = event.model;
        this.footer.setModel(event.model);
        this.tui.requestRender();
        break;
      }

      case "structured:end": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "complete";
        entry.statusLine.icon = icons.complete;
        entry.statusLine.rightText = "done";

        const json = JSON.stringify(event.value, null, 2);
        const md = new Markdown("```json\n" + json + "\n```", 3, 0, markdownTheme);
        entry.contentContainer.addChild(md);
        this.tui.requestRender();
        break;
      }

      case "tool:start": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "active";
        entry.statusLine.icon = icons.active;
        entry.statusLine.rightText = event.tool;
        this.tui.requestRender();
        break;
      }

      case "tool:end": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "complete";
        entry.statusLine.icon = icons.complete;
        entry.statusLine.rightText = "done";
        this.tui.requestRender();
        break;
      }

      case "loop:start": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "active";
        entry.loopTotal = event.total;
        entry.statusLine.icon = icons.loopActive;
        entry.statusLine.rightText = `[0/${event.total}]`;
        this.tui.requestRender();
        break;
      }

      case "loop:iteration": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        const total = entry.loopTotal ?? "?";
        entry.statusLine.rightText = `[${event.index + 1}/${total}]`;

        if (entry.childNames) {
          for (const childName of entry.childNames) {
            const child = this.nodeEntries.get(childName);
            if (child) {
              child.status = "pending";
              child.statusLine.icon = icons.pending;
              child.statusLine.rightText = "pending";
              child.contentContainer.clear();
              child.streamingMarkdown = undefined;
              child.streamedText = undefined;
            }
          }
        }
        this.tui.requestRender();
        break;
      }

      case "loop:end": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "complete";
        entry.statusLine.icon = icons.loopComplete;
        const total = entry.loopTotal ?? "?";
        entry.statusLine.rightText = `[${total}/${total}] done`;
        this.tui.requestRender();
        break;
      }

      case "flow:start": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "active";
        entry.statusLine.icon = icons.active;
        entry.statusLine.rightText = event.src;
        this.tui.requestRender();
        break;
      }

      case "flow:end": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "complete";
        entry.statusLine.icon = icons.complete;
        entry.statusLine.rightText = "done";
        this.tui.requestRender();
        break;
      }

      case "if:eval": {
        const key = `if:${event.condition}`;
        const entry = this.ifEntries.get(key);
        if (!entry) break;
        if (event.result) {
          entry.status = "complete";
          entry.statusLine.icon = icons.ifTrue;
          entry.statusLine.rightText = `${theme.success}true${theme.reset}`;
        } else {
          entry.status = "complete";
          entry.statusLine.icon = icons.ifFalse;
          entry.statusLine.rightText = `${theme.muted}false${theme.reset}`;
        }
        this.tui.requestRender();
        break;
      }

      case "set": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "complete";
        entry.statusLine.icon = icons.complete;
        entry.statusLine.rightText = "";
        this.tui.requestRender();
        break;
      }

      case "log": {
        const prefix =
          event.level === "warn"
            ? `${theme.warning}WARN${theme.reset}`
            : event.level === "debug"
              ? `${theme.muted}DEBUG${theme.reset}`
              : `${theme.primary}INFO${theme.reset}`;
        this.documentContainer.addChild(
          new Text(`   ${prefix}  ${theme.muted}${event.message}${theme.reset}`, 0, 0),
        );
        this.tui.requestRender();
        break;
      }

      case "input:start": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "active";
        entry.statusLine.icon = icons.input;
        entry.statusLine.rightText = event.message;
        this.tui.requestRender();
        break;
      }

      case "input:end": {
        const entry = this.nodeEntries.get(event.name);
        if (!entry) break;
        entry.status = "complete";
        entry.statusLine.icon = icons.inputComplete;
        const displayValue =
          typeof event.value === "boolean" ? (event.value ? "Yes" : "No") : String(event.value);
        entry.statusLine.rightText = displayValue;
        entry.contentContainer.clear();
        this.tui.requestRender();
        break;
      }

      case "error": {
        if (event.node) {
          const entry = this.nodeEntries.get(event.node);
          if (entry) {
            entry.status = "error";
            entry.statusLine.icon = icons.error;
            entry.statusLine.rightText = event.message;
          }
        }
        this.footer.setStatus("error");
        this.tui.requestRender();
        break;
      }

      case "complete": {
        this.footer.setStatus("complete");
        this.footer.stopAnimation();
        this.tui.requestRender();
        break;
      }

      case "output":
        break;
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  start(): void {
    this.footer.startAnimation();
    this.tui.start();
  }

  stop(): void {
    this.footer.stopAnimation();
    this.tui.stop();
  }

  // ─── Input Resolver ────────────────────────────────────────────────────

  /** Create an InputResolver that wires TUI input widgets to executor pause/resume */
  createInputResolver(): InputResolver {
    const selectTheme: SelectListTheme = {
      selectedPrefix: (t: string) => `${theme.accent}${t}${theme.reset}`,
      selectedText: (t: string) => `${theme.accent}${t}${theme.reset}`,
      description: (t: string) => `${theme.muted}${t}${theme.reset}`,
      scrollInfo: (t: string) => `${theme.muted}${t}${theme.reset}`,
      noMatch: (t: string) => `${theme.muted}${t}${theme.reset}`,
    };

    return async (request: InputRequest): Promise<any> => {
      return new Promise<any>((resolve) => {
        const entry = this.nodeEntries.get(request.name);
        const indent = entry?.statusLine.indent ?? 1;
        const pad = " ".repeat(indent + 2);

        // Message label
        const messageText = new Text(
          `${pad}${theme.accent}?${theme.reset} ${request.message}`,
          0,
          0,
        );
        entry?.contentContainer.addChild(messageText);

        switch (request.kind) {
          case "prompt": {
            const input = new Input();
            if (request.default) {
              input.setValue(request.default);
            }
            const wrapper = new IndentedComponent(input, indent + 4);
            entry?.contentContainer.addChild(wrapper);

            input.onSubmit = (value: string) => {
              this.tui.setFocus(null);
              resolve(request.inputType === "number" ? Number(value) : value);
            };
            input.onEscape = () => {
              this.tui.setFocus(null);
              resolve(request.default ?? "");
            };

            this.tui.setFocus(input);
            this.tui.requestRender();
            break;
          }

          case "select": {
            const items: SelectItem[] = request.options.map((opt) => ({
              value: opt.value,
              label: opt.label,
              description: opt.description,
            }));
            const selectList = new SelectList(items, Math.min(items.length, 8), selectTheme);
            const wrapper = new IndentedComponent(selectList, indent + 4);
            entry?.contentContainer.addChild(wrapper);

            selectList.onSelect = (item: SelectItem) => {
              this.tui.setFocus(null);
              resolve(item.value);
            };
            selectList.onCancel = () => {
              this.tui.setFocus(null);
              resolve(items.length > 0 ? items[0].value : "");
            };

            this.tui.setFocus(selectList);
            this.tui.requestRender();
            break;
          }

          case "confirm": {
            const items: SelectItem[] = [
              { value: "true", label: "Yes", description: request.default ? "(default)" : "" },
              { value: "false", label: "No", description: !request.default ? "(default)" : "" },
            ];
            const selectList = new SelectList(items, 2, selectTheme);
            selectList.setSelectedIndex(request.default ? 0 : 1);
            const wrapper = new IndentedComponent(selectList, indent + 4);
            entry?.contentContainer.addChild(wrapper);

            selectList.onSelect = (item: SelectItem) => {
              this.tui.setFocus(null);
              resolve(item.value === "true");
            };
            selectList.onCancel = () => {
              this.tui.setFocus(null);
              resolve(request.default);
            };

            this.tui.setFocus(selectList);
            this.tui.requestRender();
            break;
          }
        }
      });
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private handleCtrlC(): boolean {
    const now = Date.now();
    if (now - this.lastCtrlCTime <= 800) {
      this.stop();
      process.exit(0);
    }
    this.lastCtrlCTime = now;
    return true;
  }
}

// ─── IndentedComponent ──────────────────────────────────────────────────────

/** Wrapper that adds left indentation to a child component's rendered lines */
class IndentedComponent implements Component {
  constructor(
    private child: Component,
    private indent: number,
  ) {}

  invalidate(): void {
    this.child.invalidate();
  }

  render(width: number): string[] {
    const prefix = " ".repeat(this.indent);
    return this.child.render(width - this.indent).map((line) => prefix + line);
  }
}
