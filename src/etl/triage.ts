import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getEnvApiKey, getModel } from "@mariozechner/pi-ai";
import { ETL_SYSTEM_PROMPT } from "../agent/prompts.js";
import { createTools } from "../agent/tools.js";
import type { LifeOSConfig } from "../config.js";
import { clearInbox, parseInboxEntries, readInbox } from "../state/inbox.js";
import { gitAutoCommit } from "../state/markdown.js";

/**
 * Run ETL triage: read unprocessed inbox entries, classify them via LLM,
 * route to structured files, then clear the inbox.
 */
export async function runTriage(config: LifeOSConfig, userId: string): Promise<string> {
	const raw = readInbox(config, userId);
	const entries = parseInboxEntries(raw);

	if (entries.length === 0) {
		return "No inbox entries to triage.";
	}

	const entriesText = entries
		.map((e) => `[${e.timestamp}]${e.source ? ` (${e.source})` : ""}\n${e.text}`)
		.join("\n---\n");

	const model = getModel(
		config.llm.provider as Parameters<typeof getModel>[0],
		config.llm.model as Parameters<typeof getModel>[1],
	);
	const tools = createTools(config, userId);

	const agent = new Agent({
		initialState: {
			systemPrompt: ETL_SYSTEM_PROMPT,
			model,
			thinkingLevel: "off",
			tools,
		},
		getApiKey: async (provider: string) => getEnvApiKey(provider),
	});

	let summary = "";
	const unsubscribe = agent.subscribe((event: AgentEvent) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			for (const part of event.message.content) {
				if (part.type === "text") summary += part.text;
			}
		}
	});

	try {
		await agent.prompt(
			`Here are ${entries.length} inbox entries to triage:\n\n${entriesText}\n\nPlease classify and route each entry to the appropriate file.`,
		);
		await agent.waitForIdle();
	} finally {
		unsubscribe();
	}

	// Clear inbox after successful triage
	clearInbox(config, userId);

	// Auto-commit the changes
	await gitAutoCommit(config, `etl: triage ${entries.length} inbox entries`);

	console.log(`[etl] triaged ${entries.length} entries for user ${userId}`);
	return summary || `Triaged ${entries.length} entries.`;
}
