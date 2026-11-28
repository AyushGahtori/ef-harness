import { CodexRuntimeError, isCodexRuntimeError } from "./errors.js";
import { asRecord, asString, StdioJsonRpcPeer, type JsonRpcRequest } from "./jsonrpc.js";
import { LocalDeterministicSupervisionPolicyEngine } from "./policy.js";
import type { DeterministicSupervisionPolicyEnginePort, GenericAcpAdapterPort, GenericAcpSessionSpec } from "./ports.js";
import { assertSafeCodexArgs, type ProcessSpawner } from "./process.js";
import { parseUsage } from "./app-server.js";
import { emptyUsage, type NormalizedRuntimeEvent, type NormalizedUsage } from "./types.js";

export interface AcpEventSink {
  publish(event: NormalizedRuntimeEvent): void;
  now(): number;
}

interface AcpLive {
  readonly spec: GenericAcpSessionSpec;
  peer: StdioJsonRpcPeer;
  readonly procPid: number;
  nativeSessionId: string;
  usage: NormalizedUsage;
  kill: () => void;
}

/**
 * Local stand-in for Task 143 `GenericAcpAdapter` driving `codex-acp`.
 * Swap the class for the real adapter at integration; keep this spawn shape.
 */
export class CodexAcpFallbackTransport implements GenericAcpAdapterPort {
  private readonly sessions = new Map<string, AcpLive>();
  private readonly policy: DeterministicSupervisionPolicyEnginePort;

  constructor(
    private readonly spawner: ProcessSpawner,
    private readonly sink: AcpEventSink,
    policy?: DeterministicSupervisionPolicyEnginePort,
  ) {
    this.policy = policy ?? new LocalDeterministicSupervisionPolicyEngine();
  }

  async startSession(
    spec: GenericAcpSessionSpec,
  ): Promise<{ readonly sessionId: string; readonly nativeSessionId: string; readonly pid: number }> {
    assertSafeCodexArgs([spec.command, ...spec.args]);
    const proc = this.spawner({
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
      env: spec.env,
    });
    const live: AcpLive = {
      spec,
      peer: null as unknown as StdioJsonRpcPeer,
      procPid: proc.pid,
      nativeSessionId: "",
      usage: emptyUsage(),
      kill: () => {
        proc.kill();
      },
    };
    const peer = new StdioJsonRpcPeer(proc, {
      onRequest: (request) => {
        this.handleRequest(spec, peer, request);
      },
      onNotification: (notification) => {
        this.handleNotification(spec, live, notification.method, notification.params);
      },
      onProtocolError: () => {
        live.kill();
      },
    });
    live.peer = peer;
    this.sessions.set(spec.harnessSessionId, live);
    try {
      const init = asRecord(
        await peer.request("initialize", {
          clientInfo: { name: "ef-harness", version: "0.0.0" },
          capabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
        }),
      );
      if (!init || init.protocolVersion === undefined) {
        throw new CodexRuntimeError("protocol_failed", "codex-acp initialize failed");
      }
      const created = asRecord(
        await peer.request("session/new", {
          cwd: spec.cwd,
          mcpServers: [{ name: "ef-harness", url: spec.mcpEndpoint }],
        }),
      );
      const nativeSessionId = asString(created?.sessionId);
      if (!nativeSessionId) {
        throw new CodexRuntimeError("protocol_failed", "codex-acp session/new did not return sessionId");
      }
      live.nativeSessionId = nativeSessionId;
      return { sessionId: spec.harnessSessionId, nativeSessionId, pid: proc.pid };
    } catch (error) {
      proc.kill();
      this.sessions.delete(spec.harnessSessionId);
      if (isCodexRuntimeError(error)) throw error;
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
    const result = asRecord(
      await live.peer.request("session/prompt", {
        sessionId: live.nativeSessionId,
        prompt: [{ type: "text", text: prompt }],
      }),
    );
    const stopRaw = asString(result?.stopReason);
    const stopReason = stopRaw === "cancelled" ? "interrupted" : stopRaw === "error" ? "failed" : "completed";
    const turnId = asString(result?.turnId) ?? `acp-turn-${live.nativeSessionId}`;
    this.sink.publish({
      type: "usage_reported",
      sessionId,
      atMs: this.sink.now(),
      usage: live.usage,
      threadId: live.nativeSessionId,
    });
    this.sink.publish({
      type: "turn_completed",
      sessionId,
      atMs: this.sink.now(),
      stopReason,
      threadId: live.nativeSessionId,
    });
    return { turnId, stopReason };
  }

  async steer(sessionId: string, note: string): Promise<void> {
    await this.sendTurn(sessionId, note);
  }

  async interrupt(sessionId: string): Promise<void> {
    const live = this.require(sessionId);
    try {
      await live.peer.request("session/cancel", { sessionId: live.nativeSessionId }, 400);
    } catch (error) {
      if (!isCodexRuntimeError(error)) throw error;
      live.kill();
    }
  }

  async resume(sessionId: string, nativeSessionId: string): Promise<{ readonly ok: boolean; readonly threadId: string }> {
    const live = this.require(sessionId);
    try {
      const result = asRecord(await live.peer.request("session/load", { sessionId: nativeSessionId }));
      const loaded = asString(result?.sessionId) ?? nativeSessionId;
      if (result?.ok === false) return { ok: false, threadId: nativeSessionId };
      live.nativeSessionId = loaded;
      return { ok: true, threadId: loaded };
    } catch (error) {
      if (isCodexRuntimeError(error) && error.code === "rpc_error") return { ok: false, threadId: nativeSessionId };
      throw error;
    }
  }

  usage(sessionId: string): Promise<NormalizedUsage> {
    return Promise.resolve(this.require(sessionId).usage);
  }

  async close(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    live.kill();
    this.sessions.delete(sessionId);
  }

  private require(sessionId: string): AcpLive {
    const live = this.sessions.get(sessionId);
    if (!live) throw new CodexRuntimeError("unknown_session", `unknown codex-acp session ${sessionId}`);
    return live;
  }

  private handleRequest(spec: GenericAcpSessionSpec, peer: StdioJsonRpcPeer, request: JsonRpcRequest): void {
    if (request.method !== "session/request_permission") {
      peer.respond(request.id, { outcome: "reject_once" });
      return;
    }
    const params = asRecord(request.params);
    const tool = asRecord(params?.toolCall);
    const kind = asString(tool?.kind);
    const filePath = asString(tool?.path);
    const command = asString(tool?.command);
    const requestId = String(request.id);
    this.sink.publish({
      type: "permission_requested",
      sessionId: spec.harnessSessionId,
      atMs: this.sink.now(),
      requestId,
      ...(filePath ? { path: filePath } : {}),
      ...(command ? { command } : {}),
    });
    const decision = this.policy.decide({
      worktreeRoot: spec.worktreeRoot,
      writeScope: spec.writeScope,
      request:
        kind === "execute" || command
          ? { kind: "shell", command: command ?? "" }
          : { kind: "edit", path: filePath ?? "" },
    });
    this.sink.publish({
      type: "permission_decided",
      sessionId: spec.harnessSessionId,
      atMs: this.sink.now(),
      requestId,
      decision: decision.effect,
      reason: decision.reason,
      elapsedMs: decision.elapsedMs,
      ...(filePath ? { path: filePath } : {}),
      ...(command ? { command } : {}),
    });
    peer.respond(request.id, { outcome: decision.effect === "allow" ? "allow_once" : "reject_once" });
  }

  private handleNotification(spec: GenericAcpSessionSpec, live: AcpLive, method: string, params: unknown): void {
    if (method !== "session/update") return;
    const update = asRecord(asRecord(params)?.update);
    const kind = asString(update?.sessionUpdate);
    if (kind === "agent_message_chunk") {
      const text = asString(asRecord(update?.content)?.text) ?? "";
      this.sink.publish({
        type: "assistant_delta",
        sessionId: spec.harnessSessionId,
        atMs: this.sink.now(),
        text,
      });
      return;
    }
    if (kind === "usage_update") {
      live.usage = parseUsage(update?.usage ?? update);
    }
  }
}
