export class ApertureError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ApertureError";
  }
}

export class ConfigError extends ApertureError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONFIG_ERROR", cause);
    this.name = "ConfigError";
  }
}

export class ChannelError extends ApertureError {
  constructor(message: string, cause?: unknown) {
    super(message, "CHANNEL_ERROR", cause);
    this.name = "ChannelError";
  }
}

export class StorageError extends ApertureError {
  constructor(message: string, cause?: unknown) {
    super(message, "STORAGE_ERROR", cause);
    this.name = "StorageError";
  }
}

export class AgentError extends ApertureError {
  constructor(message: string, cause?: unknown) {
    super(message, "AGENT_ERROR", cause);
    this.name = "AgentError";
  }
}
