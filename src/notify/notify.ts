import type { Channel } from "../channel/types.js";
import type { LifeOSConfig, QuietHours } from "../config.js";
import type { Alert } from "../etl/reconcile.js";

/** Check if current time is within quiet hours. */
function isQuietHours(qh: QuietHours): boolean {
	const now = new Date();
	// Get current time in the configured timezone
	const timeStr = now.toLocaleTimeString("en-GB", { timeZone: qh.timezone, hour12: false });
	const [h, m] = timeStr.split(":").map(Number);
	const currentMinutes = h * 60 + m;

	const [sh, sm] = qh.start.split(":").map(Number);
	const [eh, em] = qh.end.split(":").map(Number);
	const startMinutes = sh * 60 + sm;
	const endMinutes = eh * 60 + em;

	// Handle overnight quiet hours (e.g., 23:00 - 07:00)
	if (startMinutes > endMinutes) {
		return currentMinutes >= startMinutes || currentMinutes < endMinutes;
	}
	return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/** Format alerts into a human-readable notification. */
function formatAlerts(alerts: Alert[]): string {
	if (alerts.length === 0) return "";

	const lines = alerts.map((a) => {
		const icon = a.priority === "high" ? "[!]" : a.priority === "medium" ? "[~]" : "[.]";
		const action = a.action ? ` → ${a.action}` : "";
		return `${icon} ${a.category}: ${a.description}${action}`;
	});

	return `LifeOS Reconciliation:\n${lines.join("\n")}`;
}

/**
 * Send alert notifications through the configured primary channel.
 * Respects quiet hours.
 */
export async function sendAlerts(
	config: LifeOSConfig,
	alerts: Alert[],
	channels: Map<string, Channel>,
	targetChannelId: string,
): Promise<void> {
	if (alerts.length === 0) return;

	// Filter out low-priority alerts during quiet hours
	const qh = config.notify.quiet_hours;
	const quiet = isQuietHours(qh);

	const filteredAlerts = quiet ? alerts.filter((a) => a.priority === "high") : alerts;

	if (filteredAlerts.length === 0) return;

	const text = formatAlerts(filteredAlerts);

	const channel = channels.get(config.notify.primary_channel);
	if (!channel) {
		console.error(`[notify] primary channel '${config.notify.primary_channel}' not available`);
		return;
	}

	try {
		await channel.send(targetChannelId, text);
	} catch (err) {
		console.error("[notify] failed to send alert:", err);
	}
}
