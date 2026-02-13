import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LifeOSConfig } from "../config.js";
import { userRoot } from "./para.js";

const INBOX_FILE = "00_Inbox/raw_stream.md";
const SEPARATOR = "\n---\n";

/** Format a timestamped inbox entry. */
function formatEntry(text: string, source?: string): string {
	const ts = new Date().toISOString();
	const header = source ? `[${ts}] (${source})` : `[${ts}]`;
	return `${SEPARATOR}${header}\n${text}\n`;
}

/** Append a raw entry to the user's inbox. */
export function appendToInbox(config: LifeOSConfig, text: string, source?: string, userId?: string): void {
	const filePath = join(userRoot(config, userId), INBOX_FILE);
	appendFileSync(filePath, formatEntry(text, source), "utf-8");
}

/** Read all raw entries from the user's inbox. */
export function readInbox(config: LifeOSConfig, userId?: string): string {
	const filePath = join(userRoot(config, userId), INBOX_FILE);
	return readFileSync(filePath, "utf-8");
}

/**
 * Parse inbox entries into individual items.
 * Each item starts with a `---` separator followed by a timestamp line.
 */
export function parseInboxEntries(raw: string): Array<{ timestamp: string; source?: string; text: string }> {
	const entries: Array<{ timestamp: string; source?: string; text: string }> = [];
	const blocks = raw.split(/\n---\n/).slice(1); // skip header

	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (lines.length === 0) continue;

		const headerMatch = lines[0].match(/^\[(.+?)\](?:\s+\((.+?)\))?$/);
		if (headerMatch) {
			entries.push({
				timestamp: headerMatch[1],
				source: headerMatch[2],
				text: lines.slice(1).join("\n").trim(),
			});
		}
	}

	return entries;
}

/** Clear inbox by resetting to just the header. */
export function clearInbox(config: LifeOSConfig, userId?: string): void {
	const filePath = join(userRoot(config, userId), INBOX_FILE);
	writeFileSync(filePath, "# Inbox — Raw Stream\n\n", "utf-8");
}
