import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandLaunchError } from "./errors.js";
import type { JobLimits, JobRunHandlers, JobRunPlan, JobRunResult, TerminationReason, WindowsJobManager, CommandJob } from "./types.js";

let compileTask: Promise<string> | null = null;

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function compileJobHost(): Promise<string> {
  const sourcePath = fileURLToPath(new URL("./job-host.cs", import.meta.url));
  const source = fs.readFileSync(sourcePath);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const dir = path.join(os.tmpdir(), "ef-harness-job-host");
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, `job-host-${hash}.exe`);
  if (fs.existsSync(exe)) return exe;
  const csPath = path.join(dir, `job-host-${hash}.cs`);
  const built = path.join(dir, `job-host-${hash}.building.exe`);
  fs.writeFileSync(csPath, source);
  if (fs.existsSync(built)) fs.rmSync(built, { force: true });
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$src = Get-Content -Raw -LiteralPath ${psQuote(csPath)}`,
    `Add-Type -TypeDefinition $src -OutputAssembly ${psQuote(built)} -OutputType ConsoleApplication`,
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0 || !fs.existsSync(built)) {
    throw new CommandLaunchError(
      `job host compile failed: ${(result.stderr || result.stdout || "unknown compiler error").trim()}`,
    );
  }
  try {
    fs.renameSync(built, exe);
  } catch {
    if (!fs.existsSync(exe)) throw new CommandLaunchError("job host executable was not published");
  }
  return exe;
}

export function ensureJobHostExe(): Promise<string> {
  if (compileTask === null) {
    compileTask = compileJobHost().catch((error: unknown) => {
      compileTask = null;
      throw error;
    });
  }
  return compileTask;
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export function serializePlan(plan: JobRunPlan, limits: JobLimits): string {
  const lines = [
    "EFHPLAN1",
    String(limits.memoryBytes),
    String(limits.activeProcessLimit),
    String(limits.timeoutMs),
    b64(plan.cwd),
    String(plan.env.length),
    ...plan.env.map((entry) => b64(entry)),
    String(plan.steps.length),
  ];
  for (const step of plan.steps) {
    lines.push(step.operator, String(step.argv.length));
    for (const arg of step.argv) lines.push(b64(arg));
    lines.push(String(step.redirects.length));
    for (const redirect of step.redirects) {
      lines.push(redirect.kind, b64(redirect.target));
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseResult(text: string): JobRunResult & { readonly error: string } {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    values.set(line.slice(0, index), line.slice(index + 1).trim());
  }
  const reason = values.get("terminationReason");
  const terminationReason: TerminationReason =
    reason === "timeout" || reason === "output_limit_exceeded" || reason === "memory_limit_exceeded"
      ? reason
      : "completed";
  return {
    exitCode: Number(values.get("exitCode") ?? "1"),
    timedOut: values.get("timedOut") === "true",
    oomKilled: values.get("oomKilled") === "true",
    peakMemoryBytes: Number(values.get("peakMemoryBytes") ?? "0"),
    outputLimitExceeded: values.get("outputLimitExceeded") === "true",
    terminationReason,
    error: values.get("error") ?? "",
  };
}

class NestedCommandJob implements CommandJob {
  constructor(private readonly limits: JobLimits) {}

  async run(plan: JobRunPlan, handlers: JobRunHandlers): Promise<JobRunResult> {
    if (plan.steps.length === 0) throw new CommandLaunchError("execution plan has no steps");
    const exe = await ensureJobHostExe();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-harness-run-"));
    const planPath = path.join(dir, "plan.txt");
    const resultPath = path.join(dir, "result.txt");
    fs.writeFileSync(planPath, serializePlan(plan, this.limits));
    const child = spawn(exe, ["--plan", planPath, "--result", resultPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let abortSent = false;
    const sendAbort = (reason: string): void => {
      if (abortSent) return;
      abortSent = true;
      try {
        child.stdin?.write(`KILL ${reason}\n`);
      } catch {
        // The host can already have exited.
      }
    };
    const watch = (chunk: Buffer, emit: (chunk: Buffer) => void): void => {
      emit(chunk);
      const decision = handlers.shouldAbort();
      if (decision.abort) sendAbort(decision.reason);
    };
    child.stdout?.on("data", (chunk: Buffer) => watch(chunk, handlers.onStdout));
    child.stderr?.on("data", (chunk: Buffer) => watch(chunk, handlers.onStderr));
    const timer = setTimeout(() => {
      child.kill();
    }, this.limits.timeoutMs + 15_000);
    let status = 1;
    try {
      status = await waitForChild(child);
    } finally {
      clearTimeout(timer);
      try {
        child.stdin?.end();
      } catch {
        // The stdin pipe may already be closed.
      }
    }
    let parsed: ReturnType<typeof parseResult> | null = null;
    if (fs.existsSync(resultPath)) parsed = parseResult(fs.readFileSync(resultPath, "utf8"));
    fs.rmSync(dir, { recursive: true, force: true });
    if (parsed === null) {
      throw new CommandLaunchError(`job host exited ${status} without a result`);
    }
    if (parsed.error.length > 0) throw new CommandLaunchError(parsed.error);
    const outputLimitExceeded = parsed.outputLimitExceeded || abortSent;
    return {
      exitCode: Number.isFinite(parsed.exitCode) ? parsed.exitCode : 1,
      timedOut: parsed.timedOut,
      oomKilled: parsed.oomKilled,
      peakMemoryBytes: Number.isFinite(parsed.peakMemoryBytes) ? parsed.peakMemoryBytes : 0,
      outputLimitExceeded,
      terminationReason: outputLimitExceeded && parsed.terminationReason === "completed"
        ? "output_limit_exceeded"
        : parsed.terminationReason,
    };
  }

  close(): void {
    // The native job handle is closed by the host process when the run returns.
  }
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export class NestedCommandJobManager implements WindowsJobManager {
  createJob(limits: JobLimits): CommandJob {
    return new NestedCommandJob(limits);
  }
}
