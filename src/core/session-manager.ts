import type { UserPaths } from "../storage/paths.js";
import { appendJsonl, readJsonl } from "../storage/history.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("session-manager");

/**
 * Serialized agent message stored in context.jsonl.
 * We store the raw AgentMessage objects from pi-agent-core.
 */
export interface StoredMessage {
  role: string;
  content: unknown;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Manage per-session conversation context.
 *
 * context.jsonl is the full, append-only conversation record for a session.
 * It is never compacted — it serves as the UI conversation history.
 *
 * For LLM calls, only the last N messages are loaded as short-term memory.
 * Long-term memory lives in MEMORY.md (extracted by a separate compaction step).
 */
export class SessionManager {
  constructor(
    private readonly paths: UserPaths,
    private readonly maxContextMessages: number = 50,
  ) {}

  /** Load all context messages for a session */
  async loadContext(sessionId: string): Promise<StoredMessage[]> {
    const contextPath = this.paths.sessionContext(sessionId);
    return readJsonl<StoredMessage>(contextPath);
  }

  /** Append a message to the session context */
  async appendContext(sessionId: string, message: StoredMessage): Promise<void> {
    const contextPath = this.paths.sessionContext(sessionId);
    await appendJsonl(contextPath, message);
  }

  /** Append multiple messages to the session context */
  async appendContextBatch(
    sessionId: string,
    messages: StoredMessage[],
  ): Promise<void> {
    for (const msg of messages) {
      await this.appendContext(sessionId, msg);
    }
  }

  /**
   * Get recent context messages for LLM short-term memory.
   * Returns the last N messages from context.jsonl.
   * MEMORY.md provides long-term memory via the system prompt.
   */
  async getRecentContext(sessionId: string): Promise<StoredMessage[]> {
    const messages = await this.loadContext(sessionId);
    if (messages.length <= this.maxContextMessages) {
      return messages;
    }
    log.debug(
      { sessionId, total: messages.length, window: this.maxContextMessages },
      "Context window applied",
    );
    return messages.slice(-this.maxContextMessages);
  }
}
