import type { IMessageChannel, MessageHandler, IMessage, ISession } from "./types.js";
import { ChannelError } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("channel-registry");

/**
 * Registry of active message channels.
 * Routes incoming messages to a single shared handler.
 */
export class ChannelRegistry {
  private readonly channels = new Map<string, IMessageChannel>();
  private handler: MessageHandler | null = null;

  register(channel: IMessageChannel): void {
    if (this.channels.has(channel.type)) {
      throw new ChannelError(`Channel type "${channel.type}" already registered`);
    }
    this.channels.set(channel.type, channel);
    channel.onMessage((msg, session) => this.dispatch(msg, session));
    log.info({ type: channel.type }, "Channel registered");
  }

  get(type: string): IMessageChannel | undefined {
    return this.channels.get(type);
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async connectAll(): Promise<void> {
    for (const [type, channel] of this.channels) {
      log.info({ type }, "Connecting channel");
      await channel.connect();
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [type, channel] of this.channels) {
      log.info({ type }, "Disconnecting channel");
      await channel.disconnect();
    }
  }

  private async dispatch(message: IMessage, session: ISession): Promise<void> {
    if (!this.handler) {
      log.warn("No message handler registered, dropping message");
      return;
    }
    try {
      await this.handler(message, session);
    } catch (err) {
      log.error({ err, sessionId: session.sessionId }, "Message handler error");
    }
  }
}
