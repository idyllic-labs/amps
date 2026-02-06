import { existsSync } from "fs";
import { getDaemonPidPath } from "../shared/config.ts";
import { logger } from "../shared/logger.ts";

/**
 * Manages daemon process lifecycle (PID file, start/stop/status)
 */
export class ProcessManager {
  private pidPath: string;

  constructor() {
    this.pidPath = getDaemonPidPath();
  }

  /**
   * Check if daemon is running
   */
  async status(): Promise<{ running: boolean; pid?: number }> {
    if (!existsSync(this.pidPath)) {
      return { running: false };
    }

    try {
      const pidContent = await Bun.file(this.pidPath).text();
      const pid = parseInt(pidContent.trim(), 10);

      // Check if process exists
      try {
        process.kill(pid, 0); // Signal 0 checks existence without killing
        return { running: true, pid };
      } catch {
        // Process doesn't exist, clean up stale PID file
        await this.cleanupPidFile();
        return { running: false };
      }
    } catch (error) {
      logger.error("Failed to read PID file:", error);
      return { running: false };
    }
  }

  /**
   * Start daemon process
   */
  async start(daemonScript: string): Promise<void> {
    const status = await this.status();

    if (status.running) {
      throw new Error(`Daemon already running (PID: ${status.pid})`);
    }

    // Spawn daemon as detached background process
    const proc = Bun.spawn(["bun", "run", daemonScript], {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    });

    // Write PID to file
    await Bun.write(this.pidPath, proc.pid.toString());

    // Unref so parent can exit
    proc.unref();

    logger.info(`Daemon started (PID: ${proc.pid})`);
  }

  /**
   * Stop daemon process
   */
  async stop(): Promise<void> {
    const status = await this.status();

    if (!status.running || !status.pid) {
      throw new Error("Daemon not running");
    }

    // Send SIGTERM for graceful shutdown
    try {
      process.kill(status.pid, "SIGTERM");
      logger.info(`Sent SIGTERM to daemon (PID: ${status.pid})`);

      // Wait for process to exit (max 5 seconds)
      for (let i = 0; i < 50; i++) {
        await Bun.sleep(100);
        try {
          process.kill(status.pid, 0);
        } catch {
          // Process exited
          break;
        }
      }

      // Force kill if still running
      try {
        process.kill(status.pid, 0);
        logger.warn("Daemon didn't exit gracefully, sending SIGKILL");
        process.kill(status.pid, "SIGKILL");
      } catch {
        // Already exited
      }

      await this.cleanupPidFile();
    } catch (error) {
      logger.error("Failed to stop daemon:", error);
      throw error;
    }
  }

  /**
   * Clean up PID file
   */
  private async cleanupPidFile(): Promise<void> {
    if (existsSync(this.pidPath)) {
      await Bun.$`rm ${this.pidPath}`;
    }
  }
}
