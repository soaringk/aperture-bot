import type { AgentTool } from "@mariozechner/pi-agent-core";
import { UserPaths } from "../storage/paths.js";
import { createBashTool } from "./bash.js";
import {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createListFilesTool,
} from "./filesystem.js";
import {
  createCreateReminderTool,
  createListRemindersTool,
  createCompleteReminderTool,
} from "./reminder.js";

/**
 * Create the full set of tools for a user, scoped to their data directory.
 */
export function createUserTools(paths: UserPaths): AgentTool<any>[] {
  return [
    createBashTool(paths.root),
    createReadFileTool(paths.root),
    createWriteFileTool(paths.root),
    createEditFileTool(paths.root),
    createListFilesTool(paths.root),
    createCreateReminderTool(paths.remindersDir),
    createListRemindersTool(paths.remindersDir),
    createCompleteReminderTool(paths.remindersDir),
  ];
}
