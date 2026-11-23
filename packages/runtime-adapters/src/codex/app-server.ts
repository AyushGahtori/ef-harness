import { CodexRuntimeError, isCodexRuntimeError } from "./errors.js";
import { asNumber, asRecord, asString, StdioJsonRpcPeer, type JsonRpcRequest } from "./jsonrpc.js";
import type { SpawnedProcess } from "./process.js";
import { emptyUsage, type NormalizedUsage } from "./types.js";

export interface TurnCompleted {
  readonly turnId: string;
  readonly status: "completed" | "interrupted" | "failed";
  readonly usage: NormalizedUsage;
}

export interface ApprovalReply {
  readonly decision: "accept" | "decline";
  readonly reason: string;
  readonly elapsedMs: number;
}

export type ApprovalHandler = (input: {
  readonly requestId: string;
  readonly method: "item/fileChange/requestApproval" | "item/commandExecution/requestApproval";
  readonly path: string | null;
  readonly command: string | null;
}) => ApprovalReply;

interface Deferred<T> {
  settled: boolean;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  readonly promise: Promise<T>;
}

export class CodexAppServerClient {
  private readonly peer: StdioJsonRpcPeer;
  private nextTurn: Deferred<TurnCompleted> | null = null;
  private exited = false;
  threadId: string | null = null;

  constructor(
    private readonly proc: SpawnedProcess,
    private readonly onApproval: ApprovalHandler,
    private readonly onEvent: (method: string, params: unknown) => void,
  ) {
    this.peer = new StdioJsonRpcPeer(proc, {
      onRequest: (request) => {
        this.handleRequest(request);
      },
      onNotification: (notification) => {
        this.handleNotification(notification.method, notification.params);
      },
      onProtocolError: (error) => {
        this.nextTurn?.reject(error);
      },
    });
    proc.onExit((code) => {
      this.exited = true;
      this.nextTurn?.reject(
        new CodexRuntimeError("process_exit", `codex app-server exited with code ${code ?? "null"}`),
      );
    });
  }

  get pid(): number {
    return this.proc.pid;
  }

  get closed(): boolean {
    return this.exited || this.peer.isClosed;
  }

  async initialize(): Promise<void> {
    let result: unknown;
    try {
      result = await this.peer.request("initialize", {
        clientInfo: { name: "ef-harness", version: "0.0.0" },
        capabilities: { approvals: true },
      });
    } catch (error) {
      throw asProtocolFailure(error);
    }
    const record = asRecord(result);
    if (!record || typeof record.protocolVersion !== "string" || record.protocolVersion.length === 0) {
      throw new CodexRuntimeError(
        "protocol_failed",
        "codex app-server initialize did not advertise protocolVersion",
      );
    }
  }

  async threadStart(input: { readonly cwd: string; readonly model: string; readonly brief: string }): Promise<string> {
    const result = asRecord(
      await this.peer.request("thread/start", {
        cwd: input.cwd,
        model: input.model,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        developerInstructions: input.brief,
      }),
    );
    const threadId = asString(result?.threadId);
    if (!threadId) {
      throw new CodexRuntimeError("protocol_failed", "thread/start did not return threadId");
    }
    this.threadId = threadId;
    return threadId;
  }

  async threadResume(threadId: string): Promise<{ readonly ok: boolean; readonly threadId: string }> {
    try {
      const result = asRecord(await this.peer.request("thread/resume", { threadId }));
      const resumed = asString(result?.threadId);
      if (!resumed) return { ok: false, threadId };
      this.threadId = resumed;
      return { ok: true, threadId: resumed };
    } catch (error) {
      if (isCodexRuntimeError(error) && error.code === "rpc_error") return { ok: false, threadId };
      throw error;
    }
  }

  async turnStart(threadId: string, prompt: string): Promise<string> {
    this.nextTurn = defer<TurnCompleted>();
    const result = asRecord(
      await this.peer.request("turn/start", {
        threadId,
        input: prompt,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      }),
    );
    const turnId = asString(result?.turnId);
    if (!turnId) {
      throw new CodexRuntimeError("protocol_failed", "turn/start did not return turnId");
    }
    return turnId;
  }

  waitForTurn(): Promise<TurnCompleted> {
    if (!this.nextTurn) {
      return Promise.reject(new CodexRuntimeError("no_turn", "no Codex turn is active"));
    }
    return this.nextTurn.promise;
  }

  async turnInterrupt(threadId: string, turnId: string, timeoutMs: number): Promise<void> {
    await this.peer.request("turn/interrupt", { threadId, turnId }, timeoutMs);
  }

  readRateLimits(): Promise<unknown> {
    return this.peer.request("account/rateLimits/read", {});
  }

  kill(): void {
    this.proc.kill();
  }

  private handleRequest(request: JsonRpcRequest): void {
    if (
      request.method !== "item/fileChange/requestApproval" &&
      request.method !== "item/commandExecution/requestApproval"
    ) {
      this.peer.respond(request.id, { decision: "decline", reason: "unsupported approval method" });
      return;
    }
    const params = asRecord(request.params);
    const reply = this.onApproval({
      requestId: String(request.id),
      method: request.method,
      path: asString(params?.path),
      command: asString(params?.command),
    });
    this.peer.respond(request.id, { decision: reply.decision, reason: reply.reason });
  }

  private handleNotification(method: string, params: unknown): void {
    this.onEvent(method, params);
    if (method !== "turn/completed") return;
    const record = asRecord(params);
    const statusRaw = asString(record?.status);
    const status = statusRaw === "interrupted" || statusRaw === "failed" ? statusRaw : "completed";
    const turnId = asString(record?.turnId) ?? "turn";
    this.nextTurn?.resolve({
      turnId,
      status,
      usage: parseUsage(record?.usage),
    });
  }
}

export function parseUsage(value: unknown): NormalizedUsage {
  const record = asRecord(value);
  if (!record) return emptyUsage();
  return {
    inputTokens: asNumber(record.inputTokens) ?? asNumber(record.input_tokens) ?? 0,
    cachedInputTokens: asNumber(record.cachedInputTokens) ?? asNumber(record.cached_input_tokens) ?? 0,
    outputTokens: asNumber(record.outputTokens) ?? asNumber(record.output_tokens) ?? 0,
    reasoningTokens: asNumber(record.reasoningTokens) ?? asNumber(record.reasoning_tokens) ?? 0,
  };
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const deferred: Deferred<T> = {
    settled: false,
    promise,
    resolve: (value) => {
      if (deferred.settled) return;
      deferred.settled = true;
      resolve(value);
    },
    reject: (error) => {
      if (deferred.settled) return;
      deferred.settled = true;
      reject(error);
    },
  };
  return deferred;
}

function asProtocolFailure(error: unknown): CodexRuntimeError {
  if (isCodexRuntimeError(error) && error.code === "protocol_failed") return error;
  if (isCodexRuntimeError(error)) {
    return new CodexRuntimeError("protocol_failed", error.message);
  }
  return new CodexRuntimeError("protocol_failed", "codex app-server initialize failed");
}
