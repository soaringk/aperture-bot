import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { LifeOSConfig } from "../config.js";
import { appendMarkdown, listStateFiles, readMarkdown, writeMarkdown } from "../state/markdown.js";

// biome-ignore lint/suspicious/noExplicitAny: AgentTool generic must be erased for heterogeneous array
export function createTools(config: LifeOSConfig, userId: string): AgentTool<any>[] {
	const ReadFileParams = Type.Object({
		path: Type.String({ description: "Relative path within PARA structure, e.g. '02_Areas/health.md'" }),
	});

	const readFile: AgentTool<typeof ReadFileParams> = {
		name: "read_file",
		label: "Read File",
		description: "Read a LifeOS markdown file from the user's PARA structure",
		parameters: ReadFileParams,
		async execute(_toolCallId, params) {
			try {
				const content = readMarkdown(config, params.path, userId);
				return { content: [{ type: "text", text: content }], details: { path: params.path } };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
					details: { path: params.path, error: true },
				};
			}
		},
	};

	const WriteFileParams = Type.Object({
		path: Type.String({ description: "Relative path within PARA structure" }),
		content: Type.String({ description: "Full file content to write" }),
	});

	const writeFile: AgentTool<typeof WriteFileParams> = {
		name: "write_file",
		label: "Write File",
		description: "Write or overwrite a LifeOS markdown file",
		parameters: WriteFileParams,
		async execute(_toolCallId, params) {
			writeMarkdown(config, params.path, params.content, userId);
			return {
				content: [{ type: "text", text: `Wrote ${params.path}` }],
				details: { path: params.path },
			};
		},
	};

	const AppendFileParams = Type.Object({
		path: Type.String({ description: "Relative path within PARA structure" }),
		content: Type.String({ description: "Content to append" }),
	});

	const appendFile: AgentTool<typeof AppendFileParams> = {
		name: "append_file",
		label: "Append File",
		description: "Append content to an existing LifeOS markdown file",
		parameters: AppendFileParams,
		async execute(_toolCallId, params) {
			appendMarkdown(config, params.path, params.content, userId);
			return {
				content: [{ type: "text", text: `Appended to ${params.path}` }],
				details: { path: params.path },
			};
		},
	};

	const ListFilesParams = Type.Object({
		directory: Type.Optional(
			Type.String({ description: "PARA subdirectory to list, e.g. '02_Areas'. Omit for all files." }),
		),
	});

	const listFiles: AgentTool<typeof ListFilesParams> = {
		name: "list_files",
		label: "List Files",
		description: "List files in the user's PARA structure",
		parameters: ListFilesParams,
		async execute(_toolCallId, params) {
			const files = listStateFiles(config, params.directory, userId);
			const text = files.length > 0 ? files.join("\n") : "(no files)";
			return { content: [{ type: "text", text }], details: { count: files.length } };
		},
	};

	const SearchFilesParams = Type.Object({
		query: Type.String({ description: "Text to search for (case-insensitive)" }),
		directory: Type.Optional(Type.String({ description: "Limit search to this PARA subdirectory" })),
	});

	const searchFiles: AgentTool<typeof SearchFilesParams> = {
		name: "search_files",
		label: "Search Files",
		description: "Search across LifeOS markdown files for matching content",
		parameters: SearchFilesParams,
		async execute(_toolCallId, params) {
			const files = listStateFiles(config, params.directory, userId);
			const results: string[] = [];
			const queryLower = params.query.toLowerCase();

			for (const file of files) {
				if (!file.endsWith(".md")) continue;
				try {
					const content = readMarkdown(config, file, userId);
					if (content.toLowerCase().includes(queryLower)) {
						// Extract matching lines with context
						const lines = content.split("\n");
						const matches = lines
							.map((line, i) => ({ line, lineNum: i + 1 }))
							.filter((l) => l.line.toLowerCase().includes(queryLower));

						if (matches.length > 0) {
							results.push(`### ${file}\n${matches.map((m) => `  L${m.lineNum}: ${m.line}`).join("\n")}`);
						}
					}
				} catch {
					// skip unreadable files
				}
			}

			const text = results.length > 0 ? results.join("\n\n") : `No results for "${params.query}"`;
			return { content: [{ type: "text", text }], details: { matchingFiles: results.length } };
		},
	};

	return [readFile, writeFile, appendFile, listFiles, searchFiles];
}
