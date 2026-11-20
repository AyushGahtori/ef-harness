import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { FrameCodec } from "./frame-codec.js";

interface PortLike {
  start(): void;
  postMessage(message: unknown, transfer?: readonly unknown[]): void;
  on(event: "message", listener: (event: { data?: unknown }) => void): void;
}

interface ParentLike {
  on(event: "message", listener: (event: { data?: unknown; ports?: PortLike[] }) => void): void;
  postMessage(message: unknown): void;
}

let renderer: PortLike | null = null;
let socket: net.Socket | null = null;
let authed = false;
let connecting = false;
let stopped = false;
const codec = new FrameCodec();

function parentPort(): ParentLike {
  const candidate = (process as unknown as { parentPort?: ParentLike }).parentPort;
  if (!candidate) throw new Error("pipe client must run inside an Electron utility process");
  return candidate;
}

function log(message: string): void {
  const profile = process.env.EF_HARNESS_PROFILE;
  if (!profile) return;
  const file = path.join(profile, "logs", "pipe-client.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${Date.now()} ${message}\n`);
}

function tokenFile(): string {
  const profile = process.env.EF_HARNESS_PROFILE;
  if (!profile) throw new Error("EF_HARNESS_PROFILE is required");
  return path.join(profile, "session.token");
}

function pipePath(): string {
  const pipe = process.env.EF_HARNESS_PIPE;
  if (!pipe) throw new Error("EF_HARNESS_PIPE is required");
  return pipe;
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

function bindRenderer(port: PortLike): void {
  renderer = port;
  port.start();
  port.on("message", (event) => {
    const payload = extractBytes(event);
    if (!payload) {
      log(`renderer message dropped ${peek(event.data)} / ${peek(event)}`);
      return;
    }
    if (!socket) {
      log("renderer message before the pipe socket was open");
      return;
    }
    const bytes = Buffer.from(payload);
    if (bytes.byteLength > 0) socket.write(bytes);
  });
  if (authed) {
    port.postMessage({ type: "status", status: "connected" });
    return;
  }
  connect();
}

function connect(): void {
  if (stopped || connecting) return;
  connecting = true;
  codec.takePending();
  const current = socket;
  socket = null;
  if (current) current.destroy();
  let file = "";
  try {
    file = tokenFile();
    if (!fs.existsSync(file)) {
      connecting = false;
      retry();
      return;
    }
  } catch {
    connecting = false;
    retry();
    return;
  }
  const token = fs.readFileSync(file, "utf8").trim();
  const next = net.connect(pipePath());
  socket = next;
  const localCodec = codec;
  next.on("error", () => {
    log("pipe error");
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
    if (!authed) {
      let frames;
      try {
        frames = localCodec.push(chunk);
      } catch (error) {
        log(error instanceof Error ? error.message : "frame error");
        next.destroy();
        return;
      }
      for (const frame of frames) {
        if (frame.channel !== 0) continue;
        const message = parseJson(frame.payload);
        if (message?.id === 1 && message.result) {
          authed = true;
          connecting = false;
          renderer?.postMessage({ type: "status", status: "connected" });
          const pending = localCodec.takePending();
          if (pending.byteLength > 0) forward(pending);
        }
      }
      if (authed) {
        for (const frame of frames) {
          if (frame.channel === 0 && parseJson(frame.payload)?.id === 1) continue;
          forward(frame.channel === 0 ? FrameCodec.encodeJson(frame.payload) : chunk);
        }
      }
      return;
    }
    forward(chunk);
  });
  next.on("close", () => {
    const wasAuthed = authed;
    authed = false;
    connecting = false;
    if (socket === next) socket = null;
    if (stopped) return;
    renderer?.postMessage({ type: "status", status: "reconnecting" });
    if (wasAuthed) parentPort().postMessage({ type: "daemon-down" });
    retry();
  });
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
    keys = Object.keys(value as object).slice(0, 8).join(",");
  } catch {
    keys = "unreadable";
  }
  const size = "byteLength" in value ? String((value as { byteLength?: number }).byteLength ?? "") : "";
  return size.length > 0 ? `${named}{${keys}}:${size}` : `${named}{${keys}}`;
}

function forward(bytes: Uint8Array): void {
  renderer?.postMessage({ type: "bytes", encoding: "base64", payload: Buffer.from(bytes).toString("base64") });
}

function retry(): void {
  if (stopped) return;
  setTimeout(() => connect(), 200);
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

const parent = parentPort();
parent.on("message", (event) => {
  const data = event.data;
  const port = event.ports?.[0];
  if (data && typeof data === "object" && (data as { type?: string }).type === "renderer-port" && port) {
    bindRenderer(port);
  }
  if (data && typeof data === "object" && (data as { type?: string }).type === "stop") {
    stopped = true;
    socket?.destroy();
  }
});
log("pipe client started");
