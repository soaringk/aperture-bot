import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("reminder-tool");

export interface Reminder {
  id: string;
  text: string;
  dueAt?: string; // ISO 8601 datetime
  createdAt: string;
  completed: boolean;
}

// --- Create Reminder ---

const CreateReminderParams = Type.Object({
  text: Type.String({ description: "Reminder text" }),
  dueAt: Type.Optional(
    Type.String({ description: "Due date/time in ISO 8601 format (e.g. 2024-03-15T09:00:00)" }),
  ),
});

export function createCreateReminderTool(
  remindersDir: string,
): AgentTool<typeof CreateReminderParams> {
  return {
    name: "create_reminder",
    label: "Create Reminder",
    description: "Create a new reminder with optional due date.",
    parameters: CreateReminderParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof CreateReminderParams>,
    ): Promise<AgentToolResult<{ id: string }>> => {
      await fs.mkdir(remindersDir, { recursive: true });
      const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const reminder: Reminder = {
        id,
        text: params.text,
        dueAt: params.dueAt,
        createdAt: new Date().toISOString(),
        completed: false,
      };
      await fs.writeFile(
        path.join(remindersDir, `${id}.json`),
        JSON.stringify(reminder, null, 2),
        "utf-8",
      );
      const msg = params.dueAt
        ? `Reminder created: "${params.text}" (due: ${params.dueAt})`
        : `Reminder created: "${params.text}"`;
      return {
        content: [{ type: "text", text: msg }],
        details: { id },
      };
    },
  };
}

// --- List Reminders ---

const ListRemindersParams = Type.Object({
  includeCompleted: Type.Optional(
    Type.Boolean({ description: "Include completed reminders", default: false }),
  ),
});

export function createListRemindersTool(
  remindersDir: string,
): AgentTool<typeof ListRemindersParams> {
  return {
    name: "list_reminders",
    label: "List Reminders",
    description: "List active reminders. Optionally include completed ones.",
    parameters: ListRemindersParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof ListRemindersParams>,
    ): Promise<AgentToolResult<{ count: number }>> => {
      const reminders = await loadReminders(remindersDir);
      const filtered = params.includeCompleted
        ? reminders
        : reminders.filter((r) => !r.completed);

      if (filtered.length === 0) {
        return {
          content: [{ type: "text", text: "No reminders found." }],
          details: { count: 0 },
        };
      }

      const lines = filtered.map((r) => {
        const status = r.completed ? "[done]" : r.dueAt ? `[due: ${r.dueAt}]` : "[no due date]";
        return `- ${status} ${r.text} (id: ${r.id})`;
      });
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { count: filtered.length },
      };
    },
  };
}

// --- Complete Reminder ---

const CompleteReminderParams = Type.Object({
  id: Type.String({ description: "Reminder ID to mark as completed" }),
});

export function createCompleteReminderTool(
  remindersDir: string,
): AgentTool<typeof CompleteReminderParams> {
  return {
    name: "complete_reminder",
    label: "Complete Reminder",
    description: "Mark a reminder as completed.",
    parameters: CompleteReminderParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof CompleteReminderParams>,
    ): Promise<AgentToolResult<{ id: string }>> => {
      const filePath = path.join(remindersDir, `${params.id}.json`);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const reminder: Reminder = JSON.parse(content);
        reminder.completed = true;
        await fs.writeFile(filePath, JSON.stringify(reminder, null, 2), "utf-8");
        return {
          content: [{ type: "text", text: `Reminder completed: "${reminder.text}"` }],
          details: { id: params.id },
        };
      } catch {
        throw new Error(`Reminder not found: ${params.id}`);
      }
    },
  };
}

/** Load all reminders from the reminders directory */
export async function loadReminders(remindersDir: string): Promise<Reminder[]> {
  try {
    const files = await fs.readdir(remindersDir);
    const reminders: Reminder[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs.readFile(path.join(remindersDir, file), "utf-8");
        reminders.push(JSON.parse(content));
      } catch {
        log.warn({ file }, "Failed to parse reminder file");
      }
    }
    return reminders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}
