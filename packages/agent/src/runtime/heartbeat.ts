import type { HeartbeatConfig } from "../types/index.ts";

/**
 * Heartbeat manager - handles scheduled agent wake-ups
 */
export class HeartbeatManager {
	private config: HeartbeatConfig;
	private intervalId?: Timer;
	private onWakeCallback?: () => Promise<void>;

	constructor(config: HeartbeatConfig) {
		this.config = config;
	}

	/**
	 * Start the heartbeat scheduler
	 */
	start(onWake: () => Promise<void>): void {
		this.onWakeCallback = onWake;

		const intervalMs = this.parseSchedule(this.config.schedule);

		console.log(`Starting heartbeat with interval: ${intervalMs}ms (${this.config.schedule})`);

		// Execute immediately on start
		this.wake();

		// Schedule periodic execution
		this.intervalId = setInterval(() => {
			this.wake();
		}, intervalMs);
	}

	/**
	 * Stop the heartbeat scheduler
	 */
	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
	}

	/**
	 * Manually trigger a wake event
	 */
	async wake(): Promise<void> {
		const timestamp = new Date().toISOString();
		console.log(`[${timestamp}] Agent wake-up`);

		if (this.onWakeCallback) {
			try {
				await this.onWakeCallback();
			} catch (error) {
				console.error("Error during wake callback:", error);
			}
		}
	}

	/**
	 * Parse schedule string to milliseconds
	 * Supports: @every:Xm, @every:Xh, @every:Xs
	 */
	private parseSchedule(schedule: string): number {
		const match = schedule.match(/^@every:\s*(\d+)([smh])$/);

		if (!match) {
			console.warn(`Invalid schedule format: ${schedule}, defaulting to 15m`);
			return 15 * 60 * 1000;
		}

		const value = parseInt(match[1]);
		const unit = match[2];

		switch (unit) {
			case "s":
				return value * 1000;
			case "m":
				return value * 60 * 1000;
			case "h":
				return value * 60 * 60 * 1000;
			default:
				return 15 * 60 * 1000;
		}
	}

	/**
	 * Get wake steps from config
	 */
	getWakeSteps(): string[] {
		return this.config.onWake;
	}

	/**
	 * Check if any routine tasks should run now
	 */
	checkRoutineTasks(): string[] {
		const now = new Date();
		const tasks: string[] = [];

		for (const task of this.config.routineTasks) {
			if (this.shouldRunRoutineTask(task.schedule, now)) {
				tasks.push(task.description);
			}
		}

		return tasks;
	}

	/**
	 * Simple schedule matching for routine tasks
	 * Supports: "Every morning at HH:MM", "Every hour", "Every evening at HH:MM"
	 */
	private shouldRunRoutineTask(schedule: string, now: Date): boolean {
		const lowerSchedule = schedule.toLowerCase();

		// "Every hour" - run at minute 0
		if (lowerSchedule.includes("every hour")) {
			return now.getMinutes() === 0;
		}

		// "Every morning at HH:MM"
		const morningMatch = lowerSchedule.match(/every morning at (\d{2}):(\d{2})/);
		if (morningMatch) {
			const hour = parseInt(morningMatch[1]);
			const minute = parseInt(morningMatch[2]);
			return now.getHours() === hour && now.getMinutes() === minute;
		}

		// "Every evening at HH:MM"
		const eveningMatch = lowerSchedule.match(/every evening at (\d{2}):(\d{2})/);
		if (eveningMatch) {
			const hour = parseInt(eveningMatch[1]);
			const minute = parseInt(eveningMatch[2]);
			return now.getHours() === hour && now.getMinutes() === minute;
		}

		return false;
	}
}
