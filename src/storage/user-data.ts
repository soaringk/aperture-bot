import fs from "node:fs/promises";
import path from "node:path";
import { UserPaths } from "./paths.js";
import { parseSoul, parseHeartbeat } from "./soul-loader.js";
import type { SoulData, HeartbeatData } from "./soul-loader.js";
import { StorageError } from "../utils/errors.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("user-data");

const SOUL_TEMPLATE = `---
userId: "{userId}"
agentName: Aperture
language: zh-CN
timezone: Asia/Shanghai
llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
---

You are Aperture, a proactive personal assistant.

Your role is to reduce cognitive load by:
- Tracking tasks, reminders, and deadlines
- Surfacing relevant information at the right time
- Maintaining context across conversations
- Being direct and concise in communication
`;

const HEARTBEAT_TEMPLATE = `---
enabled: true
maxProactivePerDay: 10
quietHours:
  start: "22:00"
  end: "08:00"
---

## Schedules

- id: morning-briefing
  cron: "0 9 * * *"
  channel: slack:DM
  prompt: "Review my reminders and upcoming events. Summarize my day."
`;

/**
 * Initialize a user's data directory with default files.
 */
export async function initUserData(paths: UserPaths): Promise<void> {
  const dirs = [
    paths.root,
    paths.sessionsDir,
    paths.eventsDir,
    paths.remindersDir,
    paths.notesDir,
    paths.historyDir,
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  // Create SOUL.md if it doesn't exist
  if (!(await fileExists(paths.soul))) {
    const userId = path.basename(paths.root);
    await fs.writeFile(
      paths.soul,
      SOUL_TEMPLATE.replace("{userId}", userId),
      "utf-8",
    );
    log.info({ userId }, "Created default SOUL.md");
  }

  // Create HEARTBEAT.md if it doesn't exist
  if (!(await fileExists(paths.heartbeat))) {
    await fs.writeFile(paths.heartbeat, HEARTBEAT_TEMPLATE, "utf-8");
    log.info("Created default HEARTBEAT.md");
  }
}

/** Load and parse SOUL.md for a user */
export async function loadSoul(paths: UserPaths): Promise<SoulData> {
  try {
    const content = await fs.readFile(paths.soul, "utf-8");
    return parseSoul(content);
  } catch (err) {
    throw new StorageError(`Failed to load SOUL.md at ${paths.soul}`, err);
  }
}

/** Load and parse HEARTBEAT.md for a user */
export async function loadHeartbeat(paths: UserPaths): Promise<HeartbeatData> {
  try {
    const content = await fs.readFile(paths.heartbeat, "utf-8");
    return parseHeartbeat(content);
  } catch (err) {
    throw new StorageError(
      `Failed to load HEARTBEAT.md at ${paths.heartbeat}`,
      err,
    );
  }
}

/** Load MEMORY.md content (returns empty string if not found) */
export async function loadMemory(paths: UserPaths): Promise<string> {
  try {
    return await fs.readFile(paths.memory, "utf-8");
  } catch {
    return "";
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
