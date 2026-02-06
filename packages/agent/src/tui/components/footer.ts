import { type Component, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.ts";

export interface FooterStats {
  modelId?: string;
  provider?: string;
  sessionName?: string;
  workingMessage?: string; // Shows spinner when set
  thinkingLevel?: string;
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class FooterComponent implements Component {
  private frameIndex = 0;
  private animationInterval?: NodeJS.Timeout;

  constructor(private getStats: () => FooterStats, private onUpdate?: () => void) {}

  startAnimation() {
    if (this.animationInterval) return;
    this.animationInterval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % spinnerFrames.length;
      this.onUpdate?.();
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

  render(width: number): string[] {
    const stats = this.getStats();

    // Left side: working status or "Idle"
    let leftSide: string;
    if (stats.workingMessage) {
      const spinner = spinnerFrames[this.frameIndex];
      leftSide = `${theme.accent}${spinner}${theme.reset} ${theme.muted}${stats.workingMessage}${theme.reset}`;
    } else {
      leftSide = `${theme.muted}Idle${theme.reset}`;
    }

    // Right side: model • session • thinking
    const rightParts: string[] = [];

    if (stats.modelId) {
      if (stats.provider) {
        rightParts.push(`${stats.provider}/${stats.modelId}`);
      } else {
        rightParts.push(stats.modelId);
      }
    }

    if (stats.sessionName) {
      rightParts.push(`session: ${stats.sessionName}`);
    }

    if (stats.thinkingLevel) {
      rightParts.push(stats.thinkingLevel);
    }

    const rightSide = rightParts.join(" • ");

    // Calculate padding
    const leftVisible = visibleWidth(leftSide);
    const rightVisible = visibleWidth(rightSide);
    const padding = Math.max(0, width - leftVisible - rightVisible);

    const line = leftSide + " ".repeat(padding) + `${theme.muted}${rightSide}${theme.reset}`;
    return [line];
  }
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}
