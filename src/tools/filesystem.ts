import fs from "node:fs/promises";
import path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

// --- Read File ---

const ReadFileParams = Type.Object({
  path: Type.String({ description: "Relative path within the user data directory" }),
});

export function createReadFileTool(userDataDir: string): AgentTool<typeof ReadFileParams> {
  return {
    name: "read_file",
    label: "Read File",
    description: "Read the contents of a file in the user's data directory.",
    parameters: ReadFileParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof ReadFileParams>,
    ): Promise<AgentToolResult<{ path: string; size: number }>> => {
      const resolved = resolveSafe(userDataDir, params.path);
      const content = await fs.readFile(resolved, "utf-8");
      return {
        content: [{ type: "text", text: content }],
        details: { path: params.path, size: content.length },
      };
    },
  };
}

// --- Write File ---

const WriteFileParams = Type.Object({
  path: Type.String({ description: "Relative path within the user data directory" }),
  content: Type.String({ description: "File content to write" }),
});

export function createWriteFileTool(userDataDir: string): AgentTool<typeof WriteFileParams> {
  return {
    name: "write_file",
    label: "Write File",
    description: "Write content to a file in the user's data directory. Creates parent directories if needed.",
    parameters: WriteFileParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof WriteFileParams>,
    ): Promise<AgentToolResult<{ path: string; size: number }>> => {
      const resolved = resolveSafe(userDataDir, params.path);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, params.content, "utf-8");
      return {
        content: [{ type: "text", text: `Written ${params.content.length} bytes to ${params.path}` }],
        details: { path: params.path, size: params.content.length },
      };
    },
  };
}

// --- Edit File ---

const EditFileParams = Type.Object({
  path: Type.String({ description: "Relative path within the user data directory" }),
  old_text: Type.String({ description: "Exact text to find and replace" }),
  new_text: Type.String({ description: "Replacement text" }),
});

export function createEditFileTool(userDataDir: string): AgentTool<typeof EditFileParams> {
  return {
    name: "edit_file",
    label: "Edit File",
    description: "Replace exact text in a file. The old_text must match exactly (including whitespace).",
    parameters: EditFileParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof EditFileParams>,
    ): Promise<AgentToolResult<{ path: string }>> => {
      const resolved = resolveSafe(userDataDir, params.path);
      const content = await fs.readFile(resolved, "utf-8");

      if (!content.includes(params.old_text)) {
        throw new Error(`old_text not found in ${params.path}`);
      }

      const updated = content.replace(params.old_text, params.new_text);
      await fs.writeFile(resolved, updated, "utf-8");
      return {
        content: [{ type: "text", text: `Edited ${params.path}` }],
        details: { path: params.path },
      };
    },
  };
}

// --- List Files ---

const ListFilesParams = Type.Object({
  path: Type.String({
    description: "Relative directory path within the user data directory",
    default: ".",
  }),
});

export function createListFilesTool(userDataDir: string): AgentTool<typeof ListFilesParams> {
  return {
    name: "list_files",
    label: "List Files",
    description: "List files and directories in the user's data directory.",
    parameters: ListFilesParams,
    execute: async (
      _toolCallId: string,
      params: Static<typeof ListFilesParams>,
    ): Promise<AgentToolResult<{ count: number }>> => {
      const resolved = resolveSafe(userDataDir, params.path);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const lines = entries.map((e) =>
        e.isDirectory() ? `${e.name}/` : e.name,
      );
      return {
        content: [{ type: "text", text: lines.join("\n") || "(empty)" }],
        details: { count: entries.length },
      };
    },
  };
}

/**
 * Resolve a relative path safely within the user data directory.
 * Prevents path traversal attacks (e.g., "../../etc/passwd").
 */
function resolveSafe(baseDir: string, relativePath: string): string {
  const resolved = path.resolve(baseDir, relativePath);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }
  return resolved;
}
