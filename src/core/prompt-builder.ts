import type { SoulData } from "../storage/soul-loader.js";

/**
 * Build the system prompt for the LLM from SOUL.md body and MEMORY.md.
 */
export function buildSystemPrompt(soul: SoulData, memory: string): string {
  const parts: string[] = [];

  // Core identity and instructions from SOUL.md
  parts.push(soul.body);

  // Inject memory context if available
  if (memory.trim()) {
    parts.push("");
    parts.push("## Long-term Memory");
    parts.push(memory.trim());
  }

  // Inject current timestamp for time-awareness
  parts.push("");
  parts.push(`## Current Time`);
  parts.push(`The current time is: ${new Date().toISOString()}`);
  parts.push(`Timezone: ${soul.config.timezone}`);

  return parts.join("\n");
}
