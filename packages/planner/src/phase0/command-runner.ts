import { spawn } from "node:child_process";

import type { CommandOutcome, CommandRequest, CommandRunner } from "./ports.js";

export class NodeCommandRunner implements CommandRunner {
  async run(request: CommandRequest, cwd: string): Promise<CommandOutcome> {
    const started = Date.now();
    const argv = request.argv[0] === "node" ? [process.execPath, ...request.argv.slice(1)] : [...request.argv];
    const outcome = await spawnCaptured(argv, cwd);
    return { ...outcome, durationMs: Math.max(0, Date.now() - started) };
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

function spawnCaptured(argv: readonly string[], cwd: string): Promise<Pick<CommandOutcome, "exitCode" | "stdout" | "stderr">> {
  const executable = argv[0];
  if (!executable) return Promise.resolve({ exitCode: 127, stdout: "", stderr: "missing command" });
  return new Promise((resolve) => {
    const child = spawn(executable, argv.slice(1), { cwd, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
    }, 15000);
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout: "", stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
