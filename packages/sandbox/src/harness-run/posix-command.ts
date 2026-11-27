import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { CommandLaunchError } from "./errors.js";
import type {
  CommandJob,
  JobLimits,
  JobRedirect,
  JobRunHandlers,
  JobRunPlan,
  JobRunResult,
  JobStep,
  WindowsJobManager,
} from "./types.js";

export class PosixCommandJobManager implements WindowsJobManager {
  createJob(limits: JobLimits): CommandJob {
    return new PosixCommandJob(limits);
  }
}

class PosixCommandJob implements CommandJob {
  private groupPid: number | null = null;
  private closed = false;
  private readonly truncatedRedirects = new Set<string>();

  constructor(private readonly limits: JobLimits) {}

  async run(plan: JobRunPlan, handlers: JobRunHandlers): Promise<JobRunResult> {
    if (plan.steps.length === 0) throw new CommandLaunchError("execution plan has no steps");
    const env = envObject(plan.env);
    let exitCode = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    for (let index = 0; index < plan.steps.length; index += 1) {
      const step = plan.steps[index];
      if (step === undefined) continue;
      if (!shouldRun(step, exitCode, index === 0)) continue;
      if (step.operator === "pipe") {
        throw new CommandLaunchError("piped command steps require the Windows job host");
      }
      const outcome = await this.runStep(step, plan.cwd, env, handlers);
      exitCode = outcome.exitCode;
      if (outcome.timedOut) {
        timedOut = true;
        break;
      }
      if (outcome.outputLimitExceeded) {
        outputLimitExceeded = true;
        break;
      }
    }
    const terminationReason = outputLimitExceeded
      ? "output_limit_exceeded"
      : timedOut
        ? "timeout"
        : "completed";
    return {
      exitCode,
      timedOut,
      oomKilled: false,
      peakMemoryBytes: 0,
      outputLimitExceeded,
      terminationReason,
    };
  }

  close(): void {
    this.closed = true;
    killGroup(this.groupPid);
  }

  private async runStep(
    step: JobStep,
    cwd: string,
    env: NodeJS.ProcessEnv,
    handlers: JobRunHandlers,
  ): Promise<{ exitCode: number; timedOut: boolean; outputLimitExceeded: boolean }> {
    const file = step.argv[0];
    if (!file) throw new CommandLaunchError("execution plan has an empty step");
    const child = spawn(file, step.argv.slice(1), {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (this.groupPid === null && child.pid) this.groupPid = child.pid;
    const stdoutFile = redirectTarget(step.redirects, "stdout");
    const stderrFile = redirectTarget(step.redirects, "stderr");
    let outputLimitExceeded = false;
    const watch = (chunk: Buffer, emit: (chunk: Buffer) => void, filePath: string | null, append: boolean): void => {
      emit(chunk);
      if (filePath) this.writeRedirect(filePath, chunk, append);
      const decision = handlers.shouldAbort();
      if (decision.abort) {
        outputLimitExceeded = true;
        killGroup(child.pid);
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      watch(chunk, handlers.onStdout, stdoutFile?.target ?? null, stdoutFile?.append ?? false);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      watch(chunk, handlers.onStderr, stderrFile?.target ?? null, stderrFile?.append ?? false);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, this.limits.timeoutMs);
    let status = 1;
    try {
      status = await waitForChild(child);
    } finally {
      clearTimeout(timer);
      if (this.closed || timedOut || outputLimitExceeded) killGroup(child.pid);
    }
    return {
      exitCode: status,
      timedOut,
      outputLimitExceeded,
    };
  }

  private writeRedirect(filePath: string, chunk: Buffer, append: boolean): void {
    if (append || this.truncatedRedirects.has(filePath)) {
      fs.appendFileSync(filePath, chunk);
      return;
    }
    fs.writeFileSync(filePath, chunk);
    this.truncatedRedirects.add(filePath);
  }
}

function shouldRun(step: JobStep, previousCode: number, first: boolean): boolean {
  if (first || step.operator === "none" || step.operator === "semi") return true;
  if (step.operator === "and") return previousCode === 0;
  if (step.operator === "or") return previousCode !== 0;
  return true;
}

function redirectTarget(
  redirects: readonly JobRedirect[],
  kind: "stdout" | "stderr",
): { readonly target: string; readonly append: boolean } | null {
  const match = redirects.find((redirect) => redirect.kind === kind || redirect.kind === `${kind}_append`);
  if (!match || match.target === "&1") return null;
  return { target: match.target, append: match.kind.endsWith("_append") };
}

function envObject(entries: readonly string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const entry of entries) {
    const index = entry.indexOf("=");
    if (index <= 0) continue;
    env[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return env;
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function killGroup(pid: number | null | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!isGone(error)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (inner) {
        if (!isGone(inner)) return;
      }
    }
  }
}

function isGone(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "ESRCH" || code === "EPERM";
}
