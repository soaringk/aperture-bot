import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type { LifeOSConfig } from "../config.js";
import { resolveUserId } from "./identity.js";
import type { Channel, IncomingMessage } from "./types.js";

export class SlackChannel implements Channel {
	readonly name = "slack";
	private socket: SocketModeClient;
	private web: WebClient;
	private handler?: (msg: IncomingMessage) => Promise<void>;

	constructor(private config: LifeOSConfig) {
		const appToken = config.channels.slack.app_token;
		const botToken = config.channels.slack.bot_token;
		if (!appToken || !botToken) {
			throw new Error("Slack requires SLACK_APP_TOKEN and SLACK_BOT_TOKEN");
		}

		this.socket = new SocketModeClient({ appToken });
		this.web = new WebClient(botToken);

		this.socket.on("message", async ({ event, ack }) => {
			await ack();
			if (!this.handler) return;
			// Ignore bot messages and message_changed events
			if (event.bot_id || event.subtype) return;

			const userId = resolveUserId(this.config, "slack", event.user);

			const msg: IncomingMessage = {
				channelName: "slack",
				platformUserId: event.user,
				userId,
				channelId: event.channel,
				text: event.text ?? "",
				timestamp: event.ts,
			};

			try {
				await this.handler(msg);
			} catch (err) {
				console.error("[slack] handler error:", err);
			}
		});
	}

	onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
		this.handler = handler;
	}

	async start(): Promise<void> {
		await this.socket.start();
		console.log("[slack] connected via Socket Mode");
	}

	async stop(): Promise<void> {
		await this.socket.disconnect();
	}

	async send(channelId: string, text: string): Promise<void> {
		await this.web.chat.postMessage({ channel: channelId, text });
	}
}
