import { loadReminders, type Reminder } from "../tools/reminder.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("scanner");

export interface ScanResult {
  overdueReminders: Reminder[];
  upcomingReminders: Reminder[];
}

/**
 * Scan user data for actionable items.
 * Used by proactive prompts to enrich context.
 */
export async function scanUserData(remindersDir: string): Promise<ScanResult> {
  const reminders = await loadReminders(remindersDir);
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const active = reminders.filter((r) => !r.completed);
  const overdueReminders = active.filter(
    (r) => r.dueAt && new Date(r.dueAt).getTime() < now,
  );
  const upcomingReminders = active.filter(
    (r) => r.dueAt && new Date(r.dueAt).getTime() >= now && new Date(r.dueAt).getTime() < now + oneDayMs,
  );

  if (overdueReminders.length > 0 || upcomingReminders.length > 0) {
    log.debug(
      { overdue: overdueReminders.length, upcoming: upcomingReminders.length },
      "Scan results",
    );
  }

  return { overdueReminders, upcomingReminders };
}

/** Format scan results as text for injection into proactive prompts */
export function formatScanResults(results: ScanResult): string {
  const parts: string[] = [];

  if (results.overdueReminders.length > 0) {
    parts.push("## Overdue Reminders");
    for (const r of results.overdueReminders) {
      parts.push(`- "${r.text}" (due: ${r.dueAt})`);
    }
  }

  if (results.upcomingReminders.length > 0) {
    parts.push("## Upcoming Reminders (next 24h)");
    for (const r of results.upcomingReminders) {
      parts.push(`- "${r.text}" (due: ${r.dueAt})`);
    }
  }

  return parts.join("\n");
}
