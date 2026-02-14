import { exec } from "node:child_process";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("executor");

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a command, optionally sandboxed via nono.
 *
 * nono is a CLI sandbox tool. When available, commands are wrapped as:
 *   nono run --profile aperture --read-write <userDataDir> -- <command>
 *
 * When nono is not installed, commands run directly with a warning.
 */
export class ToolExecutor {
  private nonoAvailable: boolean | null = null;

  constructor(private readonly userDataDir: string) {}

  async execute(
    command: string,
    timeoutMs: number = 30_000,
  ): Promise<ExecResult> {
    const useNono = await this.isNonoAvailable();
    const fullCommand = useNono
      ? `nono run --profile aperture --read-write ${this.userDataDir} -- ${command}`
      : command;

    if (!useNono && this.nonoAvailable === false) {
      log.warn("nono not installed — running tool without sandbox");
    }

    return new Promise<ExecResult>((resolve, reject) => {
      const child = exec(fullCommand, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && err.killed) {
          resolve({ stdout, stderr: stderr + "\n[Process killed: timeout]", exitCode: 124 });
        } else {
          resolve({
            stdout,
            stderr,
            exitCode: err ? (err.code ?? 1) : 0,
          });
        }
      });
    });
  }

  private async isNonoAvailable(): Promise<boolean> {
    if (this.nonoAvailable !== null) return this.nonoAvailable;

    return new Promise<boolean>((resolve) => {
      exec("nono --version", { timeout: 5_000 }, (err) => {
        this.nonoAvailable = !err;
        if (this.nonoAvailable) {
          log.info("nono sandbox is available");
        } else {
          log.warn("nono not found — tools will run unsandboxed");
        }
        resolve(this.nonoAvailable);
      });
    });
  }
}
