import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import type {
  IMessageChannel,
  IMessage,
  ISession,
  MessageHandler,
} from "../types.js";
import {
  sendBySessionWebhook,
  sendProactiveMessage,
  type DingTalkApiOptions,
} from "./api.js";
import { registerPeerId, resolveOriginalPeerId } from "./peer-id-registry.js";
import { ChannelError } from "../../utils/errors.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("dingtalk-adapter");

export interface DingTalkAdapterOptions {
  clientId: string;
  clientSecret: string;
  robotCode?: string;
}

/** Inbound message from DingTalk Stream API */
interface DingTalkInboundMessage {
  msgId: string;
  msgtype: string;
  text?: { content: string };
  content?: {
    richText?: Array<{ type: string; text?: string }>;
  };
  conversationType: string; // '1' = DM, '2' = Group
  conversationId: string;
  conversationTitle?: string;
  senderId: string;
  senderStaffId?: string;
  senderNick?: string;
  chatbotUserId: string;
  sessionWebhook: string;
  createAt: number;
}

/**
 * DingTalk message channel using the Stream API (WebSocket).
 * No public IP required — the client connects outward to DingTalk servers.
 */
export class DingTalkAdapter implements IMessageChannel {
  readonly type = "dingtalk";

  private client: DWClient | null = null;
  private readonly apiOpts: DingTalkApiOptions;
  private handlers: MessageHandler[] = [];
  private botUserId: string | null = null;

  /** In-memory dedup: msgId → timestamp. Prevents duplicate processing on DingTalk retries. */
  private readonly processedMessages = new Map<string, number>();
  private dedupCounter = 0;

  /** sessionWebhook cache: sessionId → webhook URL (valid for ~2h per DingTalk docs) */
  private readonly sessionWebhooks = new Map<string, string>();

  constructor(private readonly options: DingTalkAdapterOptions) {
    this.apiOpts = {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      robotCode: options.robotCode,
    };
  }

  async connect(): Promise<void> {
    this.client = new DWClient({
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      debug: false,
      keepAlive: true,
    });

    this.client.registerCallbackListener(
      TOPIC_ROBOT,
      async (res: any) => {
        const messageId = res.headers?.messageId;
        try {
          if (messageId) {
            this.client!.socketCallBackResponse(messageId, { success: true });
          }
          const data = JSON.parse(res.data) as DingTalkInboundMessage;
          await this.handleInbound(data, messageId);
        } catch (err) {
          log.error({ err, messageId }, "Error processing DingTalk message");
        }
      },
    );

    await this.client.connect();
    log.info("DingTalk Stream connected");
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    log.info("DingTalk Stream disconnected");
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async sendMessage(session: ISession, text: string): Promise<string> {
    return this.sendReply(session, text);
  }

  async sendThreadReply(session: ISession, text: string): Promise<string> {
    return this.sendReply(session, text);
  }

  async updateMessage(
    _session: ISession,
    _messageId: string,
    _text: string,
  ): Promise<void> {
    // DingTalk doesn't support editing messages via bot API
  }

  async uploadFile(
    _session: ISession,
    _filePath: string,
    _title?: string,
  ): Promise<void> {
    // Media upload deferred — text replies cover MVP
  }

  async setTyping(_session: ISession, _active: boolean): Promise<void> {
    // No typing indicator in DingTalk bot API
  }

  /**
   * Create a session for proactive messages to a DM user.
   * Unlike Slack, DingTalk proactive messages use staffId directly.
   */
  async createDmSession(staffId: string): Promise<ISession> {
    return {
      sessionId: `dingtalk:dm:${staffId}`,
      channelType: "dingtalk",
      channelId: staffId,
      userId: staffId,
    };
  }

  private async sendReply(session: ISession, text: string): Promise<string> {
    const webhook = this.sessionWebhooks.get(session.sessionId);
    if (webhook) {
      await sendBySessionWebhook(this.apiOpts, webhook, text);
    } else {
      // Fallback to proactive message API
      const isGroup = session.channelId.startsWith("cid");
      const target = resolveOriginalPeerId(session.channelId);
      await sendProactiveMessage(this.apiOpts, target, isGroup, text);
    }
    return `dt_${Date.now()}`;
  }

  private async handleInbound(
    data: DingTalkInboundMessage,
    fallbackMessageId?: string,
  ): Promise<void> {
    // Ignore own messages
    if (data.senderId === data.chatbotUserId) return;
    this.botUserId = data.chatbotUserId;

    // Dedup
    const msgId = data.msgId || fallbackMessageId;
    if (msgId && this.isDedup(msgId)) return;
    if (msgId) this.markDedup(msgId);

    // Register case-sensitive conversationId
    registerPeerId(data.conversationId);

    // Extract text
    const text = this.extractText(data);
    if (!text) return;

    const isDm = data.conversationType === "1";
    const channelId = data.conversationId;

    // Use conversationId as sessionId. DingTalk doesn't have threads — each conversation is a session.
    const sessionId = `dingtalk:${channelId}`;
    const session: ISession = {
      sessionId,
      channelType: "dingtalk",
      channelId,
      userId: data.senderStaffId || data.senderId,
    };

    // Cache the sessionWebhook for replies
    if (data.sessionWebhook) {
      this.sessionWebhooks.set(sessionId, data.sessionWebhook);
    }

    const message: IMessage = {
      id: data.msgId || `dt_${Date.now()}`,
      channelId,
      userId: data.senderStaffId || data.senderId,
      userName: data.senderNick || data.senderId,
      text,
      timestamp: data.createAt || Date.now(),
      raw: data,
    };

    log.debug(
      { userId: message.userId, conversationType: data.conversationType, text: text.slice(0, 50) },
      "Incoming DingTalk message",
    );

    for (const handler of this.handlers) {
      await handler(message, session);
    }
  }

  private extractText(data: DingTalkInboundMessage): string {
    // Plain text message
    if (data.text?.content) {
      return data.text.content.trim();
    }

    // Rich text message
    if (data.content?.richText) {
      return data.content.richText
        .filter((item) => item.type === "text" && item.text)
        .map((item) => item.text!)
        .join("")
        .trim();
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
