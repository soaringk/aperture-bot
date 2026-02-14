import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type {
  IMessageChannel,
  IMessage,
  ISession,
  MessageHandler,
} from "../types.js";
import { SlackContext } from "./context.js";
import { SlackUserResolver } from "./user-resolver.js";
import { ChannelError } from "../../utils/errors.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("slack-adapter");

export interface SlackAdapterOptions {
  botToken: string;
  appToken: string;
}

export class SlackAdapter implements IMessageChannel {
  readonly type = "slack";

  private readonly socketMode: SocketModeClient;
  private readonly web: WebClient;
  private readonly ctx: SlackContext;
  private readonly userResolver = new SlackUserResolver();
  private handlers: MessageHandler[] = [];
  private botUserId: string | null = null;

  constructor(options: SlackAdapterOptions) {
    this.web = new WebClient(options.botToken, {
      retryConfig: { retries: 3 },
    });
    this.ctx = new SlackContext(this.web);
    this.socketMode = new SocketModeClient({
      appToken: options.appToken,
      autoReconnectEnabled: true,
    });
  }

  async connect(): Promise<void> {
    // Discover our own user ID so we can ignore self-messages
    this.botUserId = await this.ctx.getBotUserId();
    log.info({ botUserId: this.botUserId }, "Bot user ID resolved");

    // Listen to message events
    this.socketMode.on("event", async ({ event, body, ack }) => {
      await ack();
      try {
        await this.handleEvent(event, body);
      } catch (err) {
        log.error({ err, eventType: event?.type }, "Error handling Slack event");
      }
    });

    // Lifecycle events for observability
    this.socketMode.on("connected", () => {
      log.info("Slack Socket Mode connected");
    });
    this.socketMode.on("disconnected", () => {
      log.warn("Slack Socket Mode disconnected, will auto-reconnect");
    });
    this.socketMode.on("error", (err) => {
      log.error({ err }, "Slack Socket Mode error");
    });

    await this.socketMode.start();
    log.info("Slack Socket Mode started");
  }

  async disconnect(): Promise<void> {
    await this.socketMode.disconnect();
    log.info("Slack Socket Mode disconnected");
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async sendMessage(session: ISession, text: string): Promise<string> {
    return this.ctx.sendMessage(session.channelId, text);
  }

  async sendThreadReply(session: ISession, text: string): Promise<string> {
    if (!session.threadId) {
      throw new ChannelError("No threadId in session for thread reply");
    }
    return this.ctx.sendMessage(session.channelId, text, session.threadId);
  }

  async updateMessage(
    session: ISession,
    messageId: string,
    text: string,
  ): Promise<void> {
    await this.ctx.updateMessage(session.channelId, messageId, text);
  }

  async uploadFile(
    session: ISession,
    filePath: string,
    title?: string,
  ): Promise<void> {
    await this.ctx.uploadFile(
      session.channelId,
      filePath,
      title,
      session.threadId,
    );
  }

  async setTyping(_session: ISession, _active: boolean): Promise<void> {
    // No-op: Slack doesn't support persistent typing indicators for bots
  }

  /**
   * Create a session for proactive messages (e.g., from heartbeat).
   * Opens a DM with the given Slack user ID.
   */
  async createDmSession(slackUserId: string): Promise<ISession> {
    const result = await this.web.conversations.open({ users: slackUserId });
    const channelId = result.channel?.id;
    if (!channelId) {
      throw new ChannelError(`Failed to open DM with ${slackUserId}`);
    }
    const apertureUserId = this.userResolver.resolve(slackUserId);
    return {
      sessionId: `slack:${channelId}`,
      channelType: "slack",
      channelId,
      userId: apertureUserId,
    };
  }

  private async handleEvent(event: any, _body: any): Promise<void> {
    if (!event) return;

    // Handle message events and app_mention events
    if (event.type === "message" || event.type === "app_mention") {
      await this.handleMessageEvent(event);
    }
  }

  private async handleMessageEvent(event: any): Promise<void> {
    // Ignore bot's own messages
    if (event.bot_id || event.user === this.botUserId) return;
    // Ignore message subtypes (edits, deletes, etc.) except thread_broadcast
    if (event.subtype && event.subtype !== "thread_broadcast") return;

    const apertureUserId = this.userResolver.resolve(event.user);

    // Strip bot mention from text for app_mention events
    let text = event.text || "";
    if (event.type === "app_mention" && this.botUserId) {
      text = text.replace(new RegExp(`<@${this.botUserId}>\\s*`, "g"), "").trim();
    }

    const threadId = event.thread_ts || event.ts;
    const session: ISession = {
      sessionId: `slack:${event.channel}:${threadId}`,
      channelType: "slack",
      channelId: event.channel,
      threadId,
      userId: apertureUserId,
    };

    const message: IMessage = {
      id: event.ts,
      channelId: event.channel,
      threadId: event.thread_ts,
      userId: apertureUserId,
      userName: event.user, // Slack user ID; could resolve display name later
      text,
      timestamp: parseFloat(event.ts) * 1000,
      raw: event,
    };

    log.debug(
      { userId: message.userId, channelId: message.channelId, text: text.slice(0, 50) },
      "Incoming message",
    );

    for (const handler of this.handlers) {
      await handler(message, session);
    }
  }
}
