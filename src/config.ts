import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import "dotenv/config";

export interface QuietHours {
	start: string; // "HH:mm"
	end: string;
	timezone: string;
}

export interface LifeOSConfig {
	lifeos_root: string;
	default_user: string;

	llm: {
		provider: string;
		model: string;
	};

	channels: {
		slack: {
			enabled: boolean;
			app_token?: string;
			bot_token?: string;
		};
		dingtalk: {
			enabled: boolean;
			client_id?: string;
			client_secret?: string;
			robot_code?: string;
			dm_allowlist?: string[];
			group_allowlist?: string[];
		};
	};

	/** Maps (channelName, platformUserId) → LifeOS userId */
	identity: Record<string, Record<string, string>>;

	etl: {
		triage_cron: string;
		reconcile_cron: string;
	};

	notify: {
		primary_channel: string;
		quiet_hours: QuietHours;
	};
}

const DEFAULTS: LifeOSConfig = {
	lifeos_root: "./life-os",
	default_user: "default",
	llm: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
	channels: {
		slack: { enabled: false },
		dingtalk: { enabled: false },
	},
	identity: {},
	etl: {
		triage_cron: "0 */4 * * *",
		reconcile_cron: "*/15 * * * *",
	},
	notify: {
		primary_channel: "slack",
		quiet_hours: { start: "23:00", end: "07:00", timezone: "Asia/Shanghai" },
	},
};

export function loadConfig(configPath?: string): LifeOSConfig {
	const path = configPath ?? process.env.LIFEOS_CONFIG ?? "./config/lifeos.json";
	const resolved = resolve(path);

	let fileConfig: Partial<LifeOSConfig> = {};
	if (existsSync(resolved)) {
		fileConfig = JSON.parse(readFileSync(resolved, "utf-8"));
	}

	const config = deepMerge(
		DEFAULTS as unknown as Record<string, unknown>,
		fileConfig as unknown as Record<string, unknown>,
	) as unknown as LifeOSConfig;

	// Override with env vars where available
	if (process.env.SLACK_APP_TOKEN) {
		config.channels.slack.app_token = process.env.SLACK_APP_TOKEN;
	}
	if (process.env.SLACK_BOT_TOKEN) {
		config.channels.slack.bot_token = process.env.SLACK_BOT_TOKEN;
	}
	if (process.env.DINGTALK_CLIENT_ID) {
		config.channels.dingtalk.client_id = process.env.DINGTALK_CLIENT_ID;
	}
	if (process.env.DINGTALK_CLIENT_SECRET) {
		config.channels.dingtalk.client_secret = process.env.DINGTALK_CLIENT_SECRET;
	}
	if (process.env.DINGTALK_ROBOT_CODE) {
		config.channels.dingtalk.robot_code = process.env.DINGTALK_ROBOT_CODE;
	}

	// Resolve lifeos_root to absolute path
	config.lifeos_root = resolve(config.lifeos_root);

	return config;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		const sv = source[key];
		const tv = target[key];
		if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
			result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
		} else {
			result[key] = sv;
		}
	}
	return result;
}
