import fs from "node:fs/promises";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import type { Config } from "../config.js";
import type { UserPaths } from "../storage/paths.js";
import type { SoulData } from "../storage/soul-loader.js";
import { SessionManager, type StoredMessage } from "./session-manager.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("memory-compactor");

const COMPACTION_PROMPT = `You are a memory extraction assistant. Given the conversation below, extract important facts, preferences, decisions, and context that should be remembered long-term.

Rules:
- Output only the new facts as a bullet list (- prefix)
- Be concise — one line per fact
- Include: user preferences, decisions made, important dates, names, relationships, project details
- Exclude: greetings, small talk, transient information, things already in existing memory
- If there's nothing worth remembering, output exactly: [NOTHING_NEW]

## Existing Memory
{existingMemory}

## Recent Conversation
{conversation}

Extract new facts to remember:`;

/**
 * Extract long-term memory from conversation context into MEMORY.md.
 *
 * Called after agent runs when context has grown past a threshold.
 * Uses a lightweight LLM call to summarize what's worth remembering.
 * context.jsonl is never modified — only MEMORY.md is appended to.
 */
export class MemoryCompactor {
  constructor(
    private readonly config: Config,
    private readonly compactionThreshold: number = 30,
  ) {}

  /**
   * Check if compaction is needed and run it if so.
   * Should be called after each agent run.
   */
  async maybeCompact(
    paths: UserPaths,
    soul: SoulData,
    sessionId: string,
    sessionManager: SessionManager,
  ): Promise<void> {
    const allMessages = await sessionManager.loadContext(sessionId);
    if (allMessages.length < this.compactionThreshold) return;

    // Check how many messages haven't been compacted yet.
    // We track this by counting from the last compaction marker.
    const lastCompactionIndex = findLastCompactionMarker(allMessages);
    const uncompactedCount = allMessages.length - lastCompactionIndex - 1;

    if (uncompactedCount < this.compactionThreshold) return;

    log.info(
      { sessionId, total: allMessages.length, uncompacted: uncompactedCount },
      "Running memory compaction",
    );

    // Take the uncompacted messages (but not the most recent ones — they're still "hot")
    const keepRecent = 10;
    const toCompact = allMessages.slice(
      lastCompactionIndex + 1,
      allMessages.length - keepRecent,
    );

    if (toCompact.length === 0) return;

    const existingMemory = await readMemory(paths);
    const conversationText = formatMessagesForCompaction(toCompact);

    const prompt = COMPACTION_PROMPT
      .replace("{existingMemory}", existingMemory || "(empty)")
      .replace("{conversation}", conversationText);

    try {
      const extracted = await this.callLlm(soul, prompt);

      if (extracted.trim() === "[NOTHING_NEW]") {
        log.debug({ sessionId }, "Compaction found nothing new to remember");
      } else {
        await appendMemory(paths, extracted);
        log.info({ sessionId, factsLength: extracted.length }, "Memory updated");
      }

      // Append a compaction marker to context so we don't re-process these messages
      await sessionManager.appendContext(sessionId, {
        role: "_compaction_marker" as any,
        content: `Compacted ${toCompact.length} messages`,
        timestamp: Date.now(),
      });
    } catch (err) {
      log.error({ err, sessionId }, "Memory compaction failed");
    }
  }

  private async callLlm(soul: SoulData, prompt: string): Promise<string> {
    const model = getModel(
      soul.config.llm.provider as any,
      soul.config.llm.model as any,
    );

    const agent = new Agent({
      initialState: {
        systemPrompt: "You extract and summarize important facts from conversations.",
        model,
        thinkingLevel: "off",
      },
      convertToLlm: (messages) =>
        messages.filter((m): m is Message =>
          ["user", "assistant", "toolResult"].includes(m.role),
        ),
      getApiKey: (provider: string) => {
        if (provider === "anthropic") return this.config.anthropicApiKey;
        if (provider === "openai") return this.config.openaiApiKey;
        return undefined;
      },
    });

    let result = "";
    agent.subscribe((event) => {
      if (event.type === "message_update" && "assistantMessageEvent" in event) {
        const ae = event.assistantMessageEvent;
        if (ae.type === "text_delta") {
          result += ae.delta;
        }
      }
    });

    await agent.prompt(prompt);
    await agent.waitForIdle();
    return result.trim();
  }
}

function findLastCompactionMarker(messages: StoredMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "_compaction_marker") return i;
  }
  return -1;
}

function formatMessagesForCompaction(messages: StoredMessage[]): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const content =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? (m.content as any[])
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n")
            : "";
      return `[${m.role}]: ${content}`;
    })
    .join("\n");
}

async function readMemory(paths: UserPaths): Promise<string> {
  try {
    return await fs.readFile(paths.memory, "utf-8");
  } catch {
    return "";
  }
}

async function appendMemory(paths: UserPaths, newFacts: string): Promise<void> {
  const existing = await readMemory(paths);
  const datestamp = new Date().toISOString().slice(0, 10);
  const section = `\n## Extracted ${datestamp}\n${newFacts}\n`;
  await fs.writeFile(paths.memory, existing + section, "utf-8");
}
