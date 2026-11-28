import type { ChildProcess } from "node:child_process";
import { AcpRpcError } from "./errors.js";
import type { ProcessSpawner, SpawnRequest } from "./process-util.js";
import type { LocalJobObject, McpServerSpec, PermissionDecision } from "./ports.js";
import {
  parseSupervisionRequest,
  type LocalSupervisionPolicyEngine,
  type SupervisionContext,
} from "./supervision.js";

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const FRAME_CAP = 8 * 1024 * 1024;

/**
 * Local port of Task 143 GenericAcpAdapter.
 * Speaks newline-delimited JSON-RPC with unmodified `gemini --acp`.
 */
export class LocalGenericAcpAdapter {
  private child: ChildProcess | null = null;
  private buffer = "";
  private nextId = 0;
  private readonly waiters = new Map<number, Waiter>();
  private readonly decisions = new Map<string, PermissionDecision>();
  private context: SupervisionContext = { mode: "wrapped", worktree: process.cwd(), writeScope: [] };
  private updateListener: ((update: unknown) => void) | null = null;
  private permissionListener: ((decision: PermissionDecision) => void) | null = null;
  readonly stderrLines: string[] = [];
  private closed = false;

  constructor(
    private readonly spawner: ProcessSpawner,
    private readonly policy: LocalSupervisionPolicyEngine,
    private readonly job: LocalJobObject,
  ) {}

  setContext(context: SupervisionContext): void {
    this.context = context;
  }

  onUpdate(listener: (update: unknown) => void): void {
    this.updateListener = listener;
  }

  onPermission(listener: (decision: PermissionDecision) => void): void {
    this.permissionListener = listener;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  storedDecision(requestId: string): PermissionDecision | null {
    return this.decisions.get(requestId) ?? null;
  }

  async start(request: SpawnRequest): Promise<void> {
    const child = this.spawner(request);
    this.child = child;
    await this.job.attach(child);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr?.on("data", (chunk: string) => {
      this.stderrLines.push(chunk);
    });
    child.on("exit", () => {
      this.rejectAll(new Error("gemini process exited"));
    });
    child.on("error", (error) => {
      this.rejectAll(error);
    });
  }

  async initialize(): Promise<Record<string, unknown>> {
    const result = await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "ef-harness", version: "0.0.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    return asRecord(result);
  }

  async newSession(input: {
    readonly cwd: string;
    readonly mcpServers: readonly McpServerSpec[];
  }): Promise<{ sessionId: string; raw: Record<string, unknown> }> {
    const raw = asRecord(
      await this.request("session/new", {
        cwd: input.cwd,
        mcpServers: input.mcpServers.map((server) => ({
          name: server.name,
          type: "http",
          url: server.endpoint,
          headers: { authorization: `Bearer ${server.bearer}` },
        })),
      }),
    );
    const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : "";
    if (!sessionId) throw new AcpRpcError("session/new returned no sessionId", raw);
    return { sessionId, raw };
  }

  async prompt(sessionId: string, text: string): Promise<Record<string, unknown>> {
    const raw = asRecord(
      await this.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      }),
    );
    return raw;
  }

  async cancel(sessionId: string): Promise<void> {
    await this.request("session/cancel", { sessionId }, 400).catch(() => undefined);
  }

  async load(sessionId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.request("session/load", { sessionId }));
  }

  respondPermission(requestId: string, outcome: PermissionDecision["outcome"]): PermissionDecision {
    const existing = this.decisions.get(requestId);
    if (existing) return existing;
    const decided: PermissionDecision = {
      requestId,
      outcome,
      reason: "explicit_response",
      harnessRun: null,
    };
    this.decisions.set(requestId, decided);
    return decided;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    child?.stdin?.end();
    await this.job.terminate();
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await waitForExit(child);
    this.rejectAll(new Error("ACP session closed"));
  }

  private request(method: string, params: unknown, timeoutMs = 15_000): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.waiters.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private send(message: RpcMessage): void {
    const line = JSON.stringify(message);
    if (line.length > FRAME_CAP) throw new AcpRpcError("ACP frame exceeds 8 MB", null);
    this.child?.stdin?.write(`${line}\n`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > FRAME_CAP) {
      this.rejectAll(new AcpRpcError("ACP frame exceeds 8 MB", null));
      this.buffer = "";
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.onLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.stderrLines.push(line);
      return;
    }
    if (message.method && message.id !== undefined && message.result === undefined && message.error === undefined) {
      this.handleServerRequest(message);
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const id = typeof message.id === "number" ? message.id : Number(message.id);
      const waiter = this.waiters.get(id);
      if (!waiter) return;
      this.waiters.delete(id);
      if (message.error) {
        waiter.reject(new AcpRpcError(message.error.message ?? "ACP error", message.error.data ?? null));
        return;
      }
      waiter.resolve(message.result);
      return;
    }
    if (message.method === "session/update") {
      const params = asRecord(message.params);
      const update = params.update ?? params;
      this.updateListener?.(update);
    }
  }

  private handleServerRequest(message: RpcMessage): void {
    if (message.id === undefined) return;
    const requestId = String(message.id);
    if (message.method === "session/request_permission") {
      const parsed = parseSupervisionRequest(message.params, requestId);
      const decided = this.policy.decide(parsed, this.context);
      this.decisions.set(requestId, decided);
      this.permissionListener?.(decided);
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        result: { outcome: { outcome: decided.outcome, reason: decided.reason } },
      });
      return;
    }
    this.send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "method not found" },
    });
  }

  private rejectAll(error: Error): void {
    for (const waiter of this.waiters.values()) waiter.reject(error);
    this.waiters.clear();
  }
}

function waitForExit(child: ChildProcess | null): Promise<void> {
  if (!child) return Promise.resolve();
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 1_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}
