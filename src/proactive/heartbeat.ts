import { Cron } from "croner";
import type { Config } from "../config.js";
import { UserPaths } from "../storage/paths.js";
import { loadHeartbeat } from "../storage/user-data.js";
import type { HeartbeatData, Schedule } from "../storage/soul-loader.js";
import type { AgentHub } from "../core/agent-hub.js";
import type { ISession, IMessageChannel } from "../channels/types.js";
import type { ChannelRegistry } from "../channels/registry.js";
import { SlackAdapter } from "../channels/slack/adapter.js";
import { DingTalkAdapter } from "../channels/dingtalk/adapter.js";
import { FeishuAdapter } from "../channels/feishu/adapter.js";
import { TelegramAdapter } from "../channels/telegram/adapter.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("heartbeat");

interface HeartbeatRunner {
  userId: string;
  jobs: Cron[];
  proactiveCountToday: number;
  lastResetDate: string;
}

/**
 * Proactive engine: parses HEARTBEAT.md, registers cron jobs,
 * and triggers agent prompts on schedule.
 */
export class HeartbeatEngine {
  private readonly runners = new Map<string, HeartbeatRunner>();

  constructor(
    private readonly config: Config,
    private readonly agentHub: AgentHub,
    private readonly channels: ChannelRegistry,
  ) {}

  /** Start heartbeat for a user. Call after user data is initialized. */
  async startUser(userId: string): Promise<void> {
    if (this.runners.has(userId)) return;

    const paths = new UserPaths(this.config.dataDir, userId);
    let data: HeartbeatData;
    try {
      data = await loadHeartbeat(paths);
    } catch (err) {
      log.warn({ err, userId }, "Failed to load HEARTBEAT.md, skipping");
      return;
    }

    if (!data.config.enabled) {
      log.info({ userId }, "Heartbeat disabled for user");
      return;
    }

    const runner: HeartbeatRunner = {
      userId,
      jobs: [],
      proactiveCountToday: 0,
      lastResetDate: todayStr(),
    };

    for (const schedule of data.schedules) {
      const job = this.createJob(userId, schedule, data.config);
      runner.jobs.push(job);
      log.info({ userId, scheduleId: schedule.id, cron: schedule.cron }, "Cron job registered");
    }

    this.runners.set(userId, runner);
    log.info({ userId, jobCount: runner.jobs.length }, "Heartbeat started");
  }

  /** Stop heartbeat for a user */
  stopUser(userId: string): void {
    const runner = this.runners.get(userId);
    if (!runner) return;
    for (const job of runner.jobs) {
      job.stop();
    }
    this.runners.delete(userId);
    log.info({ userId }, "Heartbeat stopped");
  }

  /** Stop all heartbeats */
  stopAll(): void {
    for (const userId of [...this.runners.keys()]) {
      this.stopUser(userId);
    }
  }

  private createJob(
    userId: string,
    schedule: Schedule,
    heartbeatConfig: HeartbeatData["config"],
  ): Cron {
    return new Cron(schedule.cron, async () => {
      try {
        await this.executeSchedule(userId, schedule, heartbeatConfig);
      } catch (err) {
        log.error({ err, userId, scheduleId: schedule.id }, "Schedule execution failed");
      }
    });
  }

  private async executeSchedule(
    userId: string,
    schedule: Schedule,
    heartbeatConfig: HeartbeatData["config"],
  ): Promise<void> {
    const runner = this.runners.get(userId);
    if (!runner) return;

    // Reset daily counter
    const today = todayStr();
    if (runner.lastResetDate !== today) {
      runner.proactiveCountToday = 0;
      runner.lastResetDate = today;
    }

    // Check daily limit
    if (runner.proactiveCountToday >= heartbeatConfig.maxProactivePerDay) {
      log.debug({ userId, scheduleId: schedule.id }, "Daily proactive limit reached");
      return;
    }

    // Check quiet hours
    if (isQuietHours(heartbeatConfig.quietHours)) {
      log.debug({ userId, scheduleId: schedule.id }, "In quiet hours, skipping");
      return;
    }

    // Resolve channel and create session
    const { channel, session } = await this.resolveChannelSession(userId, schedule.channel);
    if (!channel || !session) {
      log.warn({ userId, channelSpec: schedule.channel }, "Cannot resolve channel for schedule");
      return;
    }

    log.info({ userId, scheduleId: schedule.id }, "Executing proactive schedule");
    runner.proactiveCountToday++;

    await this.agentHub.handleProactivePrompt(userId, schedule.prompt, session, channel);
  }

  /**
   * Parse channel spec (e.g. "slack:DM" or "slack:C12345") and create session.
   */
  private async resolveChannelSession(
    userId: string,
    channelSpec: string,
  ): Promise<{ channel: IMessageChannel | undefined; session: ISession | undefined }> {
    const [channelType, target] = channelSpec.split(":");
    const channel = this.channels.get(channelType);
    if (!channel) return { channel: undefined, session: undefined };

    // For DM targets, delegate to the adapter's createDmSession method
    if (target === "DM") {
      const session = await this.createDmForChannel(channel, userId);
      return { channel, session };
    }

    // For explicit channel IDs, construct session directly
    const session: ISession = {
      sessionId: `${channelType}:${target}:proactive`,
      channelType,
      channelId: target,
      userId,
    };
    return { channel, session };
  }

  /**
   * Create a DM session using the appropriate adapter method.
   */
  private async createDmForChannel(
    channel: IMessageChannel,
    userId: string,
  ): Promise<ISession | undefined> {
    if (channel instanceof SlackAdapter) {
      return channel.createDmSession(userId);
    }

    if (channel instanceof DingTalkAdapter) {
      return channel.createDmSession(userId);
    }

    if (channel instanceof FeishuAdapter) {
      return channel.createDmSession(userId);
    }

    if (channel instanceof TelegramAdapter) {
      return channel.createDmSession(userId);
    }

    return undefined;
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isQuietHours(quiet: { start: string; end: string }): boolean {
  const now = new Date();
  const [startH, startM] = quiet.start.split(":").map(Number);
  const [endH, endM] = quiet.end.split(":").map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same day range (e.g., 08:00 - 22:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 22:00 - 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
