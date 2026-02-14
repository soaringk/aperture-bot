import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { ConfigError } from "./utils/errors.js";

const ConfigSchema = z.object({
  // Slack (optional — omit to disable)
  slackBotToken: z.string().optional(),
  slackAppToken: z.string().optional(),

  // DingTalk (optional — omit to disable)
  dingtalkClientId: z.string().optional(),
  dingtalkClientSecret: z.string().optional(),
  dingtalkRobotCode: z.string().optional(),

  // Feishu/Lark (optional — omit to disable)
  feishuAppId: z.string().optional(),
  feishuAppSecret: z.string().optional(),
  feishuDomain: z.enum(["feishu", "lark"]).default("feishu"),

  // Telegram (optional — omit to disable)
  telegramBotToken: z.string().optional(),

  // LLM
  anthropicApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),

  // Data
  dataDir: z.string().default("./data"),

  // Logging
  logLevel: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  loadDotenv();

  const result = ConfigSchema.safeParse({
    slackBotToken: process.env.SLACK_BOT_TOKEN || undefined,
    slackAppToken: process.env.SLACK_APP_TOKEN || undefined,
    dingtalkClientId: process.env.DINGTALK_CLIENT_ID || undefined,
    dingtalkClientSecret: process.env.DINGTALK_CLIENT_SECRET || undefined,
    dingtalkRobotCode: process.env.DINGTALK_ROBOT_CODE || undefined,
    feishuAppId: process.env.FEISHU_APP_ID || undefined,
    feishuAppSecret: process.env.FEISHU_APP_SECRET || undefined,
    feishuDomain: process.env.FEISHU_DOMAIN || "feishu",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    dataDir: process.env.DATA_DIR || "./data",
    logLevel: process.env.LOG_LEVEL || "info",
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }

  // At least one channel must be configured
  const channels = [
    { name: "Slack", configured: result.data.slackBotToken && result.data.slackAppToken },
    { name: "DingTalk", configured: result.data.dingtalkClientId && result.data.dingtalkClientSecret },
    { name: "Feishu", configured: result.data.feishuAppId && result.data.feishuAppSecret },
    { name: "Telegram", configured: !!result.data.telegramBotToken },
  ];

  const hasAnyChannel = channels.some((ch) => ch.configured);
  if (!hasAnyChannel) {
    const channelNames = channels.map((ch) => ch.name).join(", ");
    throw new ConfigError(
      `At least one channel must be configured (${channelNames})`,
    );
  }

  // At least one LLM key must be set
  if (!result.data.anthropicApiKey && !result.data.openaiApiKey) {
    throw new ConfigError(
      "At least one LLM API key must be set (ANTHROPIC_API_KEY or OPENAI_API_KEY)",
    );
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/** Reset cached config (for testing) */
export function resetConfig(): void {
  cachedConfig = null;
}
