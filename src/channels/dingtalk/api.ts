import axios from "axios";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("dingtalk-api");

/** Cached access tokens per clientId */
const tokenCache = new Map<string, { token: string; expiry: number }>();

export interface DingTalkApiOptions {
  clientId: string;
  clientSecret: string;
  robotCode?: string;
}

/** Get or refresh an OAuth2 access token */
export async function getAccessToken(opts: DingTalkApiOptions): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(opts.clientId);
  if (cached && cached.expiry > now + 60_000) {
    return cached.token;
  }

  const res = await axios.post<{ accessToken: string; expireIn: number }>(
    "https://api.dingtalk.com/v1.0/oauth2/accessToken",
    { appKey: opts.clientId, appSecret: opts.clientSecret },
  );

  tokenCache.set(opts.clientId, {
    token: res.data.accessToken,
    expiry: now + res.data.expireIn * 1000,
  });

  log.debug("Access token refreshed");
  return res.data.accessToken;
}

/** Send a reply via the session webhook (works for both DM and group) */
export async function sendBySessionWebhook(
  opts: DingTalkApiOptions,
  sessionWebhook: string,
  text: string,
  atUserId?: string,
): Promise<void> {
  const token = await getAccessToken(opts);

  // Use markdown for anything that looks like it has formatting
  const useMarkdown = /[*_#\[\]`>-]/.test(text);
  let body: Record<string, unknown>;

  if (useMarkdown) {
    const title = text.split("\n")[0].slice(0, 30) || "Aperture";
    let finalText = text;
    if (atUserId) finalText += ` @${atUserId}`;
    body = { msgtype: "markdown", markdown: { title, text: finalText } };
  } else {
    body = { msgtype: "text", text: { content: text } };
  }

  if (atUserId) {
    body.at = { atUserIds: [atUserId], isAtAll: false };
  }

  await axios.post(sessionWebhook, body, {
    headers: {
      "x-acs-dingtalk-access-token": token,
      "Content-Type": "application/json",
    },
  });
}

/** Send a proactive message (no sessionWebhook, uses OpenAPI) */
export async function sendProactiveMessage(
  opts: DingTalkApiOptions,
  target: string,
  isGroup: boolean,
  text: string,
): Promise<void> {
  const token = await getAccessToken(opts);
  const robotCode = opts.robotCode || opts.clientId;

  const useMarkdown = /[*_#\[\]`>-]/.test(text);
  const msgKey = useMarkdown ? "sampleMarkdown" : "sampleText";
  const msgParam = useMarkdown
    ? JSON.stringify({ title: "Aperture", text })
    : JSON.stringify({ content: text });

  const url = isGroup
    ? "https://api.dingtalk.com/v1.0/robot/groupMessages/send"
    : "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend";

  const data: Record<string, unknown> = { robotCode, msgKey, msgParam };
  if (isGroup) {
    data.openConversationId = target;
  } else {
    data.userIds = [target];
  }

  await axios.post(url, data, {
    headers: { "x-acs-dingtalk-access-token": token },
  });
}
