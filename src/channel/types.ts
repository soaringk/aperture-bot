export interface Attachment {
	type: "image" | "file" | "voice";
	url?: string;
	data?: string; // base64 for inline content
	mimeType?: string;
	filename?: string;
}

export interface IncomingMessage {
	channelName: string; // "slack" | "dingtalk"
	platformUserId: string; // Raw platform user ID
	userId: string; // Resolved LifeOS user ID
	channelId: string; // Platform channel/conversation ID
	text: string;
	attachments?: Attachment[];
	timestamp: string;
}

export interface Channel {
	readonly name: string;
	start(): Promise<void>;
	stop(): Promise<void>;
	onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
	send(channelId: string, text: string): Promise<void>;
}
