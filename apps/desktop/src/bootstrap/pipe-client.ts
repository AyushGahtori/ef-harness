import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { SharedHarnessdStream } from "../windows/shared-harnessd-stream.js";
import type { HarnessdEvent } from "../windows/types.js";
import { FrameCodec, type DecodedFrame } from "./frame-codec.js";

export interface PortLike {
  start(): void;
  postMessage(message: unknown, transfer?: readonly unknown[]): void;
  on(event: "message", listener: (event: { data?: unknown }) => void): void;
}

export interface ParentLike {
  on(event: "message", listener: (event: { data?: unknown; ports?: PortLike[] }) => void): void;
  postMessage(message: unknown): void;
}

export interface PipeClientOptions {
  readonly profileDir: string;
  readonly pipePath: string;
  readonly parent?: ParentLike;
}

/**
 * One utility-process pipe session fans out to every attached window.
 * Partial frames stay in the rolling codec; a coalesced `session.hello`
 * does not drop or duplicate the frames that follow it.
 */
export class PipeClientBridge {
  readonly stream = new SharedHarnessdStream();
  private readonly windows = new Map<string, PortLike>();
  private socket: net.Socket | null = null;
  private authed = false;
  private connecting = false;
  private stopped = false;
  private readonly codec = new FrameCodec();

  constructor(private readonly options: PipeClientOptions) {}

  attachParent(parent: ParentLike = this.requireParent()): void {
    parent.on("message", (event) => {
      this.onParentMessage(event);
    });
  }

  onParentMessage(event: { data?: unknown; ports?: PortLike[] }): void {
    const data = event.data;
    const port = event.ports?.[0];
    if (isRecord(data) && data.type === "renderer-port" && port) {
      const windowId = typeof data.windowId === "string" && data.windowId.length > 0 ? data.windowId : nextWindowId(this.windows.size);
      this.bindWindow(windowId, port);
    }
    if (isRecord(data) && data.type === "stop") this.stop();
  }

  bindWindow(windowId: string, port: PortLike): void {
    this.windows.set(windowId, port);
    port.start();
    port.on("message", (event) => {
      const payload = extractBytes(event);
      if (!payload) {
        log(this.options.profileDir, `renderer message dropped ${peek(event.data)} / ${peek(event)}`);
        return;
      }
      if (!this.socket) {
        log(this.options.profileDir, "renderer message before the pipe socket was open");
        return;
      }
      const bytes = Buffer.from(payload);
      if (bytes.byteLength > 0) this.socket.write(bytes);
    });
    if (this.authed) {
      port.postMessage({ type: "status", status: "connected" });
      return;
    }
    this.connect();
  }

  connect(): void {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    this.codec.takePending();
    const current = this.socket;
    this.socket = null;
    if (current) current.destroy();
    const file = path.join(this.options.profileDir, "session.token");
    if (!fs.existsSync(file)) {
      this.connecting = false;
      this.retry();
      return;
    }
    const token = fs.readFileSync(file, "utf8").trim();
    const next = net.connect(this.options.pipePath);
    this.socket = next;
    next.on("error", () => {
      log(this.options.profileDir, "pipe error");
    });
    next.on("connect", () => {
      const hello = {
        jsonrpc: "2.0",
        id: 1,
        method: "session.hello",
        params: { token, protocol: "1.1", client: { name: "m1-utility", version: "0.0.0" } },
      };
      next.write(FrameCodec.encodeJson(Buffer.from(JSON.stringify(hello))));
    });
    next.on("data", (chunk: Buffer) => {
      this.onData(next, chunk);
    });
    next.on("close", () => {
      const wasAuthed = this.authed;
      this.authed = false;
      this.connecting = false;
      if (this.socket === next) this.socket = null;
      if (this.stopped) return;
      this.postStatus("reconnecting");
      if (wasAuthed) this.options.parent?.postMessage({ type: "daemon-down" });
      this.retry();
    });
  }

  stop(): void {
    this.stopped = true;
    this.socket?.destroy();
  }

  private onData(next: net.Socket, chunk: Buffer): void {
    let frames: DecodedFrame[];
    try {
      frames = this.codec.push(chunk);
    } catch (error) {
      log(this.options.profileDir, error instanceof Error ? error.message : "frame error");
      next.destroy();
      return;
    }
    for (const frame of frames) {
      if (!this.authed) {
        if (frame.channel !== 0) continue;
        const message = parseJson(frame.payload);
        if (message?.id === 1 && message.result) {
          this.authed = true;
          this.connecting = false;
          this.postStatus("connected");
        }
        continue;
      }
      if (frame.channel === 0) this.ingestEvents(frame.payload);
      const bytes =
        frame.channel === 0
          ? FrameCodec.encodeJson(frame.payload)
          : FrameCodec.encodeBinary(frame.streamId ?? 0, frame.payload);
      this.forward(bytes);
    }
  }

  private ingestEvents(payload: Uint8Array): void {
    const message = parseJsonRecord(payload);
    if (!message || message.method !== "events.batch" || !isRecord(message.params)) return;
    const params = message.params;
    const batchEpoch = typeof params.stream_epoch === "string" ? params.stream_epoch : undefined;
    if (!Array.isArray(params.events)) return;
    for (const item of params.events) {
      const event = toHarnessdEvent(item, batchEpoch);
      if (!event) continue;
      this.stream.publish(event);
      this.options.parent?.postMessage({ type: "harnessd-event", event });
    }
  }

  private postStatus(status: "connected" | "reconnecting"): void {
    for (const port of this.windows.values()) {
      port.postMessage({ type: "status", status });
    }
  }

  private forward(bytes: Uint8Array): void {
    const payload = Buffer.from(bytes).toString("base64");
    for (const port of this.windows.values()) {
      port.postMessage({ type: "bytes", encoding: "base64", payload });
    }
  }

  private retry(): void {
    if (this.stopped) return;
    setTimeout(() => this.connect(), 200);
  }

  private requireParent(): ParentLike {
    if (this.options.parent) return this.options.parent;
    const candidate = (process as unknown as { parentPort?: ParentLike }).parentPort;
    if (!candidate) throw new Error("pipe client must run inside an Electron utility process");
    return candidate;
  }
}

function nextWindowId(size: number): string {
  return `window-${size + 1}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function log(profile: string, message: string): void {
  const file = path.join(profile, "logs", "pipe-client.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${Date.now()} ${message}\n`);
}

function messageBody(event: { data?: unknown }): { type: string; payload?: Uint8Array } | null {
  return asRendererMessage(event.data) ?? asRendererMessage(event);
}

function asRendererMessage(value: unknown): { type: string; payload?: Uint8Array } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") return null;
  const payload = toBytes(record.payload);
  if (!payload) return { type: record.type };
  return { type: record.type, payload };
}

function toBytes(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (typeof value === "string") return new Uint8Array(Buffer.from(value, "base64"));
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) return Uint8Array.from(value);
  return null;
}

function extractBytes(event: { data?: unknown }): Uint8Array | null {
  const data = event.data;
  if (typeof data === "string" && data.startsWith("bytes:")) {
    return new Uint8Array(Buffer.from(data.slice("bytes:".length), "base64"));
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (record.type === "bytes" && record.encoding === "base64" && typeof record.payload === "string") {
      return new Uint8Array(Buffer.from(record.payload, "base64"));
    }
  }
  const body = messageBody(event);
  if (body?.type === "bytes" && body.payload) return body.payload;
  return toBytes(data);
}

function peek(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value !== "object") return typeof value;
  const named = value.constructor?.name ?? "object";
  let keys = "";
  try {
    keys = Object.keys(value as object)
      .slice(0, 8)
      .join(",");
  } catch {
    keys = "unreadable";
  }
  const size = "byteLength" in value ? String((value as { byteLength?: number }).byteLength ?? "") : "";
  return size.length > 0 ? `${named}{${keys}}:${size}` : `${named}{${keys}}`;
}

function parseJsonRecord(payload: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(payload).toString("utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function toHarnessdEvent(value: unknown, batchEpoch: string | undefined): HarnessdEvent | null {
  if (!isRecord(value) || typeof value.seq !== "number" || !Number.isInteger(value.seq) || value.seq < 0) return null;
  const epoch =
    typeof value.streamEpoch === "string"
      ? value.streamEpoch
      : typeof value.stream_epoch === "string"
        ? value.stream_epoch
        : batchEpoch;
  const event: HarnessdEvent = {
    seq: value.seq,
    type: typeof value.type === "string" ? value.type : "event",
    projectId: typeof value.projectId === "string" ? value.projectId : "",
    payload: {},
  };
  if (epoch === undefined) return event;
  return { ...event, streamEpoch: epoch };
}

function parseJson(payload: Uint8Array): { id?: unknown; result?: unknown } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(payload).toString("utf8"));
    if (!value || typeof value !== "object") return null;
    return value as { id?: unknown; result?: unknown };
  } catch {
    return null;
  }
}

function utilityParent(): ParentLike | null {
  return (process as unknown as { parentPort?: ParentLike }).parentPort ?? null;
}

const utility = utilityParent();
if (utility) {
  const profile = process.env.EF_HARNESS_PROFILE;
  const pipe = process.env.EF_HARNESS_PIPE;
  if (!profile) throw new Error("EF_HARNESS_PROFILE is required");
  if (!pipe) throw new Error("EF_HARNESS_PIPE is required");
  const bridge = new PipeClientBridge({ profileDir: profile, pipePath: pipe, parent: utility });
  bridge.attachParent(utility);
  log(profile, "pipe client started");
}
