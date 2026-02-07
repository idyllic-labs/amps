import { type Component, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.ts";

export type WorkflowStatus = "running" | "complete" | "error";

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class WorkflowFooter implements Component {
  private frameIndex = 0;
  private animationInterval?: ReturnType<typeof setInterval>;
  private status: WorkflowStatus = "running";
  private startTime: number;
  private workflowName: string;
  private model: string;

  constructor(
    workflowName: string,
    model: string,
    private onUpdate: () => void,
  ) {
    this.workflowName = workflowName;
    this.model = model;
    this.startTime = Date.now();
  }

  setStatus(status: WorkflowStatus) {
    this.status = status;
  }

  setModel(model: string) {
    this.model = model;
  }

  startAnimation() {
    if (this.animationInterval) return;
    this.startTime = Date.now();
    this.animationInterval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % spinnerFrames.length;
      this.onUpdate();
    }, 80);
  }

  stopAnimation() {
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
      this.animationInterval = undefined;
    }
  }

  invalidate(): void {
    this.frameIndex = (this.frameIndex + 1) % spinnerFrames.length;
  }

  private formatElapsed(): string {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }

  render(width: number): string[] {
    const separator = `${theme.muted}${"─".repeat(width)}${theme.reset}`;

    // Left side
    let leftSide: string;
    if (this.status === "running") {
      const spinner = spinnerFrames[this.frameIndex];
      leftSide = `${theme.accent}${spinner}${theme.reset} ${theme.accent}Running${theme.reset}  ${this.workflowName}`;
    } else if (this.status === "complete") {
      leftSide = `${theme.success}✓${theme.reset} ${theme.success}Complete${theme.reset}  ${this.workflowName}`;
    } else {
      leftSide = `${theme.error}✖${theme.reset} ${theme.error}Error${theme.reset}  ${this.workflowName}`;
    }

    // Right side: model + elapsed
    const rightSide = `${theme.muted}${this.model}${theme.reset}  ${theme.muted}${this.formatElapsed()}${theme.reset}`;

    const leftVisible = visibleWidth(leftSide);
    const rightVisible = visibleWidth(rightSide);
    const padding = Math.max(2, width - leftVisible - rightVisible - 1);

    const statusLine = " " + leftSide + " ".repeat(padding) + rightSide;

    return [separator, statusLine];
  }
}
