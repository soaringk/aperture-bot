import fs from "node:fs/promises";
import path from "node:path";
import { StorageError } from "../utils/errors.js";

/**
 * Append a JSON object as a single line to a JSONL file.
 * Creates parent directories if they don't exist.
 */
export async function appendJsonl(
  filePath: string,
  entry: Record<string, unknown>,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(filePath, line, "utf-8");
  } catch (err) {
    throw new StorageError(`Failed to append to ${filePath}`, err);
  }
}

/**
 * Read all entries from a JSONL file.
 * Returns empty array if file doesn't exist.
 */
export async function readJsonl<T = Record<string, unknown>>(
  filePath: string,
): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new StorageError(`Failed to read ${filePath}`, err);
  }
}

/**
 * Read the last N entries from a JSONL file.
 */
export async function readLastJsonl<T = Record<string, unknown>>(
  filePath: string,
  count: number,
): Promise<T[]> {
  const entries = await readJsonl<T>(filePath);
  return entries.slice(-count);
}
