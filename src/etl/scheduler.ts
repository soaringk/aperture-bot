import { Cron } from "croner";
import type { Channel } from "../channel/types.js";
import type { LifeOSConfig } from "../config.js";
import { sendAlerts } from "../notify/notify.js";
import { runReconcile } from "./reconcile.js";
import { runTriage } from "./triage.js";

const jobs: Cron[] = [];

export interface SchedulerContext {
	config: LifeOSConfig;
	channels: Map<string, Channel>;
	/** Channel ID to send reconciliation alerts to (configured per user). */
	alertChannelId?: string;
}

/**
 * Start ETL and reconciliation cron jobs.
 * Currently runs for the default user only.
 */
export function startScheduler(ctx: SchedulerContext): void {
	const userId = ctx.config.default_user;

	// ETL triage job
	const triageJob = new Cron(ctx.config.etl.triage_cron, async () => {
		console.log(`[scheduler] running triage for user ${userId}`);
		try {
			const summary = await runTriage(ctx.config, userId);
			console.log(`[scheduler] triage complete: ${summary}`);
		} catch (err) {
			console.error("[scheduler] triage failed:", err);
		}
	});
	jobs.push(triageJob);
	console.log(`[scheduler] triage scheduled: ${ctx.config.etl.triage_cron}`);

	// Reconciliation job
	const reconcileJob = new Cron(ctx.config.etl.reconcile_cron, async () => {
		console.log(`[scheduler] running reconciliation for user ${userId}`);
		try {
			const alerts = await runReconcile(ctx.config, userId);
			if (alerts.length > 0 && ctx.alertChannelId) {
				await sendAlerts(ctx.config, alerts, ctx.channels, ctx.alertChannelId);
			}
		} catch (err) {
			console.error("[scheduler] reconciliation failed:", err);
		}
	});
	jobs.push(reconcileJob);
	console.log(`[scheduler] reconciliation scheduled: ${ctx.config.etl.reconcile_cron}`);
}

/** Stop all scheduled jobs. */
export function stopScheduler(): void {
	for (const job of jobs) {
		job.stop();
	}
	jobs.length = 0;
	console.log("[scheduler] all jobs stopped");
}
