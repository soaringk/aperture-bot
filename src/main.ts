import { cleanupSessions, handleMessage } from "./agent/runner.js";
import { DingTalkChannel } from "./channel/dingtalk.js";
import { SlackChannel } from "./channel/slack.js";
import type { Channel } from "./channel/types.js";
import { loadConfig } from "./config.js";
import { startScheduler, stopScheduler } from "./etl/scheduler.js";
import { initPara } from "./state/para.js";

async function main(): Promise<void> {
	const config = loadConfig();
	console.log(`[lifeos] root: ${config.lifeos_root}`);

	// Initialize PARA structure for default user
	initPara(config);
	console.log(`[lifeos] PARA initialized for user '${config.default_user}'`);

	// Start channels
	const channels = new Map<string, Channel>();

	if (config.channels.slack.enabled) {
		const slack = new SlackChannel(config);
		slack.onMessage(async (msg) => handleMessage(config, msg, slack));
		await slack.start();
		channels.set("slack", slack);
	}

	if (config.channels.dingtalk.enabled) {
		const dingtalk = new DingTalkChannel(config);
		dingtalk.onMessage(async (msg) => handleMessage(config, msg, dingtalk));
		await dingtalk.start();
		channels.set("dingtalk", dingtalk);
	}

	if (channels.size === 0) {
		console.log("[lifeos] no channels enabled — running in headless mode (ETL/reconciliation only)");
	}

	// Start scheduler (ETL + reconciliation)
	startScheduler({ config, channels });

	// Periodic session cleanup (every 30 minutes)
	const cleanupInterval = setInterval(() => cleanupSessions(), 30 * 60 * 1000);

	// Graceful shutdown
	const shutdown = async () => {
		console.log("\n[lifeos] shutting down...");
		clearInterval(cleanupInterval);
		stopScheduler();
		for (const [name, channel] of channels) {
			try {
				await channel.stop();
				console.log(`[lifeos] ${name} disconnected`);
			} catch (err) {
				console.error(`[lifeos] error stopping ${name}:`, err);
			}
		}
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	console.log("[lifeos] running. Press Ctrl+C to stop.");
}

main().catch((err) => {
	console.error("[lifeos] fatal:", err);
	process.exit(1);
});
