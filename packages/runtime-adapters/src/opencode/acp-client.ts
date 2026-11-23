import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import { OpenCodeAdapterError } from "./errors.js";
import { isRecord } from "./json.js";
import { commandForBinary } from "./spawn.js";
import { ACP_FRAME_LIMIT_BYTES } from "./types.js";

export interface JsonRpcRequest {
  readonly id: number | string;
  readonly method: string;
  readonly params: unknown;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface AcpSpawnRequest {
  readonly binaryPath: string;
  readonly env: Record<string, string>;
  readonly cwd: string;
}

/**
 * Local stand-in for Task 143 `GenericAcpAdapter` / `AcpJsonRpcTransport`.
 * Newline-delimited JSON-RPC 2.0 on stdin/stdout. Stderr stays off the frame stream.
 */
export class LocalGenericAcpClient {
  spawn(request: AcpSpawnRequest): AcpConnection {
    const invoked = commandForBinary(request.binaryPath, ["acp"]);
    const child = spawn(invoked.command, invoked.args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    return new AcpConnection(child);
  }
}

export class AcpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private agentRequestHandler: ((request: JsonRpcRequest) => Promise<unknown>) | null = null;
  private notificationHandler: ((method: string, params: unknown) => void) | null = null;
  private protocolErrorHandler: ((error: Error) => void) | null = null;
  private sawJson = false;
  private stderrText = "";
  private closed = false;

  constructor(private readonly child: ChildProcess) {
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr || !child.stdin) {
      throw new OpenCodeAdapterError("protocol", "ACP stdio pipes were not created");
    }
    const lines = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      void this.onLine(line);
    });
    stderr.setEncoding("utf8");
    stderr.on("data", (chunk: string) => {
      this.stderrText = `${this.stderrText}${chunk}`.slice(-65_536);
    });
    child.on("exit", () => {
      this.rejectAll(new OpenCodeAdapterError("protocol", "opencode acp exited"));
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get stderr(): string {
    return this.stderrText;
  }

  onAgentRequest(handler: (request: JsonRpcRequest) => Promise<unknown>): void {
    this.agentRequestHandler = handler;
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler;
  }

  onProtocolError(handler: (error: Error) => void): void {
    this.protocolErrorHandler = handler;
  }

  request(method: string, params: unknown, timeoutMs = 15_000): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OpenCodeAdapterError("protocol", `${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new OpenCodeAdapterError("protocol", "ACP write failed"));
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin?.end();
    if (this.child.pid && !this.child.killed) {
      try {
        this.child.kill();
      } catch {
        /* already gone */
      }
    }
  }

  private write(message: unknown): void {
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > ACP_FRAME_LIMIT_BYTES) {
      throw new OpenCodeAdapterError("frame_too_large", "ACP frame exceeds 8 MB");
    }
    this.child.stdin?.write(`${payload}\n`);
  }

  private async onLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("{")) {
      if (this.sawJson) {
        this.failProtocol(new OpenCodeAdapterError("protocol", "non-JSON stdout corrupted the ACP stream"));
      }
      return;
    }
    if (Buffer.byteLength(trimmed) > ACP_FRAME_LIMIT_BYTES) {
      this.failProtocol(new OpenCodeAdapterError("frame_too_large", "ACP frame exceeds 8 MB"));
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      this.failProtocol(error instanceof Error ? error : new OpenCodeAdapterError("protocol", "invalid JSON"));
      return;
    }
    if (!isRecord(message)) return;
    this.sawJson = true;
    const method = typeof message.method === "string" ? message.method : null;
    if (method && (typeof message.id === "number" || typeof message.id === "string")) {
      const handler = this.agentRequestHandler;
      if (!handler) return;
      try {
        const result = await handler({ id: message.id, method, params: message.params });
        this.write({ jsonrpc: "2.0", id: message.id, result });
      } catch (error) {
        const text = error instanceof Error ? error.message : "permission failed";
        this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32003, message: text } });
      }
      return;
    }
    if (method && message.id === undefined) {
      this.notificationHandler?.(method, message.params);
      return;
    }
    if ((typeof message.id === "number" || typeof message.id === "string") && !method) {
      const id = typeof message.id === "number" ? message.id : Number.NaN;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.error !== undefined) {
        const record = isRecord(message.error) ? message.error : {};
        const text = typeof record.message === "string" ? record.message : "ACP error";
        pending.reject(new OpenCodeAdapterError("protocol", text));
        return;
      }
      pending.resolve(message.result);
    }
  }

  private failProtocol(error: Error): void {
    this.protocolErrorHandler?.(error);
    this.rejectAll(error);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
