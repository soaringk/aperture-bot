import type { WebClient } from "@slack/web-api";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("slack-context");

/**
 * Thin wrappers around Slack WebClient calls.
 * Centralizes error handling and logging for Slack API interactions.
 */
export class SlackContext {
  constructor(private readonly web: WebClient) {}

  async sendMessage(channel: string, text: string, threadTs?: string): Promise<string> {
    const result = await this.web.chat.postMessage({
      channel,
      text,
      thread_ts: threadTs,
    });
    log.debug({ channel, ts: result.ts }, "Message sent");
    return result.ts as string;
  }

  async updateMessage(channel: string, ts: string, text: string): Promise<void> {
    await this.web.chat.update({ channel, ts, text });
    log.debug({ channel, ts }, "Message updated");
  }

  async uploadFile(
    channels: string,
    filePath: string,
    title?: string,
    threadTs?: string,
  ): Promise<void> {
    const fs = await import("node:fs");
    const content = fs.readFileSync(filePath);
    const args: Record<string, unknown> = {
      channel_id: channels,
      file: content,
      filename: title || filePath.split("/").pop() || "file",
      title,
    };
    if (threadTs) args.thread_ts = threadTs;
    await this.web.filesUploadV2(args as any);
    log.debug({ channels, filePath }, "File uploaded");
  }

  async setTyping(channel: string): Promise<void> {
    // Slack doesn't have a persistent typing indicator API for bots.
    // The closest is to not send anything — the typing indicator shows
    // while the bot is "processing." We treat this as a no-op.
  }

  /** Get bot's own user ID */
  async getBotUserId(): Promise<string> {
    const result = await this.web.auth.test();
    return result.user_id as string;
  }
}
