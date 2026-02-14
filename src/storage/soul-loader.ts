import matter from "gray-matter";
import { z } from "zod";

const SoulFrontmatterSchema = z.object({
  userId: z.string().default("default"),
  agentName: z.string().default("Aperture"),
  language: z.string().default("zh-CN"),
  timezone: z.string().default("Asia/Shanghai"),
  llm: z
    .object({
      provider: z.string().default("anthropic"),
      model: z.string().default("claude-sonnet-4-20250514"),
    })
    .default({}),
});

export type SoulConfig = z.infer<typeof SoulFrontmatterSchema>;

export interface SoulData {
  config: SoulConfig;
  /** The freeform personality/instructions body (Markdown) */
  body: string;
}

const HeartbeatFrontmatterSchema = z.object({
  enabled: z.boolean().default(true),
  maxProactivePerDay: z.number().default(10),
  quietHours: z
    .object({
      start: z.string().default("22:00"),
      end: z.string().default("08:00"),
    })
    .default({}),
});

export type HeartbeatConfig = z.infer<typeof HeartbeatFrontmatterSchema>;

const ScheduleSchema = z.object({
  id: z.string(),
  cron: z.string(),
  channel: z.string(),
  prompt: z.string(),
});

export type Schedule = z.infer<typeof ScheduleSchema>;

export interface HeartbeatData {
  config: HeartbeatConfig;
  schedules: Schedule[];
}

/** Parse SOUL.md content into config + body */
export function parseSoul(content: string): SoulData {
  const { data, content: body } = matter(content);
  const config = SoulFrontmatterSchema.parse(data);
  return { config, body: body.trim() };
}

/** Parse HEARTBEAT.md content into config + schedules */
export function parseHeartbeat(content: string): HeartbeatData {
  const { data, content: body } = matter(content);
  const config = HeartbeatFrontmatterSchema.parse(data);
  const schedules = parseSchedules(body);
  return { config, schedules };
}

/**
 * Parse schedule list from HEARTBEAT.md body.
 * Expects YAML-like list items under "## Schedules":
 *   - id: morning-briefing
 *     cron: "0 9 * * *"
 *     channel: slack:DM
 *     prompt: "..."
 */
function parseSchedules(body: string): Schedule[] {
  const schedules: Schedule[] = [];
  // Match blocks starting with "- id:" and collecting subsequent indented key-value lines
  const blockRegex = /^- id:\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(body)) !== null) {
    const id = match[1].trim();
    const startIndex = match.index + match[0].length;
    // Collect subsequent indented lines (key: value pairs)
    const remaining = body.slice(startIndex);
    const lines = remaining.split("\n");
    const fields: Record<string, string> = { id };

    for (const line of lines) {
      const kvMatch = line.match(/^\s+([\w]+):\s*"?(.+?)"?\s*$/);
      if (!kvMatch) break;
      fields[kvMatch[1]] = kvMatch[2];
    }

    const result = ScheduleSchema.safeParse(fields);
    if (result.success) {
      schedules.push(result.data);
    }
  }

  return schedules;
}
