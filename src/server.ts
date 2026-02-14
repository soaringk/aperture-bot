import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import { ChannelRegistry } from "./channels/registry.js";
import { SlackAdapter } from "./channels/slack/adapter.js";
import { DingTalkAdapter } from "./channels/dingtalk/adapter.js";
import { AgentHub } from "./core/agent-hub.js";
import { HeartbeatEngine } from "./proactive/heartbeat.js";
import { EventsWatcher } from "./proactive/events-watcher.js";
import { UserPaths } from "./storage/paths.js";
import { createChildLogger } from "./utils/logger.js";

const log = createChildLogger("server");

export class Server {
  private readonly channels: ChannelRegistry;
  private readonly agentHub: AgentHub;
  private readonly heartbeat: HeartbeatEngine;
  private readonly eventWatchers: EventsWatcher[] = [];
  private readonly activeProactiveUsers = new Set<string>();
  private running = false;

  constructor(private readonly config: Config) {
    this.channels = new ChannelRegistry();
    this.agentHub = new AgentHub(config);
    this.heartbeat = new HeartbeatEngine(config, this.agentHub, this.channels);

    // Start proactive systems when a new user first messages
    this.agentHub.setOnNewUser((userId) => {
      this.startProactiveForUser(userId).catch((err) =>
        log.error({ err, userId }, "Failed to start proactive for new user"),
      );
    });

    // Register channels based on config
    if (config.slackBotToken && config.slackAppToken) {
      const slack = new SlackAdapter({
        botToken: config.slackBotToken,
        appToken: config.slackAppToken,
      });
      this.channels.register(slack);
      log.info("Slack channel configured");
    }

    if (config.dingtalkClientId && config.dingtalkClientSecret) {
      const dingtalk = new DingTalkAdapter({
        clientId: config.dingtalkClientId,
        clientSecret: config.dingtalkClientSecret,
        robotCode: config.dingtalkRobotCode,
      });
      this.channels.register(dingtalk);
      log.info("DingTalk channel configured");
    }

    // Wire channel messages to agent hub
    this.channels.onMessage(async (message, session) => {
      const channel = this.channels.get(session.channelType);
      if (!channel) {
        log.error({ channelType: session.channelType }, "Unknown channel type");
        return;
      }
      await this.agentHub.handleMessage(message, session, channel);
    });
  }

  async start(): Promise<void> {
    if (this.running) return;

    log.info("Starting Aperture-Bot server...");
    await this.channels.connectAll();

    // Start heartbeat and event watchers for existing users
    await this.startProactiveForExistingUsers();

    this.running = true;
    log.info("Aperture-Bot server is running");

    // Handle graceful shutdown
    const shutdown = async () => {
      log.info("Shutting down...");
      await this.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.heartbeat.stopAll();
    for (const watcher of this.eventWatchers) {
      watcher.stop();
    }
    await this.channels.disconnectAll();
    this.running = false;
    log.info("Server stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start heartbeat + event watcher for a single user.
   * Idempotent — skips if already active.
   */
  private async startProactiveForUser(userId: string): Promise<void> {
    if (this.activeProactiveUsers.has(userId)) return;
    this.activeProactiveUsers.add(userId);

    await this.heartbeat.startUser(userId);

    const paths = new UserPaths(this.config.dataDir, userId);
    const watcher = new EventsWatcher(paths.eventsDir, async (event) => {
      const channel = this.channels.get(event.channel.split(":")[0]);
      if (!channel) return;
      const session = {
        sessionId: `${event.channel}:event_${event.id}`,
        channelType: event.channel.split(":")[0],
        channelId: event.channel.split(":")[1] || "",
        userId,
      };
      await this.agentHub.handleProactivePrompt(userId, event.prompt, session, channel);
    });
    watcher.start();
    this.eventWatchers.push(watcher);

    log.info({ userId }, "Proactive systems started for user");
  }

  /**
   * Discover existing users in DATA_DIR/users/ and start
   * heartbeat schedules + event watchers for each.
   */
  private async startProactiveForExistingUsers(): Promise<void> {
    const usersDir = path.join(this.config.dataDir, "users");
    let userIds: string[];
    try {
      userIds = await fs.readdir(usersDir);
    } catch {
      log.info("No users directory found, skipping proactive startup");
      return;
    }

    for (const userId of userIds) {
      try {
        await this.startProactiveForUser(userId);
      } catch (err) {
        log.error({ err, userId }, "Failed to start proactive for user");
      }
    }
  }
}
