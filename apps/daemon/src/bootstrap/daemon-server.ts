import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  BINARY_CHUNK_BYTES,
  CURRENT_PROTOCOL,
  INITIAL_STREAM_CREDITS,
  JSON_RPC_CHANNEL,
  MAX_CREDIT_GRANT,
  MAX_OUTSTANDING_CREDITS,
  M1_PROJECT_ID,
  RPC_AUTH_FAILED,
  RPC_INTERNAL_ERROR,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_OP_CONFLICT,
  RPC_PROTOCOL_MISMATCH,
  SNAPSHOT_SECTION_MAX_BYTES,
  SUPPORTED_PROTOCOLS,
} from "./constants.js";
import {
  checkpointTruncate,
  openHarnessDatabases,
  type OpenDatabases,
  type SqlDb,
  type WalCheckpoint,
} from "./databases.js";
import { daemonLockHeld, writeDaemonLock } from "./process-lock.js";
import { FrameCodec } from "./frame-codec.js";
import { PipeInUseError } from "./errors.js";
import {
  globalDatabasePath,
  lockFilePath,
  logFilePath,
  readyFilePath,
  sessionTokenPath,
  shutdownReceiptPath,
  stateDatabasePath,
} from "./paths.js";
import { generateSessionToken, timingSafeTokenEqual, writeSessionToken } from "./session-token.js";
import { explainCockpit } from "../cockpit/explain.js";
import { readBoardProjection } from "../cockpit/board-projection.js";
import {
  InspectorInboxError,
  fetchDiffRange,
  fetchLogChunk,
  fetchScreenshot,
  locateLineWindow,
  readResult,
  reconcileQuestion,
  runProbe,
  sliceForTask,
  storeSecret,
  type InspectorInboxContext,
} from "../cockpit/inspector-inbox.js";
import { recordHealthMetric } from "../cockpit/telemetry.js";
import { isM1View, sha256, SimulatedTask, type M1View } from "./task-run.js";

export interface HarnessdOptions {
  readonly profileDir: string;
  readonly pipePath: string;
  readonly daemonVersion: string;
  readonly sandboxTier: string;
  readonly idleMs: number;
  readonly handshakeMs: number;
  readonly simTask: boolean;
  readonly simStepMs: number;
  readonly diffNote: string;
  readonly largeDiffBytes: number;
}

export interface ShutdownReceipt {
  readonly reason: string;
  readonly wal: { readonly global: WalCheckpoint; readonly state: WalCheckpoint };
  readonly readersClosed: number;
  readonly parked: boolean;
  readonly closed: readonly string[];
}

interface StoredEvent {
  readonly seq: number;
  readonly id: string;
  readonly type: string;
  readonly payload: M1View;
}

interface StreamState {
  readonly id: number;
  readonly data: Uint8Array;
  offset: number;
  credits: number;
  readonly sha256: string;
  ended: boolean;
}

interface Conn {
  readonly socket: net.Socket;
  readonly codec: FrameCodec;
  authed: boolean;
  handshake: ReturnType<typeof setTimeout> | null;
  readonly control: Buffer[];
  readonly binary: Buffer[];
  pumping: boolean;
  subscribed: boolean;
  capturing: boolean;
  readonly buffered: StoredEvent[];
  readonly streams: Map<number, StreamState>;
  dead: boolean;
}

const MUTATING = new Set(["build.stop", "build.start", "daemon.parkAndExit", "daemon.shutdown"]);
const DEFERRED = Symbol("deferred");

export class HarnessDaemon {
  private readonly task: SimulatedTask;
  private server: net.Server | null = null;
  private bundle: OpenDatabases | null = null;
  private token = "";
  private epoch = 1;
  private rev = 1;
  private nextStream = 1;
  private readonly clients = new Set<Conn>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private shutdownPromise: Promise<ShutdownReceipt> | null = null;

  constructor(private readonly opts: HarnessdOptions) {
    this.task = new SimulatedTask(opts.sandboxTier, opts.diffNote, opts.largeDiffBytes);
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.opts.profileDir, { recursive: true });
    this.acquireLock();
    const opened = openHarnessDatabases(
      globalDatabasePath(this.opts.profileDir),
      stateDatabasePath(this.opts.profileDir),
      this.opts.daemonVersion,
    );
    this.bundle = opened;
    opened.globalDb
      .prepare(
        "INSERT INTO meta(key, value) VALUES ('owner_pid', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(process.pid));
    this.epoch = this.readEpoch();
    this.restoreTask();
    this.token = generateSessionToken();
    writeSessionToken(sessionTokenPath(this.opts.profileDir), this.token);
    this.server = net.createServer((socket) => this.onSocket(socket));
    await this.listenWithRetry();
    if (this.opts.simTask && (!this.task.wasRestored() || this.task.isActive())) {
      this.task.begin(this.opts.simStepMs, () => this.publish("task.state"));
    }
    this.writeReady();
    this.log("info", "harnessd listening");
    this.touchIdle();
  }

  async shutdown(reason: string): Promise<ShutdownReceipt> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.finishShutdown(reason);
    return this.shutdownPromise;
  }

  private async finishShutdown(reason: string): Promise<ShutdownReceipt> {
    this.stopped = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.task.clear();
    let parked = false;
    if (this.task.isActive()) {
      parked = this.task.parkIfActive();
      this.insertEvent("task.parked");
    }
    for (const conn of [...this.clients]) this.drop(conn);
    const bundle = this.bundle;
    if (bundle) await bundle.queue.drainAndClose();
    const readersClosed = bundle ? bundle.readers.closeAll() : 0;
    const wal = {
      global: bundle ? checkpointTruncate(bundle.globalWriter) : { busy: -1, log: -1, checkpointed: -1 },
      state: bundle ? checkpointTruncate(bundle.stateWriter) : { busy: -1, log: -1, checkpointed: -1 },
    };
    const closed: string[] = [];
    if (bundle) {
      bundle.broker.close();
      closed.push("global.db");
      bundle.project.close();
      closed.push("state.db");
      bundle.telemetry.close();
      this.bundle = null;
    }
    const receipt: ShutdownReceipt = { reason, wal, readersClosed, parked, closed };
    fs.mkdirSync(this.opts.profileDir, { recursive: true });
    fs.writeFileSync(shutdownReceiptPath(this.opts.profileDir), JSON.stringify(receipt, null, 2));
    fs.rmSync(readyFilePath(this.opts.profileDir), { force: true });
    fs.rmSync(lockFilePath(this.opts.profileDir), { force: true });
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    this.log("info", "harnessd stopped", { reason });
    return receipt;
  }

  private acquireLock(): void {
    const file = lockFilePath(this.opts.profileDir);
    if (daemonLockHeld(file)) throw new PipeInUseError(this.opts.pipePath);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    writeDaemonLock(file);
  }

  private async listenWithRetry(): Promise<void> {
    const server = this.server;
    if (!server) throw new Error("server was not created");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (process.platform !== "win32") {
        try {
          await clearStalePipe(this.opts.pipePath);
        } catch (error) {
          if (!(error instanceof PipeInUseError) || attempt === 59) throw error;
          await delay(250);
          continue;
        }
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(this.opts.pipePath);
        });
        return;
      } catch (error) {
        if (errorCode(error) !== "EADDRINUSE" || attempt === 59) {
          if (errorCode(error) === "EADDRINUSE") throw new PipeInUseError(this.opts.pipePath);
          throw error;
        }
        await delay(250);
      }
    }
  }

  private onSocket(socket: net.Socket): void {
    socket.setNoDelay(true);
    const conn: Conn = {
      socket,
      codec: new FrameCodec(),
      authed: false,
      handshake: null,
      control: [],
      binary: [],
      pumping: false,
      subscribed: false,
      capturing: false,
      buffered: [],
      streams: new Map(),
      dead: false,
    };
    this.clients.add(conn);
    conn.handshake = setTimeout(() => {
      if (!conn.authed) this.drop(conn);
    }, this.opts.handshakeMs);
    socket.on("data", (chunk: Buffer) => {
      if (conn.dead) return;
      try {
        const frames = conn.codec.push(chunk);
        for (const frame of frames) {
          if (frame.channel !== JSON_RPC_CHANNEL) {
            this.fail(conn, null, RPC_INVALID_REQUEST, "binary frames are server-to-client");
            return;
          }
          this.onJson(conn, frame.payload);
        }
      } catch (error) {
        this.log("warn", "frame rejected", { message: error instanceof Error ? error.message : "frame error" });
        this.drop(conn);
      }
    });
    socket.on("close", () => {
      conn.dead = true;
      this.clients.delete(conn);
      this.touchIdle();
    });
    socket.on("error", () => {
      this.drop(conn);
    });
  }

  private onJson(conn: Conn, payload: Uint8Array): void {
    let message: unknown;
    try {
      message = JSON.parse(Buffer.from(payload).toString("utf8"));
    } catch {
      this.fail(conn, null, RPC_INVALID_REQUEST, "invalid json");
      return;
    }
    if (!message || typeof message !== "object") {
      this.fail(conn, null, RPC_INVALID_REQUEST, "invalid request");
      return;
    }
    const record = message as Record<string, unknown>;
    const method = typeof record.method === "string" ? record.method : "";
    const id = record.id ?? null;
    if (!conn.authed) {
      if (method !== "session.hello") {
        this.fail(conn, id, RPC_AUTH_FAILED, "unauthorized");
        return;
      }
      this.hello(conn, id, record.params);
      return;
    }
    if (method.length === 0) {
      this.fail(conn, id, RPC_INVALID_REQUEST, "method required");
      return;
    }
    try {
      const result = this.dispatch(conn, method, record.params, id);
      if (isPromise(result)) {
        void result.then(
          (value) => {
            if (value === DEFERRED) return;
            this.reply(conn, id, value);
          },
          (error: unknown) => {
            this.replyFailure(conn, id, error);
          },
        );
        return;
      }
      if (result === DEFERRED) return;
      this.reply(conn, id, result);
    } catch (error) {
      this.replyFailure(conn, id, error);
    }
  }

  private hello(conn: Conn, id: unknown, params: unknown): void {
    const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    const token = typeof record.token === "string" ? record.token : "";
    const protocol = typeof record.protocol === "string" ? record.protocol : "";
    if (!timingSafeTokenEqual(token, this.token)) {
      this.fail(conn, id, RPC_AUTH_FAILED, "unauthorized");
      return;
    }
    if (!isProtocol(protocol)) {
      this.fail(conn, id, RPC_PROTOCOL_MISMATCH, "protocol mismatch");
      return;
    }
    conn.authed = true;
    if (conn.handshake) clearTimeout(conn.handshake);
    conn.handshake = null;
    this.reply(conn, id, {
      daemonVersion: this.opts.daemonVersion,
      protocol: CURRENT_PROTOCOL,
      pid: process.pid,
      capabilities: ["m1", "events", "diff", "build.stop"],
    });
    this.touchIdle();
  }

  private dispatch(conn: Conn, method: string, params: unknown, id: unknown): unknown {
    const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    if (MUTATING.has(method)) {
      const op = typeof record.op_id === "string" ? record.op_id : "";
      if (op.length === 0) throw new RpcError(RPC_INVALID_REQUEST, "op_id required");
      const hash = requestHash(method, record);
      const stored = this.readOp(op);
      if (stored) {
        if (stored.hash !== hash) throw new RpcError(RPC_OP_CONFLICT, "op_id conflict");
        return stored.result;
      }
      const result = this.mutate(method);
      this.writeOp(op, method, hash, result);
      if (method === "daemon.parkAndExit" || method === "daemon.shutdown") {
        this.reply(conn, id, result);
        const reason = method === "daemon.parkAndExit" ? "version-mismatch" : "rpc";
        setImmediate(() => {
          void this.shutdown(reason);
        });
        return DEFERRED;
      }
      return result;
    }
    if (method === "session.ping") return { ok: true };
    if (method === "daemon.status") return this.statusBody();
    if (method === "snapshot.get") return this.snapshot();
    if (method === "cockpit.explain") return this.explain(record);
    if (method === "telemetry.metric") return this.recordMetric(record);
    if (method === "events.subscribe") return this.subscribe(conn, record);
    if (method === "diff.get") return this.diffGet(conn, record);
    if (method === "stream.credit") return this.credit(conn, record);
    if (method === "fetchDiffRange") return fetchDiffRange(this.inspectorContext(), record);
    if (method === "fetchLogChunk") return fetchLogChunk(this.inspectorContext(), record);
    if (method === "fetchScreenshot") return fetchScreenshot(this.inspectorContext(), record);
    if (method === "locateLineWindow") return locateLineWindow(this.inspectorContext(), record);
    if (method === "sliceForTask") return sliceForTask(this.inspectorContext(), record);
    if (method === "readResult") return readResult(this.inspectorContext(), record);
    if (method === "reconcile") return reconcileQuestion(this.inspectorContext(), record);
    if (method === "storeSecret") return storeSecret(this.inspectorContext(), record);
    if (method === "runProbe") return runProbe(this.inspectorContext(), record);
    throw new RpcError(RPC_METHOD_NOT_FOUND, `method not found: ${method}`);
  }

  private mutate(method: string): unknown {
    if (method === "build.stop") {
      const stopped = this.task.stop();
      if (stopped) this.publish("task.state");
      return { stopped, state: this.task.view(this.windowCount()).state };
    }
    if (method === "build.start") {
      if (this.task.current() !== "ACCEPTED" && !this.task.isActive()) {
        this.task.begin(this.opts.simStepMs, () => this.publish("task.state"));
      }
      return { started: true, state: this.task.view(this.windowCount()).state };
    }
    if (method === "daemon.parkAndExit" || method === "daemon.shutdown") {
      return { accepted: true, pid: process.pid };
    }
    throw new RpcError(RPC_METHOD_NOT_FOUND, `method not found: ${method}`);
  }

  private statusBody(): unknown {
    const view = this.task.view(this.windowCount());
    return {
      daemonVersion: this.opts.daemonVersion,
      pid: process.pid,
      pipe: this.opts.pipePath,
      sandbox: view.sandbox,
      windows: this.windowCount(),
      activeTasks: this.task.isActive() ? 1 : 0,
      state: view.live ? view.state : "IDLE",
    };
  }

  private snapshot(): unknown {
    const view = this.task.view(this.windowCount());
    if (Buffer.byteLength(JSON.stringify(view), "utf8") > SNAPSHOT_SECTION_MAX_BYTES) {
      throw new RpcError(RPC_INVALID_REQUEST, "snapshot section exceeds 2 MB");
    }
    return {
      as_of_seq: this.latestSeq(),
      stream_epoch: this.epoch,
      sections: { m1: view, board: readBoardProjection(this.requireState()) },
      nextCursor: null,
    };
  }

  private explain(params: Record<string, unknown>): unknown {
    const contractId = params.contractId;
    if (contractId !== undefined && contractId !== "cockpit-explainer@1") {
      throw new RpcError(RPC_INVALID_REQUEST, "cockpit.explain requires cockpit-explainer@1");
    }
    const result = explainCockpit(params.modelOutput);
    const bundle = this.bundle;
    if (bundle) {
      recordHealthMetric(bundle.telemetry, {
        attempt: null,
        ts: Date.now(),
        data: { event: "cockpit_explain", contractId: "cockpit-explainer@1", ok: result.ok },
      });
    }
    return result;
  }

  private recordMetric(params: Record<string, unknown>): unknown {
    if (params.kind !== "metric") throw new RpcError(RPC_INVALID_REQUEST, "telemetry kind must be metric");
    if (typeof params.ts !== "number" || !Number.isSafeInteger(params.ts)) {
      throw new RpcError(RPC_INVALID_REQUEST, "telemetry ts must be an integer");
    }
    const attempt = params.attempt === null || typeof params.attempt === "string" ? params.attempt : null;
    let data = params.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data) as unknown;
      } catch {
        throw new RpcError(RPC_INVALID_REQUEST, "telemetry data is not JSON");
      }
    }
    const bundle = this.requireBundle();
    return recordHealthMetric(bundle.telemetry, { attempt, ts: params.ts, data });
  }

  private subscribe(conn: Conn, params: Record<string, unknown>): unknown {
    const project = typeof params.project === "string" ? params.project : M1_PROJECT_ID;
    if (project !== M1_PROJECT_ID) throw new RpcError(RPC_INVALID_REQUEST, "unknown project");
    const since = typeof params.since_seq === "number" ? params.since_seq : 0;
    const requestedEpoch = typeof params.stream_epoch === "number" ? params.stream_epoch : this.epoch;
    const latest = this.latestSeq();
    if (requestedEpoch !== this.epoch || since > latest) {
      return { status: "resync_required", current_stream_epoch: this.epoch, latest_seq: latest };
    }
    conn.subscribed = true;
    conn.capturing = true;
    const rows = this.eventsAfter(since);
    const lastRow = rows.at(-1);
    const replayMax = lastRow ? lastRow.seq : since;
    if (rows.length > 0) this.sendBatch(conn, rows);
    const live = conn.buffered.filter((event) => event.seq > replayMax);
    conn.buffered.length = 0;
    conn.capturing = false;
    if (live.length > 0) this.sendBatch(conn, live);
    const lastLive = live.at(-1);
    return {
      status: "live",
      from_seq: since,
      to_seq: lastLive ? lastLive.seq : replayMax,
      stream_epoch: this.epoch,
    };
  }

  private diffGet(conn: Conn, params: Record<string, unknown>): unknown {
    const diff = this.task.diff();
    const view = this.task.view(this.windowCount());
    const requested = typeof params.file === "string" ? params.file : diff.file;
    if (requested !== diff.file) throw new RpcError(RPC_INVALID_REQUEST, "diff file not found");
    const summary = {
      task: view.taskId,
      file: diff.file,
      ref: view.ref,
      commit: view.commit,
      files: [
        { path: diff.file, insertions: diff.insertions, deletions: diff.deletions, hunks: diff.hunks.length },
      ],
    };
    const hunks = Array.isArray(params.hunks)
      ? params.hunks.filter((item): item is number => typeof item === "number")
      : null;
    if (!hunks) return summary;
    const selected = diff.hunks.filter((hunk) => hunks.includes(hunk.index));
    const body = Buffer.from(JSON.stringify({ hunks: selected }), "utf8");
    if (body.byteLength <= BINARY_CHUNK_BYTES) {
      return { hunks: selected, totalBytes: body.byteLength };
    }
    const streamId = this.nextStream;
    this.nextStream += 1;
    const digest = sha256(body);
    conn.streams.set(streamId, {
      id: streamId,
      data: body,
      offset: 0,
      credits: INITIAL_STREAM_CREDITS,
      sha256: digest,
      ended: false,
    });
    this.pumpStream(conn, streamId);
    return {
      streamId,
      totalBytes: body.byteLength,
      sha256: digest,
      chunkBytes: BINARY_CHUNK_BYTES,
      initialCredits: INITIAL_STREAM_CREDITS,
    };
  }

  private credit(conn: Conn, params: Record<string, unknown>): unknown {
    const streamId = numericParam(params, "streamId", "stream_id");
    const chunks = numericParam(params, "chunks", "credits");
    if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CREDIT_GRANT) {
      throw new RpcError(RPC_INVALID_REQUEST, "invalid credit grant");
    }
    const stream = conn.streams.get(streamId);
    if (!stream || stream.ended) throw new RpcError(RPC_INVALID_REQUEST, "unknown stream");
    if (stream.credits + chunks > MAX_OUTSTANDING_CREDITS) {
      throw new RpcError(RPC_INVALID_REQUEST, "credit window exceeded");
    }
    stream.credits += chunks;
    this.pumpStream(conn, streamId);
    return { streamId, credits: stream.credits };
  }

  private pumpStream(conn: Conn, streamId: number): void {
    const stream = conn.streams.get(streamId);
    if (!stream) return;
    while (stream.credits > 0 && stream.offset < stream.data.byteLength) {
      const end = Math.min(stream.offset + BINARY_CHUNK_BYTES, stream.data.byteLength);
      const slice = stream.data.subarray(stream.offset, end);
      stream.offset = end;
      stream.credits -= 1;
      this.enqueue(conn, FrameCodec.encodeBinary(streamId, slice), false);
    }
    if (!stream.ended && stream.offset >= stream.data.byteLength) {
      stream.ended = true;
      this.notify(conn, "stream.end", { streamId, bytesSent: stream.data.byteLength, sha256: stream.sha256 });
    }
  }

  private publish(type: string): void {
    const event = this.insertEvent(type);
    if (this.stopped) return;
    for (const conn of this.clients) {
      if (!conn.authed || !conn.subscribed || conn.dead) continue;
      if (conn.capturing) conn.buffered.push(event);
      else this.sendBatch(conn, [event]);
    }
    this.touchIdle();
  }

  private insertEvent(type: string): StoredEvent {
    const bundle = this.requireBundle();
    const view = this.task.view(this.windowCount());
    const id = crypto.randomUUID();
    const rev = this.rev;
    const createdAt = Date.now();
    const receipt = bundle.queue.submitOperationSync<{ seq: number; id: string; type: string }>({
      opId: `outbox-${id}`,
      kind: "append_outbox",
      request: { id, type, rev },
      execute: () => {
        bundle.stateDb
          .prepare(
            "INSERT INTO meta(key, value) VALUES ('m1_view', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .run(JSON.stringify(view));
        const appended = bundle.outbox.appendEvent(
          { id, type, subject: view.taskId, rev, payload: view, createdAt },
          ["ui_projection"],
        );
        return { seq: Number(appended.seq), id: appended.id, type: appended.type };
      },
    });
    this.rev += 1;
    return { seq: receipt.result.seq, id: receipt.result.id, type: receipt.result.type, payload: view };
  }

  private eventsAfter(since: number): StoredEvent[] {
    const rows = this.requireState()
      .prepare("SELECT seq, id, type, payload FROM outbox WHERE seq > ? ORDER BY seq ASC")
      .all(since) as Array<{ seq: number; id: string; type: string; payload: string }>;
    return rows.map((row) => ({
      seq: Number(row.seq),
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload) as M1View,
    }));
  }

  private latestSeq(): number {
    const row = this.requireState().prepare("SELECT MAX(seq) AS maxSeq FROM outbox").get() as
      | { maxSeq?: number | null }
      | undefined;
    return Number(row?.maxSeq ?? 0);
  }

  private sendBatch(conn: Conn, events: readonly StoredEvent[]): void {
    const first = events[0];
    const last = events.at(-1);
    if (!first || !last) return;
    this.notify(conn, "events.batch", { from_seq: first.seq, to_seq: last.seq, events });
  }

  private notify(conn: Conn, method: string, params: unknown): void {
    this.enqueue(conn, FrameCodec.encodeJson(Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params }))), true);
  }

  private reply(conn: Conn, id: unknown, result: unknown): void {
    this.enqueue(conn, FrameCodec.encodeJson(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }))), true);
  }

  private replyError(conn: Conn, id: unknown, code: number, message: string): void {
    this.enqueue(
      conn,
      FrameCodec.encodeJson(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }))),
      true,
    );
  }

  private fail(conn: Conn, id: unknown, code: number, message: string): void {
    this.replyError(conn, id, code, message);
    conn.socket.end();
    const killer = setTimeout(() => {
      if (!conn.dead) conn.socket.destroy();
    }, 100);
    killer.unref();
  }

  private enqueue(conn: Conn, frame: Buffer, control: boolean): void {
    if (conn.dead) return;
    if (control) conn.control.push(frame);
    else conn.binary.push(frame);
    this.pump(conn);
  }

  private pump(conn: Conn): void {
    if (conn.pumping || conn.dead) return;
    const next = conn.control.shift() ?? conn.binary.shift();
    if (!next) return;
    conn.pumping = true;
    const ok = conn.socket.write(next);
    if (ok) {
      conn.pumping = false;
      this.pump(conn);
    } else {
      conn.socket.once("drain", () => {
        conn.pumping = false;
        this.pump(conn);
      });
    }
  }

  private readOp(opId: string): { hash: string; result: unknown } | null {
    const row = this.requireState().prepare("SELECT request_hash, result FROM operations WHERE op_id = ?").get(opId) as
      | { request_hash?: string; result?: string }
      | undefined;
    if (!row?.request_hash || !row.result) return null;
    return { hash: row.request_hash, result: JSON.parse(row.result) as unknown };
  }

  private writeOp(opId: string, method: string, hash: string, result: unknown): void {
    this.requireState()
      .prepare(
        "INSERT INTO operations(op_id, kind, request_hash, result, committed_rev, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(opId, method, hash, JSON.stringify(result), this.rev, Date.now());
  }

  private restoreTask(): void {
    const row = this.requireState().prepare("SELECT value FROM meta WHERE key = 'm1_view'").get() as
      | { value?: string }
      | undefined;
    if (!row?.value) return;
    const parsed: unknown = JSON.parse(row.value);
    if (isM1View(parsed)) this.task.restore(parsed);
  }

  private readEpoch(): number {
    const db = this.requireState();
    const row = db.prepare("SELECT value FROM meta WHERE key = 'stream_epoch'").get() as { value?: string } | undefined;
    if (!row?.value) {
      db.prepare("INSERT INTO meta(key, value) VALUES ('stream_epoch', '1')").run();
      return 1;
    }
    return Number(row.value);
  }

  private windowCount(): number {
    let count = 0;
    for (const conn of this.clients) {
      if (conn.authed && !conn.dead) count += 1;
    }
    return count;
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.stopped || this.opts.idleMs <= 0) return;
    if (this.windowCount() === 0 && !this.task.isActive()) {
      this.idleTimer = setTimeout(() => {
        void this.shutdown("idle");
      }, this.opts.idleMs);
    }
  }

  private writeReady(): void {
    const body = {
      pid: process.pid,
      pipe: this.opts.pipePath,
      daemonVersion: this.opts.daemonVersion,
      profile: this.opts.profileDir,
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE === "1",
      readers: this.bundle?.readers.size ?? 0,
    };
    fs.writeFileSync(readyFilePath(this.opts.profileDir), JSON.stringify(body));
  }

  private requireState(): SqlDb {
    return this.requireBundle().stateDb;
  }

  private inspectorContext(): InspectorInboxContext {
    const bundle = this.requireBundle();
    const diff = this.task.diff();
    return {
      state: bundle.stateDb,
      project: bundle.project,
      broker: bundle.broker,
      profileDir: this.opts.profileDir,
      diffFile: diff.file,
      diffHunks: diff.hunks,
    };
  }

  private replyFailure(conn: Conn, id: unknown, error: unknown): void {
    if (error instanceof RpcError) {
      this.replyError(conn, id, error.code, error.message);
      return;
    }
    if (error instanceof InspectorInboxError) {
      this.replyError(conn, id, RPC_INVALID_REQUEST, error.message);
      return;
    }
    const message = error instanceof Error ? error.message : "internal error";
    this.replyError(conn, id, RPC_INTERNAL_ERROR, message);
  }

  private requireBundle(): OpenDatabases {
    if (!this.bundle) throw new RpcError(RPC_INTERNAL_ERROR, "state database is closed");
    return this.bundle;
  }

  private drop(conn: Conn): void {
    if (conn.dead) return;
    conn.dead = true;
    if (conn.handshake) clearTimeout(conn.handshake);
    this.clients.delete(conn);
    conn.socket.destroy();
    this.touchIdle();
  }

  private log(level: string, msg: string, fields: Record<string, unknown> = {}): void {
    const file = logFilePath(this.opts.profileDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const token = this.token;
    const raw = JSON.stringify({ ts: Date.now(), level, msg, ...fields });
    const line = token.length > 0 ? raw.replaceAll(token, "[redacted]") : raw;
    fs.appendFileSync(file, `${line}\n`);
  }
}

class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

function isProtocol(value: string): boolean {
  return SUPPORTED_PROTOCOLS.some((item) => item === value);
}

function requestHash(method: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params)
    .filter((key) => key !== "op_id")
    .sort();
  const body = keys.map((key) => `${key}:${JSON.stringify(params[key])}`).join("|");
  return crypto.createHash("sha256").update(`${method}\0${body}`).digest("hex");
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) return String(error.code);
  return "";
}

async function clearStalePipe(pipePath: string): Promise<void> {
  try {
    await fs.promises.stat(pipePath);
  } catch {
    return;
  }
  if (await pipeAcceptsConnections(pipePath)) throw new PipeInUseError(pipePath);
  await fs.promises.unlink(pipePath);
}

function pipeAcceptsConnections(pipePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(pipePath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 200);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as Promise<unknown>).then === "function";
}

function numericParam(params: Record<string, unknown>, primary: string, alias: string): number {
  const value = params[primary] ?? params[alias];
  return typeof value === "number" ? value : -1;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createHarnessDaemon(options: HarnessdOptions): HarnessDaemon {
  return new HarnessDaemon(options);
}
