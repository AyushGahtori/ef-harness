import fs from "node:fs";
import net from "node:net";
import { FrameCodec } from "./frame-codec.js";

export interface DaemonProbe {
  readonly daemonVersion: string;
  readonly pid: number;
}

export async function probeDaemon(pipePath: string, tokenFile: string, timeoutMs = 800): Promise<DaemonProbe | null> {
  if (!fs.existsSync(tokenFile)) return null;
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  if (token.length === 0) return null;
  return rpc(pipePath, token, "session.hello", { token, protocol: "1.1", client: { name: "m1-probe", version: "0.0.0" } }, timeoutMs).then(
    (result) => {
      if (!result || typeof result !== "object") return null;
      const record = result as Record<string, unknown>;
      if (typeof record.daemonVersion !== "string") return null;
      return { daemonVersion: record.daemonVersion, pid: Number(record.pid ?? 0) };
    },
  );
}

export async function callDaemon(
  pipePath: string,
  tokenFile: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 1500,
): Promise<unknown> {
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  return rpc(pipePath, token, method, params, timeoutMs);
}

function rpc(
  pipePath: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve) => {
    const socket = net.connect(pipePath);
    const codec = new FrameCodec();
    let helloSent = method === "session.hello";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    const finish = (value: unknown) => {
      clearTimeout(timer);
      socket.end();
      resolve(value);
    };
    socket.on("error", () => finish(null));
    socket.on("connect", () => {
      if (method === "session.hello") {
        write(socket, { jsonrpc: "2.0", id: 1, method, params });
        return;
      }
      write(socket, {
        jsonrpc: "2.0",
        id: 1,
        method: "session.hello",
        params: { token, protocol: "1.1", client: { name: "m1-probe", version: "0.0.0" } },
      });
    });
    socket.on("data", (chunk: Buffer) => {
      let frames;
      try {
        frames = codec.push(chunk);
      } catch {
        finish(null);
        return;
      }
      for (const frame of frames) {
        if (frame.channel !== 0) continue;
        const message = parse(frame.payload);
        if (!message) continue;
        if (!helloSent) {
          if (message.result) {
            helloSent = true;
            write(socket, { jsonrpc: "2.0", id: 2, method, params });
          } else if (message.error) {
            finish(null);
          }
          continue;
        }
        if (message.result !== undefined) finish(message.result);
        else if (message.error) finish(null);
      }
    });
  });
}

function write(socket: net.Socket, message: unknown): void {
  socket.write(FrameCodec.encodeJson(Buffer.from(JSON.stringify(message))));
}

function parse(payload: Uint8Array): { result?: unknown; error?: unknown } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(payload).toString("utf8"));
    if (!value || typeof value !== "object") return null;
    return value as { result?: unknown; error?: unknown };
  } catch {
    return null;
  }
}
