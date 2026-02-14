/** Core domain types */

export type UserId = string;

export interface HistoryEntry {
  ts: number;
  session: string;
  event: string;
  userId?: string;
  text?: string;
  tool?: string;
  args?: Record<string, unknown>;
  tokens?: { in: number; out: number };
  error?: string;
  [key: string]: unknown;
}
