import { Bot } from "grammy";
import type {
  IMessageChannel,
  IMessage,
  ISession,
  MessageHandler,
} from "../types.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("telegram-adapter");

export interface TelegramAdapterOptions {
  botToken: string;
}

/**
 * Telegram message channel using grammY with long polling.
 * No public IP required — the client polls Telegram servers.
 */
export class TelegramAdapter implements IMessageChannel {
  readonly type = "telegram";

  private bot: Bot;
  private handlers: MessageHandler[] = [];
  private started = false;

  constructor(private readonly options: TelegramAdapterOptions) {
    this.bot = new Bot(options.botToken);
  }

  async connect(): Promise<void> {
    // Handle text messages (DM and group)
    this.bot.on("message:text", async (ctx) => {
      try {
        await this.handleInbound(ctx);
      } catch (err) {
        log.error({ err }, "Error processing Telegram message");
      }
    });

    // Handle /start command (required for users to initiate DM)
    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        `Connected. Your chat ID: ${ctx.chat.id}`,
      );
    });

    this.bot.catch((err) => {
      log.error({ err: err.error, ctx: err.ctx?.update?.update_id }, "Telegram bot error");
    });

    // Start long polling (non-blocking)
    this.bot.start({
      onStart: () => {
        this.started = true;
        log.info("Telegram long polling started");
      },
    });
  }

  async disconnect(): Promise<void> {
    if (this.started) {
      await this.bot.stop();
      this.started = false;
    }
    log.info("Telegram bot stopped");
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async sendMessage(session: ISession, text: string): Promise<string> {
    const chatId = Number(session.channelId);
    const result = await this.bot.api.sendMessage(chatId, text, {
      parse_mode: "HTML",
    });
    return String(result.message_id);
  }

  async sendThreadReply(session: ISession, text: string): Promise<string> {
    const chatId = Number(session.channelId);
    const threadId = session.threadId ? Number(session.threadId) : undefined;

    const options: any = { parse_mode: "HTML" };
    if (threadId) {
      options.message_thread_id = threadId;
    }

    const result = await this.bot.api.sendMessage(chatId, text, options);
    return String(result.message_id);
  }

  async updateMessage(
    session: ISession,
    messageId: string,
    text: string,
  ): Promise<void> {
    const chatId = Number(session.channelId);
    await this.bot.api.editMessageText(chatId, Number(messageId), text, {
      parse_mode: "HTML",
    });
  }

  async uploadFile(
    _session: ISession,
    _filePath: string,
    _title?: string,
  ): Promise<void> {
    // File upload deferred — text replies cover MVP
  }

  async setTyping(session: ISession, _active: boolean): Promise<void> {
    try {
      const chatId = Number(session.channelId);
      await this.bot.api.sendChatAction(chatId, "typing");
    } catch {
      // Best-effort, ignore errors
    }
  }

  /**
   * Create a DM session for proactive messages.
   * User must have sent /start to the bot first.
   */
  async createDmSession(chatId: string): Promise<ISession> {
    return {
      sessionId: `telegram:dm:${chatId}`,
      channelType: "telegram",
      channelId: chatId,
      userId: chatId,
    };
  }

  private async handleInbound(ctx: any): Promise<void> {
    const msg = ctx.message;
    if (!msg?.text) return;

    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    const userName = this.resolveUserName(msg.from, userId);

    let text = msg.text;

    // In groups, strip bot mention from text
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    if (isGroup && msg.entities) {
      for (const entity of msg.entities) {
        if (entity.type === "mention") {
          const mention = text.substring(entity.offset, entity.offset + entity.length);
          text = text.replace(mention, "").trim();
        }
      }
    }

    if (!text) return;

    // Thread support for forum-style supergroups
    const threadId = msg.message_thread_id ? String(msg.message_thread_id) : undefined;

    const sessionId = threadId
      ? `telegram:${chatId}:${threadId}`
      : `telegram:${chatId}`;

    const session: ISession = {
      sessionId,
      channelType: "telegram",
      channelId: chatId,
      threadId,
      userId,
    };

    const message: IMessage = {
      id: String(msg.message_id),
      channelId: chatId,
      threadId,
      userId,
      userName,
      text,
      timestamp: msg.date * 1000, // Telegram uses Unix seconds
      raw: msg,
    };

    log.debug(
      { userId, chatType: msg.chat.type, text: text.slice(0, 50) },
      "Incoming Telegram message",
    );

    for (const handler of this.handlers) {
      await handler(message, session);
    }
  }

  private resolveUserName(from: any, fallbackUserId: string): string {
    if (from.username) {
      return from.username;
    }

    const fullName = `${from.first_name || ""} ${from.last_name || ""}`.trim();
    if (fullName) {
      return fullName;
    }

    return fallbackUserId;
  }
}
