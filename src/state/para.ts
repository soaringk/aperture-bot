import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LifeOSConfig } from "../config.js";

export const PARA_DIRS = ["00_Inbox", "01_Projects", "02_Areas", "03_Resources", "04_Archives"] as const;

const INITIAL_AREA_FILES: Record<string, string> = {
	"health.md": "# Health\n\n",
	"finance.md": "# Finance\n\n",
	"todo.md": "# Todo\n\n",
};

/** Return the root directory for a given userId. */
export function userRoot(config: LifeOSConfig, userId?: string): string {
	return join(config.lifeos_root, userId ?? config.default_user);
}

/**
 * Ensure PARA directory structure exists for a userId.
 * Creates directories and seed files if missing.
 */
export function initPara(config: LifeOSConfig, userId?: string): void {
	const root = userRoot(config, userId);

	for (const dir of PARA_DIRS) {
		const dirPath = join(root, dir);
		if (!existsSync(dirPath)) {
			mkdirSync(dirPath, { recursive: true });
		}
	}

	// Seed inbox
	const inboxFile = join(root, "00_Inbox", "raw_stream.md");
	if (!existsSync(inboxFile)) {
		writeFileSync(inboxFile, "# Inbox — Raw Stream\n\n", "utf-8");
	}

	// Seed area files
	const areasDir = join(root, "02_Areas");
	for (const [filename, content] of Object.entries(INITIAL_AREA_FILES)) {
		const filePath = join(areasDir, filename);
		if (!existsSync(filePath)) {
			writeFileSync(filePath, content, "utf-8");
		}
	}
}
