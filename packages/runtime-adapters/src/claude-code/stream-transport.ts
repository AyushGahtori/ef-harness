import { randomUUID } from "node:crypto";
import { ClaudeCodeAdapterError } from "./errors.js";
import { NormalizedRuntimeEventBus } from "./event-bus.js";
import type { ClaudeLaunchPlan } from "./launch-plan.js";
import type { PermissionPrompt } from "./permission-controller.js";
import type { PacketSecurityRedactorPort, ProcessSpawner, SpawnedChild, WindowsJobSupervisorPort } from "./ports.js";
import { isRecord } from "./records.js";
import {
  emptyUsage,
  parseClaudeLine,
  type ParsedClaudeLine,
} from "./stream-parse.js";
import type {
  ClaudePermissionDecision,
  ClaudeTokenUsage,
  NormalizedEventType,
  PermissionOutcome,
} from "./types.js";

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const STDERR_CAP = 16 * 1024;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  settled: boolean;
}

interface LiveProcess {
  readonly sessionId: string;
  readonly child: SpawnedChild;
  readonly jobId: string;
  readonly onPermission: (prompt: PermissionPrompt) => PermissionOutcome;
  buffer: string;
  stderr: string;
  exited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  exitEmitted: boolean;
  claudeSessionId: string | null;
  usage: ClaudeTokenUsage;
  providerCostUsd: string | null;
  lastSubtype: string | null;
  hasResult: boolean;
  interruptRequested: boolean;
  readonly init: Deferred<string>;
  pending: Deferred<Extract<ParsedClaudeLine, { kind: "result" }>> | null;
  readonly decisions: Map<string, ClaudePermissionDecision>;
}

export interface TransportStart {
  readonly sessionId: string;
  readonly plan: ClaudeLaunchPlan;
  readonly jobId: string;
  readonly onPermission: (prompt: PermissionPrompt) => PermissionOutcome;
}

/**
 * Newline-delimited `stream-json` stdio for an unmodified `claude -p` child.
 */
export class ClaudeStreamJsonTransport {
  private readonly processes = new Map<string, LiveProcess>();

  constructor(
    private readonly spawner: ProcessSpawner,
    private readonly jobs: WindowsJobSupervisorPort,
    private readonly bus: NormalizedRuntimeEventBus,
    private readonly redactor: PacketSecurityRedactorPort,
    private readonly interruptGraceMs = 500,
    private readonly initTimeoutMs = 5_000,
    private readonly turnTimeoutMs = 8_000,
  ) {}

  async start(input: TransportStart): Promise<string> {
    const child = this.spawner.spawn(input.plan.command, input.plan.args, {
      cwd: input.plan.cwd,
      env: input.plan.env,
    });
    const live: LiveProcess = {
      sessionId: input.sessionId,
      child,
      jobId: input.jobId,
      onPermission: input.onPermission,
      buffer: "",
      stderr: "",
      exited: false,
      exitCode: null,
      exitSignal: null,
      exitEmitted: false,
      claudeSessionId: null,
      usage: emptyUsage(),
      providerCostUsd: null,
      lastSubtype: null,
      hasResult: false,
      interruptRequested: false,
      init: defer<string>(),
      pending: null,
      decisions: new Map(),
    };
    this.processes.set(input.sessionId, live);
    this.attach(live);
    if (typeof child.pid === "number" && child.pid > 0) await this.jobs.attach(input.jobId, child.pid);
    try {
      const claudeSessionId = await withTimeout(live.init.promise, this.initTimeoutMs, "init_timeout");
      if (!claudeSessionId) {
        throw new ClaudeCodeAdapterError("missing_session", "Claude Code did not return a session_id");
      }
      return claudeSessionId;
    } catch (error) {
      await this.jobs.kill(input.jobId, "start_failed");
      child.kill("SIGTERM");
      throw error;
    }
  }

  async sendUserMessage(sessionId: string, text: string): Promise<Extract<ParsedClaudeLine, { kind: "result" }>> {
    const live = this.require(sessionId);
    if (live.pending && !live.pending.settled) {
      throw new ClaudeCodeAdapterError("turn_in_flight", "A Claude Code turn is already waiting for a result");
    }
    const pending = defer<Extract<ParsedClaudeLine, { kind: "result" }>>();
    live.pending = pending;
    this.emit(sessionId, "turn_started", { text });
    this.write(live, userMessage(text));
    try {
      return await withTimeout(pending.promise, this.turnTimeoutMs, "turn_timeout");
    } catch (error) {
      if (!pending.settled) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
        pending.settled = true;
      }
      throw error;
    }
  }

  turnInFlight(sessionId: string): boolean {
    const pending = this.require(sessionId).pending;
    return Boolean(pending && !pending.settled);
  }

  writeSteer(sessionId: string, text: string): void {
    const live = this.require(sessionId);
    this.write(live, userMessage(text));
  }

  decision(sessionId: string, requestId: string): ClaudePermissionDecision | null {
    return this.require(sessionId).decisions.get(requestId) ?? null;
  }

  usage(sessionId: string): ClaudeTokenUsage {
    return { ...this.require(sessionId).usage };
  }

  providerCostUsd(sessionId: string): string | null {
    return this.require(sessionId).providerCostUsd;
  }

  hasResult(sessionId: string): boolean {
    return this.require(sessionId).hasResult;
  }

  claudeSessionId(sessionId: string): string | null {
    return this.require(sessionId).claudeSessionId;
  }

  stderrTail(sessionId: string): string {
    return this.require(sessionId).stderr;
  }

  async interrupt(sessionId: string): Promise<{ readonly elapsedMs: number; readonly forced: boolean }> {
    const live = this.require(sessionId);
    if (live.exited) return { elapsedMs: 0, forced: false };
    const started = performance.now();
    const deadline = started + this.interruptGraceMs;
    live.interruptRequested = true;
    this.write(live, {
      type: "control_request",
      request_id: randomUUID(),
      request: { subtype: "interrupt" },
    });
    let exited = await waitUntilExited(live, Math.min(50, this.interruptGraceMs));
    if (!exited) {
      live.child.kill("SIGINT");
      exited = await waitUntilExited(live, Math.max(0, deadline - performance.now()));
    }
    let forced = false;
    if (!exited) {
      forced = true;
      await this.jobs.kill(live.jobId, "interrupt_grace_elapsed");
      exited = await waitUntilExited(live, 2_000);
    }
    this.emitExit(live, "interrupt");
    if (live.pending && !live.pending.settled) {
      live.pending.reject(new ClaudeCodeAdapterError("interrupted", "Claude Code turn was interrupted"));
      live.pending.settled = true;
    }
    return { elapsedMs: performance.now() - started, forced };
  }

  private attach(live: LiveProcess): void {
    live.child.stdout?.on("data", (chunk: Buffer | string) => {
      this.onStdout(live, typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    live.child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = this.redactor.redact(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      live.stderr = `${live.stderr}${text}`.slice(-STDERR_CAP);
    });
    live.child.on("error", (error) => {
      if (!live.init.settled) {
        live.init.reject(new ClaudeCodeAdapterError("spawn_failed", error.message));
        live.init.settled = true;
      }
    });
    live.child.on("exit", (code, signal) => {
      this.onStdout(live, "");
      this.flushRemainder(live);
      live.exited = true;
      live.exitCode = code;
      live.exitSignal = signal;
      this.emitExit(live, "exit");
      if (!live.init.settled) {
        live.init.reject(
          new ClaudeCodeAdapterError("exited_before_init", `Claude Code exited before init (${code ?? signal ?? "unknown"})`),
        );
        live.init.settled = true;
      }
      if (live.pending && !live.pending.settled) {
        live.pending.reject(
          new ClaudeCodeAdapterError(
            "nonzero_exit",
            `Claude Code exited ${code ?? signal ?? "unknown"} before a result`,
          ),
        );
        live.pending.settled = true;
      }
    });
  }

  private onStdout(live: LiveProcess, chunk: string): void {
    live.buffer += chunk;
    if (live.buffer.length > MAX_LINE_BYTES && !live.buffer.includes("\n")) {
      live.buffer = "";
      this.emit(live.sessionId, "session_error", {
        kind: "other",
        message: "Claude Code emitted an oversized stream frame",
      });
      void this.jobs.kill(live.jobId, "oversized_frame");
      return;
    }
    this.drain(live);
  }

  private drain(live: LiveProcess): void {
    for (;;) {
      const newline = live.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = live.buffer.slice(0, newline).replace(/\r$/, "");
      live.buffer = live.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      this.handleLine(live, this.redactor.redact(line));
    }
  }

  private flushRemainder(live: LiveProcess): void {
    const line = live.buffer.replace(/\r$/, "").trim();
    live.buffer = "";
    if (!line) return;
    this.handleLine(live, this.redactor.redact(line));
  }

  private handleLine(live: LiveProcess, line: string): void {
    const parsed = parseClaudeLine(line);
    if (parsed.kind === "ignore") return;
    if (parsed.kind === "init") {
      live.claudeSessionId = parsed.sessionId;
      if (!live.init.settled) {
        live.init.resolve(parsed.sessionId);
        live.init.settled = true;
      }
      return;
    }
    if (parsed.kind === "assistant") {
      if (parsed.usage) live.usage = parsed.usage;
      for (const text of parsed.texts) this.emit(live.sessionId, "assistant_delta", { text });
      for (const tool of parsed.toolUses) {
        this.emit(live.sessionId, "tool_call_requested", {
          id: tool.id,
          name: tool.name,
          input: tool.input,
        });
      }
      return;
    }
    if (parsed.kind === "tool_result") {
      this.emit(live.sessionId, "tool_call_finished", {
        toolUseId: parsed.toolUseId,
        text: parsed.text,
      });
      return;
    }
    if (parsed.kind === "permission") {
      this.answerPermission(live, parsed);
      return;
    }
    if (parsed.kind === "rate_limit") {
      this.emit(live.sessionId, "rate_limited", {});
      return;
    }
    live.usage = parsed.usage;
    live.providerCostUsd = parsed.totalCostUsd;
    live.lastSubtype = parsed.subtype;
    live.hasResult = true;
    if (parsed.sessionId) live.claudeSessionId = parsed.sessionId;
    this.emit(live.sessionId, "usage_reported", {
      ...parsed.usage,
      totalCostUsd: parsed.totalCostUsd,
      subtype: parsed.subtype,
    });
    if (parsed.subtype === "error_max_budget_usd") {
      this.emit(live.sessionId, "session_error", {
        kind: "billing",
        subtype: parsed.subtype,
        handoff: ["Task-059", "Task-128"],
      });
    } else if (parsed.isError) {
      this.emit(live.sessionId, "session_error", { kind: "other", subtype: parsed.subtype });
    }
    this.emit(live.sessionId, "turn_completed", { stopReason: parsed.subtype });
    if (live.pending && !live.pending.settled) {
      live.pending.resolve(parsed);
      live.pending.settled = true;
    }
  }

  private answerPermission(live: LiveProcess, parsed: Extract<ParsedClaudeLine, { kind: "permission" }>): void {
    const prompt: PermissionPrompt = {
      requestId: parsed.requestId,
      toolName: parsed.toolName,
      input: parsed.input,
      ...(parsed.toolUseId ? { toolUseId: parsed.toolUseId } : {}),
    };
    const outcome = live.onPermission(prompt);
    live.decisions.set(parsed.requestId, outcome.decision);
    this.emit(live.sessionId, "permission_requested", {
      requestId: parsed.requestId,
      toolName: parsed.toolName,
      input: parsed.input,
    });
    this.write(live, controlResponse(parsed.requestId, outcome.decision));
    this.emit(live.sessionId, "permission_decided", {
      requestId: parsed.requestId,
      behavior: outcome.decision.behavior,
      elapsedMs: outcome.elapsedMs,
      ...(outcome.decision.behavior === "deny" ? { message: outcome.decision.message } : {}),
    });
    if (outcome.decision.behavior === "allow" && (outcome.request.kind === "edit" || outcome.request.kind === "write")) {
      this.emit(live.sessionId, "tool_call_started", { toolName: parsed.toolName, path: outcome.request.path });
      this.emit(live.sessionId, "file_edited", { path: outcome.request.path });
    }
  }

  private emitExit(live: LiveProcess, how: "exit" | "interrupt"): void {
    if (live.exitEmitted) return;
    if (how === "interrupt" && !live.exited) return;
    live.exitEmitted = true;
    const abnormal = live.exitCode !== 0 && live.exitCode !== null;
    this.emit(live.sessionId, "session_exited", {
      code: live.exitCode,
      signal: live.exitSignal,
      abnormal: abnormal || live.interruptRequested,
      stderr: live.stderr,
      how,
    });
  }

  private emit(sessionId: string, type: NormalizedEventType, payload: Record<string, unknown>): void {
    const redacted = this.redactor.redactValue(payload);
    this.bus.publish({
      type,
      sessionId,
      at: new Date().toISOString(),
      payload: isRecord(redacted) ? redacted : {},
    });
  }

  private write(live: LiveProcess, value: unknown): void {
    const stdin = live.child.stdin;
    if (!stdin) throw new ClaudeCodeAdapterError("stdin_closed", "Claude Code stdin is not available");
    stdin.write(`${JSON.stringify(value)}\n`);
  }

  private require(sessionId: string): LiveProcess {
    const live = this.processes.get(sessionId);
    if (!live) throw new ClaudeCodeAdapterError("unknown_session", `Unknown Claude Code session ${sessionId}`);
    return live;
  }
}

function userMessage(text: string): unknown {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
}

function controlResponse(requestId: string, decision: ClaudePermissionDecision): unknown {
  const response =
    decision.behavior === "allow"
      ? decision.updatedInput
        ? { behavior: "allow", updatedInput: decision.updatedInput }
        : { behavior: "allow" }
      : { behavior: "deny", message: decision.message };
  return {
    type: "control_response",
    response: { subtype: "success", request_id: requestId, response },
  };
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject, settled: false };
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ClaudeCodeAdapterError(code, `Claude Code timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function waitUntilExited(live: LiveProcess, ms: number): Promise<boolean> {
  if (live.exited) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(live.exited), ms);
    live.child.once("exit", () => finish(true));
  });
}
