import fs from "node:fs/promises";
import path from "node:path";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("events-watcher");

export interface ScheduledEvent {
  id: string;
  type: "immediate" | "one-shot" | "periodic";
  prompt: string;
  channel: string;
  /** For one-shot: ISO datetime to trigger */
  triggerAt?: string;
  /** For periodic: cron expression */
  cron?: string;
  createdAt: string;
  firedAt?: string;
}

/**
 * Watch the user's events/ directory for trigger files.
 * Events are JSON files dropped by the agent or external tools.
 *
 * Types:
 * - immediate: Execute now, delete after
 * - one-shot: Execute at triggerAt, delete after
 * - periodic: Handled by heartbeat engine (moved to HEARTBEAT.md)
 */
export class EventsWatcher {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly eventsDir: string,
    private readonly onEvent: (event: ScheduledEvent) => Promise<void>,
    private readonly pollIntervalMs: number = 30_000,
  ) {}

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
    // Run an initial poll immediately
    this.poll().catch((err) => log.error({ err }, "Initial poll failed"));
    log.info({ eventsDir: this.eventsDir, pollIntervalMs: this.pollIntervalMs }, "Events watcher started");
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll(): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(this.eventsDir);
    } catch {
      return; // Directory doesn't exist yet
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(this.eventsDir, file);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const event: ScheduledEvent = JSON.parse(content);

        if (event.type === "immediate") {
          await this.onEvent(event);
          await fs.unlink(filePath);
          log.info({ eventId: event.id }, "Immediate event processed and removed");
        } else if (event.type === "one-shot" && event.triggerAt) {
          const triggerTime = new Date(event.triggerAt).getTime();
          if (Date.now() >= triggerTime) {
            await this.onEvent(event);
            await fs.unlink(filePath);
            log.info({ eventId: event.id }, "One-shot event triggered and removed");
          }
        }
        // periodic events are not handled here — they should be in HEARTBEAT.md
      } catch (err) {
        log.error({ err, file }, "Failed to process event file");
      }
    }
  }
}
