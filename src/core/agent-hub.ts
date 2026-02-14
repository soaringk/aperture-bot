import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { Message } from "@mariozechner/pi-ai";
import type { IMessageChannel, IMessage, ISession } from "../channels/types.js";
import type { Config } from "../config.js";
import { UserPaths } from "../storage/paths.js";
import { initUserData, loadSoul, loadMemory } from "../storage/user-data.js";
import type { SoulData } from "../storage/soul-loader.js";
import { appendJsonl } from "../storage/history.js";
import { SessionManager, type StoredMessage } from "./session-manager.js";
import { MessageQueue } from "./message-queue.js";
import { buildSystemPrompt } from "./prompt-builder.js";
import type { HistoryEntry } from "./types.js";
import { createUserTools } from "../tools/registry.js";
import { MemoryCompactor } from "./memory-compactor.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("agent-hub");

interface UserAgent {
  agent: Agent;
  paths: UserPaths;
  soul: SoulData;
  sessionManager: SessionManager;
}

/**
 * Central orchestrator: manages per-user Agent instances,
 * routes messages from channels to agents, and logs everything.
 *
 * History (history/{date}.jsonl) is the single unified log. It records
 * everything: incoming messages, full LLM responses, tool calls with
 * args and results, proactive events, errors. It's the system-of-record.
 *
 * Context (sessions/{id}/context.jsonl) is the append-only conversation
 * record for a single session. Never compacted. Serves as future UI history.
 * Only the tail is fed to the LLM as short-term memory; MEMORY.md provides
 * long-term memory via the system prompt.
 */
export class AgentHub {
  private readonly users = new Map<string, UserAgent>();
  private readonly queue = new MessageQueue();
  private readonly compactor: MemoryCompactor;
  private onNewUser: ((userId: string) => void) | null = null;

  constructor(
    private readonly config: Config,
  ) {
    this.compactor = new MemoryCompactor(config);
  }

  /** Register a callback for when a new user is first seen. */
  setOnNewUser(callback: (userId: string) => void): void {
    this.onNewUser = callback;
  }

  /**
   * Handle an incoming message from any channel.
   * This is the main entry point wired to ChannelRegistry.onMessage().
   */
  async handleMessage(
    message: IMessage,
    session: ISession,
    channel: IMessageChannel,
  ): Promise<void> {
    await this.queue.enqueue(session.sessionId, async () => {
      try {
        await this.processMessage(message, session, channel);
      } catch (err) {
        log.error({ err, sessionId: session.sessionId }, "Failed to process message");
        await this.logHistory(
          new UserPaths(this.config.dataDir, session.userId),
          {
            ts: Date.now(),
            session: session.sessionId,
            event: "error",
            error: err instanceof Error ? err.message : String(err),
          },
        );
        try {
          await channel.sendThreadReply(
            session,
            "Sorry, I encountered an error processing your message.",
          );
        } catch {
          // If we can't even send an error message, just log it
        }
      }
    });
  }

  /**
   * Handle a proactive prompt (triggered by heartbeat/events).
   */
  async handleProactivePrompt(
    userId: string,
    prompt: string,
    session: ISession,
    channel: IMessageChannel,
  ): Promise<void> {
    await this.queue.enqueue(session.sessionId, async () => {
      try {
        await this.logHistory(
          new UserPaths(this.config.dataDir, userId),
          { ts: Date.now(), session: session.sessionId, event: "proactive_trigger", prompt },
        );
        const userAgent = await this.getOrCreateUserAgent(userId);
        await this.runAgent(userAgent, prompt, session, channel, true);
      } catch (err) {
        log.error({ err, userId }, "Failed to process proactive prompt");
      }
    });
  }

  private async processMessage(
    message: IMessage,
    session: ISession,
    channel: IMessageChannel,
  ): Promise<void> {
    const userAgent = await this.getOrCreateUserAgent(session.userId);
    const { paths } = userAgent;

    // Log incoming message to history
    await this.logHistory(paths, {
      ts: message.timestamp,
      session: session.sessionId,
      event: "msg_in",
      userId: message.userId,
      text: message.text,
    });

    await this.runAgent(userAgent, message.text, session, channel, false);
  }

  private async runAgent(
    userAgent: UserAgent,
    input: string,
    session: ISession,
    channel: IMessageChannel,
    isProactive: boolean,
  ): Promise<void> {
    const { agent, paths, soul, sessionManager } = userAgent;

    // Load memory and rebuild system prompt (may have changed since last run)
    const memory = await loadMemory(paths);
    const systemPrompt = buildSystemPrompt(soul, memory);
    agent.setSystemPrompt(systemPrompt);

    // Load recent context as short-term memory for LLM
    const storedMessages = await sessionManager.getRecentContext(session.sessionId);
    const agentMessages = storedMessages.map((m) => deserializeMessage(m));
    agent.replaceMessages(agentMessages);

    // Collect the full response text for sending to channel
    let responseText = "";
    const newMessages: StoredMessage[] = [];

    // Subscribe to events — log everything to history
    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      if (event.type === "message_update" && "assistantMessageEvent" in event) {
        const ae = event.assistantMessageEvent;
        if (ae.type === "text_delta") {
          responseText += ae.delta;
        }
      }
      if (event.type === "message_end") {
        const msg = event.message;
        const serialized = serializeMessage(msg);
        newMessages.push(serialized);

        // Log every message (user, assistant, toolResult) to history
        this.logHistory(paths, {
          ts: serialized.timestamp,
          session: session.sessionId,
          event: "message",
          message: serialized,
        }).catch(() => {});
      }
      if (event.type === "tool_execution_start") {
        this.logHistory(paths, {
          ts: Date.now(),
          session: session.sessionId,
          event: "tool_start",
          tool: event.toolName,
          args: event.args,
        }).catch(() => {});
      }
      if (event.type === "tool_execution_end") {
        this.logHistory(paths, {
          ts: Date.now(),
          session: session.sessionId,
          event: "tool_end",
          tool: event.toolName,
          isError: event.isError,
          result: event.result,
        }).catch(() => {});
      }
    });

    try {
      await agent.prompt(input);
      await agent.waitForIdle();
    } finally {
      unsubscribe();
    }

    // Persist new messages to session context (append-only, never compacted)
    await sessionManager.appendContextBatch(session.sessionId, newMessages);

    // Run memory compaction in background (extracts facts to MEMORY.md)
    this.compactor
      .maybeCompact(paths, soul, session.sessionId, sessionManager)
      .catch((err) => log.error({ err, sessionId: session.sessionId }, "Memory compaction failed"));

    // Handle [SILENT] responses from proactive checks
    const trimmedResponse = responseText.trim();
    if (isProactive && trimmedResponse === "[SILENT]") {
      log.debug({ session: session.sessionId }, "Proactive check: silent response");
      await this.logHistory(paths, {
        ts: Date.now(),
        session: session.sessionId,
        event: "proactive_silent",
      });
      return;
    }

    // Send response to channel
    if (trimmedResponse) {
      const msgId = await channel.sendThreadReply(session, trimmedResponse);
      await this.logHistory(paths, {
        ts: Date.now(),
        session: session.sessionId,
        event: "msg_out",
        text: trimmedResponse,
        messageId: msgId,
      });
    }
  }

  private async getOrCreateUserAgent(userId: string): Promise<UserAgent> {
    const existing = this.users.get(userId);
    if (existing) return existing;

    const paths = new UserPaths(this.config.dataDir, userId);
    await initUserData(paths);

    const soul = await loadSoul(paths);
    const memory = await loadMemory(paths);
    const systemPrompt = buildSystemPrompt(soul, memory);

    const model = getModel(
      soul.config.llm.provider as any,
      soul.config.llm.model as any,
    );

    const tools = createUserTools(paths);

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools,
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

    agent.sessionId = `aperture-${userId}`;
    agent.maxRetryDelayMs = 30_000;

    const userAgent: UserAgent = {
      agent,
      paths,
      soul,
      sessionManager: new SessionManager(paths),
    };

    this.users.set(userId, userAgent);
    log.info({ userId, model: soul.config.llm.model }, "User agent created");

    // Notify server so it can start heartbeat/event watcher for this user
    this.onNewUser?.(userId);

    return userAgent;
  }

  private async logHistory(
    paths: UserPaths,
    entry: HistoryEntry,
  ): Promise<void> {
    try {
      await appendJsonl(paths.historyFile(), entry);
    } catch (err) {
      log.error({ err }, "Failed to log history entry");
    }
  }
}

/** Convert a stored message back to an AgentMessage-compatible object */
function deserializeMessage(stored: StoredMessage): any {
  return { ...stored };
}

/** Serialize an AgentMessage for storage as JSONL */
function serializeMessage(msg: any): StoredMessage {
  return { ...msg, timestamp: msg.timestamp || Date.now() };
}
