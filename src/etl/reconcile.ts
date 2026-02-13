import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getEnvApiKey, getModel } from "@mariozechner/pi-ai";
import { RECONCILE_SYSTEM_PROMPT } from "../agent/prompts.js";
import { createTools } from "../agent/tools.js";
import type { LifeOSConfig } from "../config.js";

export interface Alert {
	priority: "high" | "medium" | "low";
	category: string;
	description: string;
	action: string;
}

/**
 * Run reconciliation: compare desired state vs reality, return alerts.
 */
export async function runReconcile(config: LifeOSConfig, userId: string): Promise<Alert[]> {
	const model = getModel(
		config.llm.provider as Parameters<typeof getModel>[0],
		config.llm.model as Parameters<typeof getModel>[1],
	);
	const tools = createTools(config, userId);

	const agent = new Agent({
		initialState: {
			systemPrompt: RECONCILE_SYSTEM_PROMPT,
			model,
			thinkingLevel: "off",
			tools,
		},
		getApiKey: async (provider: string) => getEnvApiKey(provider),
	});

	let responseText = "";
	const unsubscribe = agent.subscribe((event: AgentEvent) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			for (const part of event.message.content) {
				if (part.type === "text") responseText += part.text;
			}
		}
	});

	try {
		const now = new Date().toISOString();
		await agent.prompt(
			`Current time: ${now}\n\nPlease review active projects and areas for items needing attention. Read the relevant files and report any alerts.`,
		);
		await agent.waitForIdle();
	} finally {
		unsubscribe();
	}

	return parseAlerts(responseText);
}

/** Best-effort parse of LLM alert output into structured alerts. */
function parseAlerts(text: string): Alert[] {
	const alerts: Alert[] = [];
	const lines = text.split("\n").filter((l) => l.trim());

	for (const line of lines) {
		const match = line.match(
			/^\s*[-*]?\s*\*?\*?\[?(high|medium|low)\]?\*?\*?\s*[—\-:]\s*\*?\*?\[?([\w/]+)\]?\*?\*?\s*[—\-:]\s*(.+)/i,
		);
		if (match) {
			const rest = match[3].split(/\s*[—\-]\s*Suggested?:?\s*/i);
			alerts.push({
				priority: match[1].toLowerCase() as Alert["priority"],
				category: match[2].toLowerCase(),
				description: rest[0].trim(),
				action: rest[1]?.trim() ?? "",
			});
		}
	}

	// If structured parsing fails, create a single alert with the full text
	if (alerts.length === 0 && text.trim()) {
		alerts.push({
			priority: "medium",
			category: "general",
			description: text.trim().slice(0, 500),
			action: "",
		});
	}

	return alerts;
}
