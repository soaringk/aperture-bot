import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
});

export type Logger = pino.Logger;

export function createChildLogger(name: string): Logger {
  return logger.child({ component: name });
}
