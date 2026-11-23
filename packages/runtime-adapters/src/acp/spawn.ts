import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { AcpProtocolError } from "./errors.js";

export interface AcpSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface AcpSpawnedProcess {
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export function defaultSpawn(request: AcpSpawnRequest): AcpSpawnedProcess {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!child.pid || !child.stdin || !child.stdout || !child.stderr) {
    throw new AcpProtocolError("spawn_failed", "ACP process did not expose stdio");
  }
  return {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    once(event, listener) {
      if (event === "exit") child.once("exit", listener);
    },
    kill(signal) {
      return child.kill(signal);
    },
  };
}
