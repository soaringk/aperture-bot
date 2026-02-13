import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getEnvApiKey, getModel } from "@mariozechner/pi-ai";
import type { Channel, IncomingMessage } from "../channel/types.js";
import type { LifeOSConfig } from "../config.js";
import { appendToInbox } from "../state/inbox.js";
import { CHAT_SYSTEM_PROMPT } from "./prompts.js";
import { createTools } from "./tools.js";

/**
 * Per-conversation agent session.
 * Each (userId, channelId) pair gets its own Agent instance to maintain conversation state.
 */
interface Session {
	agent: Agent;
	lastActivity: number;
}

const sessions = new Map<string, Session>();

function sessionKey(userId: string, channelId: string): string {
	return `${userId}:${channelId}`;
}

/** Get or create a session for a given user+channel. */
function getSession(config: LifeOSConfig, userId: string, channelId: string): Session {
	const key = sessionKey(userId, channelId);
	const existing = sessions.get(key);
	if (existing) {
		existing.lastActivity = Date.now();
		return existing;
	}

	const model = getModel(
		config.llm.provider as Parameters<typeof getModel>[0],
		config.llm.model as Parameters<typeof getModel>[1],
	);
	const tools = createTools(config, userId);

	const agent = new Agent({
		initialState: {
			systemPrompt: CHAT_SYSTEM_PROMPT,
			model,
			thinkingLevel: "off",
			tools,
		},
		getApiKey: async (provider: string) => getEnvApiKey(provider),
	});

	const session: Session = { agent, lastActivity: Date.now() };
	sessions.set(key, session);
	return session;
}

/**
 * Handle an incoming message: append to inbox, run agent, return response text.
 */
export async function handleMessage(config: LifeOSConfig, msg: IncomingMessage, channel: Channel): Promise<void> {
	// 1. Append to inbox
	appendToInbox(config, msg.text, `${msg.channelName}:${msg.platformUserId}`, msg.userId);

	// 2. Get or create agent session
	const session = getSession(config, msg.userId, msg.channelId);

	// 3. Collect response text from agent events
	let responseText = "";

	const unsubscribe = session.agent.subscribe((event: AgentEvent) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			for (const part of event.message.content) {
				if (part.type === "text") {
					responseText += part.text;
				}
			}
		}
	});

	try {
		// 4. Run agent with user message
		await session.agent.prompt(msg.text);
		await session.agent.waitForIdle();
	} finally {
		unsubscribe();
	}

	// 5. Send response back through channel
	if (responseText.trim()) {
		await channel.send(msg.channelId, responseText.trim());
	}
}

/** Clean up stale sessions (older than given ms, default 1h). */
export function cleanupSessions(maxAgeMs = 60 * 60 * 1000): void {
	const now = Date.now();
	for (const [key, session] of sessions) {
		if (now - session.lastActivity > maxAgeMs) {
			session.agent.abort();
			sessions.delete(key);
		}
	}
}
