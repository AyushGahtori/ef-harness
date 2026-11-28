import { spawn, type ChildProcess } from "node:child_process";
import { ResumeError } from "./errors.js";
import type { CompiledBrief, ResumeFailureCode } from "./types.js";

/**
 * Local port of Task 142 `AgentRuntimeAdapter.resume` / `startSession`.
 * Swap for the real adapter (`CodexRuntimeAdapter`, `ClaudeCodeRuntimeAdapter`,
 * Copilot, Cursor, OpenCode, ACP, or the native worker loop) at integration.
 */
export type ResumeCallResult =
  | { readonly ok: true; readonly sessionId: string; readonly pid?: number }
  | { readonly ok: false; readonly code: ResumeFailureCode; readonly message: string };

export interface FreshSessionSpec {
  readonly attemptId: string;
  readonly brief: CompiledBrief;
  readonly handoff: string;
  readonly worktreePath: string;
  readonly wipTreeSha: string;
  readonly slotPath: string;
}

export interface FreshSessionStart {
  readonly sessionId: string;
  readonly pid: number;
}

export interface ForeignAdapterPort {
  readonly adapterId: string;
  readonly version: string;
  readonly nativeResumeSupported: boolean;
  resume(nativeSessionId: string, checkpointRef: string): Promise<ResumeCallResult>;
  startSession(spec: FreshSessionSpec): Promise<FreshSessionStart>;
  steer?(sessionId: string, note: string): Promise<void>;
}

/**
 * Local port of Task 088 brief compilation.
 * The default compiler returns the brief the caller already built.
 */
export interface BriefCompilerPort {
  compile(brief: CompiledBrief): CompiledBrief;
}

export class IdentityBriefCompiler implements BriefCompilerPort {
  compile(brief: CompiledBrief): CompiledBrief {
    return brief;
  }
}

/** Local port of Task 038 worktree slot reset. Reset runs only after the WIP tree is stored. */
export interface WorktreeSlotPort {
  reset(slotId: string): void;
}

export class NoopWorktreeSlot implements WorktreeSlotPort {
  reset(slotId: string): void {
    void slotId;
  }
}

export interface ChildProcessPort {
  spawn(label: string): { readonly pid: number };
  kill(pid: number): void;
  isAlive(pid: number): boolean;
  writeStdin(pid: number, text: string): void;
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }
  return "";
}

/** Real OS child used to prove idle park terminates the wrapped process. */
export class OsChildProcesses implements ChildProcessPort {
  private readonly live = new Map<number, ChildProcess>();

  spawn(label: string): { readonly pid: number } {
    void label;
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    if (child.pid === undefined) {
      throw new ResumeError("spawn", "Wrapped child process did not receive a pid");
    }
    this.live.set(child.pid, child);
    return { pid: child.pid };
  }

  kill(pid: number): void {
    const child = this.live.get(pid);
    if (!child) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (errorCode(error) !== "ESRCH") {
          throw new ResumeError("kill", `Unable to terminate pid ${pid}`);
        }
      }
      return;
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    this.live.delete(pid);
  }

  isAlive(pid: number): boolean {
    const child = this.live.get(pid);
    if (child) return child.exitCode === null && child.signalCode === null;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return errorCode(error) === "EPERM";
    }
  }

  writeStdin(pid: number, text: string): void {
    const child = this.live.get(pid);
    if (!child || child.killed || child.exitCode !== null || !child.stdin || child.stdin.destroyed) {
      throw new ResumeError("broken_pipe", `stdin for pid ${pid} is closed`);
    }
    child.stdin.write(text);
  }

  dispose(): void {
    for (const pid of [...this.live.keys()]) this.kill(pid);
  }
}

/**
 * In-memory child table for park-versus-wake races.
 * A write after kill throws, which is the broken-pipe failure the mutex prevents.
 */
export class ScriptedChildProcesses implements ChildProcessPort {
  readonly killed: number[] = [];
  readonly writes: { readonly pid: number; readonly text: string }[] = [];
  private nextPid = 1_000;
  private readonly alive = new Set<number>();

  spawn(label: string): { readonly pid: number } {
    void label;
    this.nextPid += 1;
    this.alive.add(this.nextPid);
    return { pid: this.nextPid };
  }

  kill(pid: number): void {
    this.alive.delete(pid);
    this.killed.push(pid);
  }

  isAlive(pid: number): boolean {
    return this.alive.has(pid);
  }

  writeStdin(pid: number, text: string): void {
    if (!this.alive.has(pid)) {
      throw new ResumeError("broken_pipe", `stdin for pid ${pid} is closed`);
    }
    this.writes.push({ pid, text });
  }
}

/** Same major.minor is compatible. Any other change refuses native resume before the call. */
export function versionsCompatible(pinned: string, current: string): boolean {
  if (pinned === current) return true;
  const left = parseSemver(pinned);
  const right = parseSemver(current);
  if (!left || !right) return false;
  return left.major === right.major && left.minor === right.minor;
}

function parseSemver(value: string): { readonly major: number; readonly minor: number } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  return { major, minor };
}
