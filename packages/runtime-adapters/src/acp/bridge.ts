import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AcpRpcError, JSON_RPC_INVALID_PARAMS, JSON_RPC_PERMISSION_DENIED } from "./errors.js";
import { makeEvent, type NormalizedRuntimeEventBus } from "./events.js";
import type { HarnessRunPort, SandboxedCommandResult } from "./harness.js";
import { settleJob } from "./job.js";
import type { WindowsJobPort } from "./job.js";
import { resolveAgainstWorktree } from "./paths.js";
import type { SupervisionContext, SupervisionPolicyPort } from "./policy.js";
import { WAITING_FOR_RUN_SLOT, type WarmExecutionPoolPort } from "./pool.js";
import type { PacketSecurityRedactorPort } from "./redaction.js";
import type { ExecutionMode, PolicyDecision, SupervisionRequest } from "./types.js";

export interface FsReadParams {
  readonly sessionId: string;
  readonly path: string;
  readonly line?: number;
  readonly limit?: number;
}

export interface FsWriteParams {
  readonly sessionId: string;
  readonly path: string;
  readonly content: string;
}

export interface TerminalCreateParams {
  readonly sessionId: string;
  readonly command: string;
  readonly cwd?: string;
}

export interface SecurityEvent {
  readonly at: string;
  readonly sessionId: string;
  readonly method: string;
  readonly reason: string;
  readonly path?: string;
  readonly command?: string;
}

interface TerminalRecord {
  readonly id: string;
  readonly command: string;
  readonly sessionId: string;
  status: "running" | "exited" | "killed";
  output: string;
  errorOutput: string;
  exitCode: number | null;
  leaseId: string | null;
  readonly commandJobId: string;
  readonly abort: AbortController;
  readonly done: Promise<void>;
  resolveDone: () => void;
}

export interface BridgeSession {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly taskId: string;
  readonly worktreeRoot: string;
  readonly cwd: string;
  readonly writeScope: readonly string[];
  readonly mode: ExecutionMode;
  readonly jobId: string;
  readonly homeDir?: string;
  readonly appData?: string;
  readonly leasedTools?: readonly string[];
}

/**
 * Host-served `fs/*` and `terminal/*`.
 * Every path and command goes through the supervision policy, then terminals
 * take a Pool 2 slot and run inside `harness.run` plus the attempt Job Object.
 */
export class AcpHostFsAndTerminalBridge {
  readonly securityEvents: SecurityEvent[] = [];
  private readonly terminals = new Map<string, TerminalRecord>();
  private readonly pool: WarmExecutionPoolPort;

  constructor(
    private readonly policy: SupervisionPolicyPort,
    private readonly harness: HarnessRunPort,
    private readonly jobs: WindowsJobPort,
    private readonly events: NormalizedRuntimeEventBus,
    private readonly redactor: PacketSecurityRedactorPort,
    pool: WarmExecutionPoolPort,
    private readonly maxFileBytes = 4 * 1024 * 1024,
    private readonly onSecurity: (event: SecurityEvent) => void = () => undefined,
  ) {
    this.pool = pool;
  }

  readTextFile(session: BridgeSession, params: FsReadParams): { content: string } {
    this.authorize(session, { kind: "read", path: params.path }, "fs/read_text_file");
    const absolute = this.containedPath(session, params.path);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, "file not found");
    }
    const size = fs.statSync(absolute).size;
    if (size > this.maxFileBytes) {
      throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, `file exceeds ${this.maxFileBytes} byte cap`);
    }
    const text = fs.readFileSync(absolute, "utf8");
    return { content: sliceLines(text, params.line, params.limit) };
  }

  writeTextFile(session: BridgeSession, params: FsWriteParams): { bytesWritten: number } {
    this.authorize(session, { kind: "write", path: params.path }, "fs/write_text_file");
    const bytes = Buffer.byteLength(params.content);
    if (bytes > this.maxFileBytes) {
      throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, `file exceeds ${this.maxFileBytes} byte cap`);
    }
    const absolute = this.containedPath(session, params.path);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    atomicWrite(absolute, params.content);
    this.events.publish(
      makeEvent("file_edited", session.sessionId, {
        paths: [path.relative(session.worktreeRoot, absolute).replaceAll("\\", "/")],
      }),
    );
    return { bytesWritten: bytes };
  }

  async createTerminal(session: BridgeSession, params: TerminalCreateParams): Promise<{ terminalId: string }> {
    this.authorize(session, { kind: "shell", command: params.command }, "terminal/create");
    const terminalId = `term-${randomBytes(4).toString("hex")}`;
    const commandJob = await settleJob(this.jobs.create(`${session.sessionId}-${terminalId}`));
    const abort = new AbortController();
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const record: TerminalRecord = {
      id: terminalId,
      command: params.command,
      sessionId: session.sessionId,
      status: "running",
      output: "",
      errorOutput: "",
      exitCode: null,
      leaseId: null,
      commandJobId: commandJob.jobId,
      abort,
      done,
      resolveDone,
    };
    this.terminals.set(terminalId, record);
    const full = this.pool.runningCount() >= this.pool.capacity;
    if (full) {
      this.events.publish(
        makeEvent("waiting_run_slot", session.sessionId, {
          command: params.command,
          status: WAITING_FOR_RUN_SLOT,
          running: this.pool.runningCount(),
          capacity: this.pool.capacity,
        }),
      );
    }
    const lease = await this.pool.acquire({ taskId: session.taskId, command: params.command });
    record.leaseId = lease.leaseId;
    const run = this.harness
      .executeSandboxedCommand({
        attemptId: session.attemptId,
        taskId: session.taskId,
        worktreePath: session.worktreeRoot,
        cwd: params.cwd ?? session.cwd,
        command: params.command,
        jobId: commandJob.jobId,
        signal: abort.signal,
      })
      .then((result) => this.finishTerminal(record, result))
      .catch((error: unknown) => {
        record.status = "killed";
        record.exitCode = 1;
        record.errorOutput = error instanceof Error ? error.message : "terminal failed";
      })
      .finally(() => {
        if (record.leaseId) this.pool.release(record.leaseId);
        record.leaseId = null;
        void settleJob(this.jobs.close(record.commandJobId)).then(() => {
          record.resolveDone();
        });
      });
    void run;
    return { terminalId };
  }

  output(session: BridgeSession, terminalId: string): { output: string; truncated: boolean } {
    const record = this.requireTerminal(session, terminalId);
    const output = this.redactor.redact(record.output);
    return { output, truncated: output.length > 64 * 1024 };
  }

  async waitForExit(session: BridgeSession, terminalId: string): Promise<{ exitCode: number }> {
    const record = this.requireTerminal(session, terminalId);
    await record.done;
    return { exitCode: record.exitCode ?? 1 };
  }

  async kill(session: BridgeSession, terminalId: string): Promise<{ killed: true }> {
    const record = this.requireTerminal(session, terminalId);
    record.abort.abort();
    record.status = "killed";
    await settleJob(this.jobs.kill(record.commandJobId, "terminal/kill"));
    return { killed: true };
  }

  async release(session: BridgeSession, terminalId: string): Promise<{ released: true }> {
    const record = this.requireTerminal(session, terminalId);
    if (record.status === "running") record.abort.abort();
    await record.done;
    this.terminals.delete(terminalId);
    return { released: true };
  }

  async releaseAll(): Promise<void> {
    for (const record of this.terminals.values()) {
      if (record.status === "running") record.abort.abort();
    }
    await Promise.all([...this.terminals.values()].map((record) => record.done));
    this.terminals.clear();
  }

  private authorize(session: BridgeSession, request: SupervisionRequest, method: string): PolicyDecision {
    const decision = this.policy.decide(this.context(session), request);
    if (decision.effect === "deny") {
      const event: SecurityEvent = {
        at: new Date().toISOString(),
        sessionId: session.sessionId,
        method,
        reason: decision.reason,
        ...(request.kind === "shell" ? { command: request.command } : {}),
        ...(request.kind !== "shell" && request.kind !== "web" && request.kind !== "mcp"
          ? { path: request.path }
          : {}),
      };
      this.securityEvents.push(event);
      this.onSecurity(event);
      this.events.publish(
        makeEvent("permission_decided", session.sessionId, {
          effect: "deny",
          method,
          reason: decision.reason,
        }),
      );
      throw new AcpRpcError(JSON_RPC_PERMISSION_DENIED, "Permission Denied", {
        reason: decision.reason,
      });
    }
    return decision;
  }

  private context(session: BridgeSession): SupervisionContext {
    return {
      worktreeRoot: session.worktreeRoot,
      writeScope: session.writeScope,
      mode: session.mode,
      cwd: session.cwd,
      ...(session.homeDir !== undefined ? { homeDir: session.homeDir } : {}),
      ...(session.appData !== undefined ? { appData: session.appData } : {}),
      ...(session.leasedTools !== undefined ? { leasedTools: session.leasedTools } : {}),
    };
  }

  private containedPath(session: BridgeSession, requested: string): string {
    return resolveAgainstWorktree(requested, {
      worktreeRoot: session.worktreeRoot,
      cwd: session.cwd,
      ...(session.homeDir !== undefined ? { homeDir: session.homeDir } : {}),
      ...(session.appData !== undefined ? { appData: session.appData } : {}),
    }).absolute;
  }

  private finishTerminal(record: TerminalRecord, result: SandboxedCommandResult): void {
    record.output = this.redactor.redact(result.stdoutSummary);
    record.errorOutput = this.redactor.redact(result.stderrSummary);
    record.exitCode = result.exitCode;
    record.status = record.abort.signal.aborted ? "killed" : "exited";
    this.events.publish(
      makeEvent("tool_call_finished", record.sessionId, {
        command: record.command,
        exitCode: record.exitCode,
        output: record.output,
      }),
    );
  }

  private requireTerminal(session: BridgeSession, terminalId: string): TerminalRecord {
    const record = this.terminals.get(terminalId);
    if (!record || record.sessionId !== session.sessionId) {
      throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, "unknown terminal");
    }
    return record;
  }
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, `${key} must be a string`);
  }
  return value;
}

function sliceLines(text: string, line: number | undefined, limit: number | undefined): string {
  if (line === undefined && limit === undefined) return text;
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, (line ?? 1) - 1);
  const end = limit === undefined ? lines.length : start + limit;
  return lines.slice(start, end).join("\n");
}

function atomicWrite(target: string, content: string): void {
  const temp = path.join(path.dirname(target), `.ef-acp-write-${randomBytes(4).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temp, content, { encoding: "utf8" });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}
