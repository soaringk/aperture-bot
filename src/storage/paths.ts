import path from "node:path";

/**
 * Resolve paths within a user's data directory.
 * All user data is isolated under DATA_DIR/users/{userId}/.
 */
export class UserPaths {
  constructor(
    private readonly dataDir: string,
    private readonly userId: string,
  ) {}

  /** Root of this user's data */
  get root(): string {
    return path.join(this.dataDir, "users", this.userId);
  }

  get soul(): string {
    return path.join(this.root, "SOUL.md");
  }

  get heartbeat(): string {
    return path.join(this.root, "HEARTBEAT.md");
  }

  get memory(): string {
    return path.join(this.root, "MEMORY.md");
  }

  get sessionsDir(): string {
    return path.join(this.root, "sessions");
  }

  get eventsDir(): string {
    return path.join(this.root, "events");
  }

  get remindersDir(): string {
    return path.join(this.root, "reminders");
  }

  get notesDir(): string {
    return path.join(this.root, "notes");
  }

  get historyDir(): string {
    return path.join(this.root, "history");
  }

  /** Session-specific paths */
  sessionDir(sessionId: string): string {
    // sanitize sessionId for filesystem
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.sessionsDir, safe);
  }

  sessionContext(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), "context.jsonl");
  }

  /** Daily history file */
  historyFile(date: Date = new Date()): string {
    const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(this.historyDir, `${dateStr}.jsonl`);
  }
}
