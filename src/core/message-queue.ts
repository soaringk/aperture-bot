import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("message-queue");

type WorkFn = () => Promise<void>;

/**
 * Per-session work queue that serializes agent runs.
 * Prevents concurrent agent.prompt() calls on the same session.
 *
 * Adapted from pi-mom's message queue pattern.
 */
export class MessageQueue {
  private readonly queues = new Map<string, Promise<void>>();

  /**
   * Enqueue work for a session. If work is already in progress for this session,
   * the new work waits until the previous completes.
   */
  async enqueue(sessionId: string, work: WorkFn): Promise<void> {
    const previous = this.queues.get(sessionId) || Promise.resolve();
    const next = previous.then(work, (err) => {
      log.error({ err, sessionId }, "Queued work failed, continuing chain");
      return work();
    });
    this.queues.set(sessionId, next);

    try {
      await next;
    } finally {
      // Clean up if this was the last queued item
      if (this.queues.get(sessionId) === next) {
        this.queues.delete(sessionId);
      }
    }
  }
}
