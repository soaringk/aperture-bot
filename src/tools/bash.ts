import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { ToolExecutor } from "./executor.js";

const BashParams = Type.Object({
  command: Type.String({ description: "The shell command to execute" }),
});

type BashParamsType = Static<typeof BashParams>;

/**
 * Create a bash tool scoped to a user's data directory.
 */
export function createBashTool(userDataDir: string): AgentTool<typeof BashParams> {
  const executor = new ToolExecutor(userDataDir);

  return {
    name: "bash",
    label: "Run Command",
    description:
      "Execute a shell command. Output is returned as text. " +
      "Commands are sandboxed to the user's data directory when nono is available.",
    parameters: BashParams,
    execute: async (
      _toolCallId: string,
      params: BashParamsType,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ exitCode: number }>> => {
      const result = await executor.execute(params.command);

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      const truncated =
        output.length > 50_000
          ? output.slice(0, 50_000) + "\n[Output truncated]"
          : output;

      const text = `Exit code: ${result.exitCode}\n${truncated}`;

      if (result.exitCode !== 0) {
        throw new Error(text);
      }

      return {
        content: [{ type: "text", text }],
        details: { exitCode: result.exitCode },
      };
    },
  };
}
