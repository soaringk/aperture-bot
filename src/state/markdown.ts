import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";
import type { LifeOSConfig } from "../config.js";
import { userRoot } from "./para.js";

/** Resolve a relative path within a user's PARA tree to an absolute path. */
export function resolveStatePath(config: LifeOSConfig, relativePath: string, userId?: string): string {
	return join(userRoot(config, userId), relativePath);
}

/** Read a markdown file from the user's state directory. */
export function readMarkdown(config: LifeOSConfig, relativePath: string, userId?: string): string {
	const filePath = resolveStatePath(config, relativePath, userId);
	if (!existsSync(filePath)) {
		throw new Error(`File not found: ${relativePath}`);
	}
	return readFileSync(filePath, "utf-8");
}

/** Write content to a markdown file (overwrites). */
export function writeMarkdown(config: LifeOSConfig, relativePath: string, content: string, userId?: string): void {
	const filePath = resolveStatePath(config, relativePath, userId);
	writeFileSync(filePath, content, "utf-8");
}

/** Append content to a markdown file. */
export function appendMarkdown(config: LifeOSConfig, relativePath: string, content: string, userId?: string): void {
	const filePath = resolveStatePath(config, relativePath, userId);
	appendFileSync(filePath, content, "utf-8");
}

/**
 * Initialize git in the lifeos_root if not already a repo,
 * then auto-commit all changes.
 */
export async function gitAutoCommit(config: LifeOSConfig, message: string): Promise<void> {
	const git: SimpleGit = simpleGit(config.lifeos_root);

	const isRepo = existsSync(join(config.lifeos_root, ".git"));
	if (!isRepo) {
		await git.init();
	}

	await git.add(".");
	const status = await git.status();
	if (status.files.length > 0) {
		await git.commit(message);
	}
}

/**
 * List files under a PARA subdirectory for a user.
 * Returns relative paths (from user root).
 */
export function listStateFiles(config: LifeOSConfig, subdir?: string, userId?: string): string[] {
	const root = userRoot(config, userId);
	const searchDir = subdir ? join(root, subdir) : root;

	if (!existsSync(searchDir)) return [];

	const results: string[] = [];

	function walk(dir: string) {
		for (const entry of readdirSync(dir)) {
			if (entry.startsWith(".")) continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full);
			} else {
				results.push(relative(root, full));
			}
		}
	}
	walk(searchDir);
	return results;
}
