import * as lark from "@larksuiteoapi/node-sdk";
import type {
  IMessageChannel,
  IMessage,
  ISession,
  MessageHandler,
} from "../types.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("feishu-adapter");

export interface FeishuAdapterOptions {
  appId: string;
  appSecret: string;
  /** "feishu" for China, "lark" for international. Default: "feishu" */
  domain?: "feishu" | "lark";
}

/** Lark/Feishu im.message.receive_v1 event payload */
interface FeishuMessageEvent {
  sender: {
    sender_id: {
      open_id: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type: string;
    tenant_key: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: string; // "p2p" (DM) or "group"
    message_type: string; // "text", "post", "image", etc.
    content: string; // JSON string
    mentions?: Array<{
      key: string;
      id: { open_id: string; user_id?: string; union_id?: string };
      name: string;
      tenant_key: string;
    }>;
  };
}

/**
 * Feishu/Lark message channel using WebSocket long connection (WSClient).
 * No public IP required — the client connects outward to Feishu servers.
 */
export class FeishuAdapter implements IMessageChannel {
  readonly type = "feishu";

  private client: lark.Client;
  private wsClient: lark.WSClient | null = null;
  private handlers: MessageHandler[] = [];

  /** In-memory dedup: messageId → timestamp */
  private readonly processedMessages = new Map<string, number>();
  private dedupCounter = 0;

  constructor(private readonly options: FeishuAdapterOptions) {
    const domain =
      options.domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;

    this.client = new lark.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain,
      appType: lark.AppType.SelfBuild,
    });
  }

  async connect(): Promise<void> {
    const domain =
      this.options.domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;

    const eventDispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: any) => {
        try {
          await this.handleInbound(data);
        } catch (err) {
          log.error({ err }, "Error processing Feishu message");
        }
      },
    });

    this.wsClient = new lark.WSClient({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
      domain,
    });

    await this.wsClient.start({ eventDispatcher });
    log.info("Feishu WebSocket connected");
  }

  async disconnect(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    log.info("Feishu WebSocket disconnected");
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async sendMessage(session: ISession, text: string): Promise<string> {
    const res = await this.client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: session.channelId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    return res?.data?.message_id ?? `feishu_${Date.now()}`;
  }

  async sendThreadReply(session: ISession, text: string): Promise<string> {
    if (session.threadId) {
      const res = await this.client.im.v1.message.reply({
        path: { message_id: session.threadId },
        data: {
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });
      return res?.data?.message_id ?? `feishu_${Date.now()}`;
    }
    return this.sendMessage(session, text);
  }

  async updateMessage(
    _session: ISession,
    messageId: string,
    text: string,
  ): Promise<void> {
    await this.client.im.v1.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify({ text }),
      },
    });
  }

  async uploadFile(
    _session: ISession,
    _filePath: string,
    _title?: string,
  ): Promise<void> {
    // File upload deferred — text replies cover MVP
  }

  async setTyping(_session: ISession, _active: boolean): Promise<void> {
    // Feishu does not support typing indicators for bots
  }

  /**
   * Create a DM session for proactive messages.
   * Uses open_id to send directly to a user.
   */
  async createDmSession(openId: string): Promise<ISession> {
    return {
      sessionId: `feishu:dm:${openId}`,
      channelType: "feishu",
      channelId: openId,
      userId: openId,
    };
  }

  /**
   * Send proactive DM using open_id instead of chat_id.
   */
  async sendProactiveDm(openId: string, text: string): Promise<string> {
    const res = await this.client.im.v1.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: openId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    return res?.data?.message_id ?? `feishu_${Date.now()}`;
  }

  private async handleInbound(data: FeishuMessageEvent): Promise<void> {
    const msg = data.message;

    // Dedup
    if (this.isDedup(msg.message_id)) return;
    this.markDedup(msg.message_id);

    // Extract text
    const text = this.extractText(msg.message_type, msg.content, msg.mentions);
    if (!text) return;

    const senderId = data.sender.sender_id.open_id;
    const chatId = msg.chat_id;

    const sessionId = `feishu:${chatId}`;
    const session: ISession = {
      sessionId,
      channelType: "feishu",
      channelId: chatId,
      userId: senderId,
    };

    const message: IMessage = {
      id: msg.message_id,
      channelId: chatId,
      userId: senderId,
      userName: senderId, // Feishu events don't include display name; open_id is used
      text,
      timestamp: Number(msg.create_time) || Date.now(),
      raw: data,
    };

    log.debug(
      { userId: senderId, chatType: msg.chat_type, text: text.slice(0, 50) },
      "Incoming Feishu message",
    );

    for (const handler of this.handlers) {
      await handler(message, session);
    }
  }

  private extractText(
    msgType: string,
    content: string,
    mentions?: FeishuMessageEvent["message"]["mentions"],
  ): string {
    try {
      const parsed = JSON.parse(content);

      if (msgType === "text") {
        let text = (parsed.text as string) ?? "";
        // Strip @mention tags (format: @_user_N)
        if (mentions?.length) {
          for (const mention of mentions) {
            text = text.replace(mention.key, "").trim();
          }
        }
        return text.trim();
      }

      if (msgType === "post") {
        // Rich text — extract text segments from all paragraphs
        const title = parsed.title ?? "";
        const segments: string[] = title ? [title] : [];
        // Post content is localized: { zh_cn: { title, content: [[{tag,text}]] } }
        const locales = Object.values(parsed) as any[];
        for (const locale of locales) {
          if (!locale?.content) continue;
          for (const paragraph of locale.content) {
            if (!Array.isArray(paragraph)) continue;
            for (const seg of paragraph) {
              if (seg.tag === "text" && seg.text) {
                segments.push(seg.text);
              }
            }
          }
        }
        return segments.join(" ").trim();
      }
    } catch {
      log.warn({ msgType, content: content.slice(0, 100) }, "Failed to parse message content");
    }

    return "";
  }

  private isDedup(msgId: string): boolean {
    return this.processedMessages.has(msgId);
  }

  private markDedup(msgId: string): void {
    this.processedMessages.set(msgId, Date.now());
    this.dedupCounter++;

    // Lazy cleanup every 50 messages
    if (this.dedupCounter % 50 === 0) {
      const cutoff = Date.now() - 60_000;
      for (const [key, ts] of this.processedMessages) {
        if (ts < cutoff) this.processedMessages.delete(key);
      }
    }
  }
}
