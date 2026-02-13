import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import type { DWClientDownStream, RobotTextMessage } from "dingtalk-stream";
import type { LifeOSConfig } from "../config.js";
import { resolveUserId } from "./identity.js";
import type { Channel, IncomingMessage } from "./types.js";

/**
 * DingTalk channel using the official Stream Mode SDK.
 * No public IP required — connects outbound via WebSocket.
 */
export class DingTalkChannel implements Channel {
	readonly name = "dingtalk";
	private client: DWClient;
	private handler?: (msg: IncomingMessage) => Promise<void>;
	private config: LifeOSConfig;
	private seenMessages = new Map<string, number>();
	/** Cache sessionWebhook per conversationId for replies. */
	private webhookCache = new Map<string, { url: string; expiry: number }>();

	constructor(config: LifeOSConfig) {
		this.config = config;

		const clientId = config.channels.dingtalk.client_id;
		const clientSecret = config.channels.dingtalk.client_secret;
		if (!clientId || !clientSecret) {
			throw new Error("DingTalk requires DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET");
		}

		this.client = new DWClient({ clientId, clientSecret });

		this.client.registerCallbackListener(TOPIC_ROBOT, (downstream: DWClientDownStream) => {
			// ACK immediately to prevent DingTalk's 60s timeout retry
			this.client.socketCallBackResponse(downstream.headers.messageId, { status: "SUCCESS" });

			// Process asynchronously
			this.processRobotMessage(downstream).catch((err) => {
				console.error("[dingtalk] handler error:", err);
			});
		});
	}

	private async processRobotMessage(downstream: DWClientDownStream): Promise<void> {
		if (!this.handler) return;

		const data = JSON.parse(downstream.data) as RobotTextMessage;

		// Dedup: DingTalk may retry even after ACK in edge cases
		if (this.isDuplicate(data.msgId)) return;

		// Access control
		if (!this.isAllowed(data)) {
			console.log(`[dingtalk] rejected message from ${data.senderNick} (${data.senderId})`);
			return;
		}

		// Cache sessionWebhook for replies
		if (data.sessionWebhook && data.sessionWebhookExpiredTime) {
			this.webhookCache.set(data.conversationId, {
				url: data.sessionWebhook,
				expiry: data.sessionWebhookExpiredTime,
			});
		}

		const text = data.msgtype === "text" ? data.text.content.trim() : "";
		if (!text) return;

		const userId = resolveUserId(this.config, "dingtalk", data.senderStaffId || data.senderId);

		const msg: IncomingMessage = {
			channelName: "dingtalk",
			platformUserId: data.senderStaffId || data.senderId,
			userId,
			channelId: data.conversationId,
			text,
			timestamp: new Date(data.createAt).toISOString(),
		};

		await this.handler(msg);
	}

	private isDuplicate(msgId: string): boolean {
		const now = Date.now();
		// Prune old entries (older than 10 minutes)
		if (this.seenMessages.size > 5000) {
			for (const [id, ts] of this.seenMessages) {
				if (now - ts > 10 * 60 * 1000) this.seenMessages.delete(id);
			}
		}

		if (this.seenMessages.has(msgId)) return true;
		this.seenMessages.set(msgId, now);
		return false;
	}

	private isAllowed(data: RobotTextMessage): boolean {
		const dtConfig = this.config.channels.dingtalk;

		// 1:1 DM: conversationType === "1"
		if (data.conversationType === "1") {
			const allowlist = dtConfig.dm_allowlist;
			if (!allowlist || allowlist.length === 0) return true; // no allowlist = allow all
			return allowlist.includes(data.senderStaffId || data.senderId);
		}

		// Group: conversationType === "2"
		if (data.conversationType === "2") {
			const allowlist = dtConfig.group_allowlist;
			if (!allowlist || allowlist.length === 0) return true;
			return allowlist.includes(data.conversationId);
		}

		return false;
	}

	onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
		this.handler = handler;
	}

	async start(): Promise<void> {
		await this.client.connect();
		console.log("[dingtalk] connected via Stream Mode");
	}

	async stop(): Promise<void> {
		this.client.disconnect();
	}

	async send(conversationId: string, text: string): Promise<void> {
		// Prefer cached sessionWebhook (valid per conversation for a limited time)
		const cached = this.webhookCache.get(conversationId);
		if (cached && Date.now() < cached.expiry) {
			const response = await fetch(cached.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					msgtype: "text",
					text: { content: text },
				}),
			});
			if (response.ok) return;
			console.error("[dingtalk] webhook send failed, falling back to API:", response.status);
		}

		// Fallback: use Open API (requires robotCode, only works for 1:1 DMs)
		const accessToken = await this.client.getAccessToken();
		const response = await fetch("https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-acs-dingtalk-access-token": accessToken,
			},
			body: JSON.stringify({
				robotCode: this.config.channels.dingtalk.robot_code,
				userIds: [conversationId],
				msgKey: "sampleText",
				msgParam: JSON.stringify({ content: text }),
			}),
		});

		if (!response.ok) {
			console.error("[dingtalk] send failed:", response.status, await response.text());
		}
	}
}
