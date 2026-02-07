import { existsSync } from "fs";
import { resolve } from "path";
import { HeartbeatManager } from "../runtime/heartbeat.ts";
import { parseMarkdown, parseHeartbeat } from "../runtime/markdown-parser.ts";
import type { HeartbeatConfig } from "../types/index.ts";
import type { AgentModule, ModuleContext, ModuleDescriptor } from "../types/module.ts";
import type { AgentTool } from "@mariozechner/pi-agent-core";

export class HeartbeatModule implements AgentModule {
  private ctx?: ModuleContext;
  private config?: HeartbeatConfig;
  private manager?: HeartbeatManager;
  private enabled = false;

  describe(): ModuleDescriptor {
    return {
      name: "heartbeat",
      description: "Periodic wake-up scheduler driven by heartbeat.md",
    };
  }

  async initialize(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;

    const heartbeatPath = resolve(ctx.agentDir, "heartbeat.md");
    if (!existsSync(heartbeatPath)) {
      this.enabled = false;
      return;
    }

    const content = await Bun.file(heartbeatPath).text();
    const markdown = parseMarkdown(content);
    this.config = parseHeartbeat(markdown);
    this.manager = new HeartbeatManager(this.config);
    this.enabled = true;
  }

  tools(): AgentTool<any>[] {
    return [];
  }

  systemPrompt(): string {
    if (!this.enabled || !this.config) return "";

    const lines: string[] = [
      "## Heartbeat",
      "",
      `This agent has a heartbeat that fires on schedule: \`${this.config.schedule}\`.`,
      "When the heartbeat fires, you will be prompted with a wake-up message.",
      "",
    ];

    if (this.config.onWake.length > 0) {
      lines.push("On wake, you should:");
      for (const step of this.config.onWake) {
        lines.push(`- ${step}`);
      }
      lines.push("");
    }

    if (this.config.routineTasks.length > 0) {
      lines.push("Routine tasks:");
      for (const task of this.config.routineTasks) {
        lines.push(`- ${task.schedule}: ${task.description}`);
      }
      lines.push("");
    }

    if (this.config.contextReconstruction && this.config.contextReconstruction.length > 0) {
      lines.push("On wake, load these for context:");
      for (const item of this.config.contextReconstruction) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  async start(): Promise<void> {
    if (!this.enabled || !this.manager || !this.ctx) return;

    const ctx = this.ctx;
    const config = this.config!;

    this.manager.start(async () => {
      await this.onWake(ctx, config);
    });
  }

  stop(): void {
    this.manager?.stop();
  }

  private async onWake(ctx: ModuleContext, config: HeartbeatConfig): Promise<void> {
    await ctx.log(`Heartbeat wake at ${new Date().toISOString()}`);

    const parts: string[] = [
      "[Heartbeat Wake-Up]",
      "",
      `The heartbeat has fired at ${new Date().toISOString()}.`,
      "",
    ];

    if (config.onWake.length > 0) {
      parts.push("Please perform these wake steps:");
      for (const step of config.onWake) {
        parts.push(`- ${step}`);
      }
      parts.push("");
    }

    const routineTasks = this.manager!.checkRoutineTasks();
    if (routineTasks.length > 0) {
      parts.push("The following routine tasks are due:");
      for (const task of routineTasks) {
        parts.push(`- ${task}`);
      }
      parts.push("");
    }

    if (config.contextReconstruction && config.contextReconstruction.length > 0) {
      parts.push("Start by loading these files for context:");
      for (const item of config.contextReconstruction) {
        parts.push(`- ${item}`);
      }
      parts.push("");
    }

    const wakePrompt = parts.join("\n");
    const result = await ctx.prompt(wakePrompt);

    if (result.error) {
      await ctx.log(`Heartbeat wake error: ${result.error}`);
    } else {
      await ctx.log(`Heartbeat wake completed. Response length: ${result.text.length}`);
    }
  }
}
