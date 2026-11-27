import { openHarnessRunEngine } from "../harness-engine.js";
import type { CommandOutcome, CommandRequest, CommandRunner } from "./ports.js";

/**
 * Gate 0 commands run inside `HarnessRunEngine`. The engine owns the process
 * tree, so Phase 0 does not spawn an unsandboxed host command.
 */
export class NodeCommandRunner implements CommandRunner {
  readonly runs: string[] = [];
  private readonly engine = openHarnessRunEngine();

  async run(request: CommandRequest, cwd: string): Promise<CommandOutcome> {
    this.runs.push(request.id);
    const argv = request.argv[0] === "node" ? [process.execPath, ...request.argv.slice(1)] : [...request.argv];
    const started = Date.now();
    try {
      const result = await this.engine.executeSandboxedCommand({
        attemptId: `phase0-${request.id}`,
        worktreePath: cwd,
        cwd,
        command: argv,
        timeoutMs: 15_000,
        priority: "verifier",
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdoutSummary,
        stderr: result.stderrSummary,
        durationMs: Math.max(0, Math.round(result.durationMs)),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { exitCode: 127, stdout: "", stderr: message, durationMs: Math.max(0, Date.now() - started) };
    }
  }

  close(): void {
    this.engine.close();
  }
}

export class OverridingCommandRunner implements CommandRunner {
  constructor(
    private readonly inner: CommandRunner,
    private readonly exits: ReadonlyMap<string, number>,
  ) {}

  async run(request: CommandRequest, cwd: string): Promise<CommandOutcome> {
    const forced = this.exits.get(request.id);
    if (forced === undefined) return this.inner.run(request, cwd);
    return {
      exitCode: forced,
      stdout: "",
      stderr: forced === 0 ? "" : `${request.id} failed`,
      durationMs: 1,
    };
  }
}
