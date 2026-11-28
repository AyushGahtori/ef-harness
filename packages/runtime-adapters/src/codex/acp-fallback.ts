import { GenericAcpAdapter } from "../acp/adapter.js";
import type { NormalizedRuntimeEvent as AcpEvent } from "../acp/types.js";
import { CodexRuntimeError } from "./errors.js";
import type { GenericAcpAdapterPort, GenericAcpSessionSpec } from "./ports.js";
import type { ProcessSpawner } from "./process.js";
import type { NormalizedRuntimeEvent, NormalizedUsage } from "./types.js";
import { emptyUsage } from "./types.js";

export interface AcpEventSink {
  publish(event: NormalizedRuntimeEvent): void;
  now(): number;
}

interface LiveAcp {
  readonly adapter: GenericAcpAdapter;
  readonly sessionId: string;
  nativeSessionId: string;
  pid: number;
}

/**
 * Codex ACP fallback. Framing, permission, and process supervision stay on `GenericAcpAdapter`.
 */
export class CodexGenericAcpBridge implements GenericAcpAdapterPort {
  private readonly sessions = new Map<string, LiveAcp>();

  constructor(
    private readonly spawner: ProcessSpawner,
    private readonly sink: AcpEventSink,
  ) {}

  async startSession(
    spec: GenericAcpSessionSpec,
  ): Promise<{ readonly sessionId: string; readonly nativeSessionId: string; readonly pid: number }> {
    const adapter = new GenericAcpAdapter({
      profile: {
        id: "codex-acp",
        command: spec.command,
        args: spec.args,
        version: "0.0.0",
        envAllowlist: ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "COMSPEC", "WINDIR", "TEMP", "TMP"],
        quirks: {
          protocolVersion: 1,
          mcpTransport: "http",
          tolerateStdoutBanner: false,
          steerMethod: "queue",
        },
      },
      spawn: (request) => {
        const proc = this.spawner({
          command: request.command,
          args: request.args,
          cwd: request.cwd,
          env: request.env,
        });
        return {
          pid: proc.pid,
          stdin: proc.stdin,
          stdout: proc.stdout,
          stderr: proc.stderr,
          once(event, listener) {
            if (event === "exit") proc.onExit((code) => listener(code, null));
          },
          kill() {
            proc.kill();
            return true;
          },
        };
      },
    });
    adapter.eventsBus.subscribe((event) => {
      this.forward(spec.harnessSessionId, event);
    });
    try {
      const opened = await adapter.startSession({
        attemptId: spec.harnessSessionId,
        taskId: spec.harnessSessionId,
        sessionId: spec.harnessSessionId,
        worktreeRoot: spec.worktreeRoot,
        writeScope: spec.writeScope,
        cwd: spec.cwd,
        brief: spec.brief,
        env: definedEnv(spec.env),
        mcpTools: ["kb.*", "harness.run", "harness.read_result"],
      });
      const live: LiveAcp = {
        adapter,
        sessionId: spec.harnessSessionId,
        nativeSessionId: opened.agentSessionId,
        pid: opened.pid,
      };
      this.sessions.set(spec.harnessSessionId, live);
      return { sessionId: spec.harnessSessionId, nativeSessionId: opened.agentSessionId, pid: opened.pid };
    } catch (error) {
      await adapter.dispose();
      if (error instanceof CodexRuntimeError) throw error;
      throw new CodexRuntimeError("protocol_failed", "codex-acp failed to start");
    }
  }

  async sendTurn(
    sessionId: string,
    prompt: string,
  ): Promise<{ readonly turnId: string; readonly stopReason: "completed" | "interrupted" | "failed" }> {
    const live = this.require(sessionId);
    this.sink.publish({
      type: "turn_started",
      sessionId,
      atMs: this.sink.now(),
      threadId: live.nativeSessionId,
    });
    const result = await live.adapter.sendTurn(sessionId, prompt);
    const stopReason = result.stopReason === "cancelled" ? "interrupted" : result.stopReason === "error" ? "failed" : "completed";
    this.sink.publish({
      type: "turn_completed",
      sessionId,
      atMs: this.sink.now(),
      stopReason,
      threadId: live.nativeSessionId,
    });
    return { turnId: `acp-turn-${live.nativeSessionId}`, stopReason };
  }

  async steer(sessionId: string, note: string): Promise<void> {
    await this.sendTurn(sessionId, note);
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.require(sessionId).adapter.interrupt(sessionId);
  }

  async resume(sessionId: string, nativeSessionId: string): Promise<{ readonly ok: boolean; readonly threadId: string }> {
    const live = this.require(sessionId);
    const loaded = await live.adapter.resume(sessionId, nativeSessionId);
    if (!loaded.supported) return { ok: false, threadId: nativeSessionId };
    live.nativeSessionId = nativeSessionId;
    return { ok: true, threadId: nativeSessionId };
  }

  async usage(sessionId: string): Promise<NormalizedUsage> {
    const usage = await this.require(sessionId).adapter.usage(sessionId);
    return {
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
    };
  }

  async close(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    await live.adapter.dispose();
    this.sessions.delete(sessionId);
  }

  private require(sessionId: string): LiveAcp {
    const live = this.sessions.get(sessionId);
    if (!live) throw new CodexRuntimeError("unknown_session", `unknown codex-acp session ${sessionId}`);
    return live;
  }

  private forward(sessionId: string, event: AcpEvent): void {
    if (event.sessionId !== sessionId) return;
    if (event.type === "assistant_delta") {
      const text = typeof event.payload.text === "string" ? event.payload.text : "";
      this.sink.publish({ type: "assistant_delta", sessionId, atMs: this.sink.now(), text });
      return;
    }
    if (event.type === "permission_requested" || event.type === "permission_decided") {
      const requestId = typeof event.payload.requestId === "string" ? event.payload.requestId : "";
      const path = typeof event.payload.path === "string" ? event.payload.path : "";
      const command = typeof event.payload.command === "string" ? event.payload.command : "";
      const effect = event.payload.effect === "allow" ? "allow" : "deny";
      const reason = typeof event.payload.reason === "string" ? event.payload.reason : "";
      const elapsedMs = typeof event.payload.elapsedMs === "number" ? event.payload.elapsedMs : 0;
      this.sink.publish({
        type: event.type,
        sessionId,
        atMs: this.sink.now(),
        requestId,
        ...(path ? { path } : {}),
        ...(command ? { command } : {}),
        ...(event.type === "permission_decided" ? { decision: effect, reason, elapsedMs } : {}),
      });
    }
  }
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") defined[key] = value;
  }
  return defined;
}

export function emptyAcpUsage(): NormalizedUsage {
  return emptyUsage();
}
