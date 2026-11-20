import net, { type Socket } from "node:net";
import { closeServer, ignoreSocketError, listenLoopback } from "./net-util.js";
import { isDangerousSharedRedisCommand } from "./redis-config.js";

export type RespFrame =
  | { readonly type: "simple"; readonly text: string }
  | { readonly type: "error"; readonly text: string }
  | { readonly type: "integer"; readonly value: number }
  | { readonly type: "bulk"; readonly text: string | null }
  | { readonly type: "array"; readonly items: readonly RespFrame[] };

export class RespStreamParser {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): RespFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: RespFrame[] = [];
    while (this.buffer.length > 0) {
      const parsed = this.tryParse(0);
      if (!parsed) break;
      frames.push(parsed.frame);
      this.buffer = this.buffer.subarray(parsed.next);
    }
    return frames;
  }

  private tryParse(offset: number): { frame: RespFrame; next: number } | null {
    if (offset >= this.buffer.length) return null;
    const prefixCode = this.buffer[offset];
    if (prefixCode === undefined) return null;
    const prefix = String.fromCharCode(prefixCode);
    const line = this.readLine(offset + 1);
    if (!line) return null;
    if (prefix === "+") return { frame: { type: "simple", text: line.text }, next: line.next };
    if (prefix === "-") return { frame: { type: "error", text: line.text }, next: line.next };
    if (prefix === ":") {
      return { frame: { type: "integer", value: Number(line.text) }, next: line.next };
    }
    if (prefix === "$") {
      const length = Number(line.text);
      if (!Number.isInteger(length)) return null;
      if (length < 0) return { frame: { type: "bulk", text: null }, next: line.next };
      const start = line.next;
      if (this.buffer.length < start + length + 2) return null;
      const text = this.buffer.subarray(start, start + length).toString("utf8");
      return { frame: { type: "bulk", text }, next: start + length + 2 };
    }
    if (prefix === "*") {
      const count = Number(line.text);
      if (!Number.isInteger(count) || count < 0) return null;
      const items: RespFrame[] = [];
      let cursor = line.next;
      for (let index = 0; index < count; index += 1) {
        const child = this.tryParse(cursor);
        if (!child) return null;
        items.push(child.frame);
        cursor = child.next;
      }
      return { frame: { type: "array", items }, next: cursor };
    }
    throw new Error(`unsupported RESP prefix ${prefix}`);
  }

  private readLine(offset: number): { text: string; next: number } | null {
    const end = this.buffer.indexOf("\r\n", offset);
    if (end < 0) return null;
    return { text: this.buffer.subarray(offset, end).toString("utf8"), next: end + 2 };
  }
}

export function encodeRespCommand(parts: readonly string[]): Buffer {
  const buffers: Buffer[] = [Buffer.from(`*${parts.length}\r\n`)];
  for (const part of parts) {
    const bytes = Buffer.from(part);
    buffers.push(Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from("\r\n"));
  }
  return Buffer.concat(buffers);
}

export function encodeSimple(text: string): Buffer {
  return Buffer.from(`+${text}\r\n`);
}

export function encodeError(text: string): Buffer {
  return Buffer.from(`-${text}\r\n`);
}

export function encodeInteger(value: number): Buffer {
  return Buffer.from(`:${value}\r\n`);
}

export function encodeBulk(text: string | null): Buffer {
  if (text === null) return Buffer.from("$-1\r\n");
  const bytes = Buffer.from(text);
  return Buffer.concat([Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from("\r\n")]);
}

export function commandFromFrame(frame: RespFrame): string[] | null {
  if (frame.type !== "array") return null;
  const parts: string[] = [];
  for (const item of frame.items) {
    if (item.type !== "bulk" || item.text === null) return null;
    parts.push(item.text);
  }
  return parts;
}

interface StringEntry {
  value: string;
  expiresAt?: number;
}

interface RedisDb {
  strings: Map<string, StringEntry>;
  hashes: Map<string, Map<string, string>>;
}

export interface RedisProtocolStats {
  readonly flushDbCount: number;
  readonly rejectedDangerous: number;
}

/**
 * Small Redis-protocol server used as the Tier 1 fake and as the unguarded
 * backend behind the shared-server command proxy.
 */
export class RedisProtocolServer {
  private readonly databases: RedisDb[] = Array.from({ length: 16 }, () => ({
    strings: new Map(),
    hashes: new Map(),
  }));
  private server: net.Server | null = null;
  private readonly sockets = new Set<Socket>();
  private flushDbCount = 0;
  private rejectedDangerous = 0;

  constructor(private readonly options: { readonly enforceDangerousCommandBan: boolean }) {}

  async start(port = 0): Promise<number> {
    const server = net.createServer((socket) => this.handle(socket));
    this.server = server;
    return listenLoopback(server, port);
  }

  stats(): RedisProtocolStats {
    return { flushDbCount: this.flushDbCount, rejectedDangerous: this.rejectedDangerous };
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (server) await closeServer(server);
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.on("close", () => this.sockets.delete(socket));
    ignoreSocketError(socket);
    const parser = new RespStreamParser();
    let selected = 0;
    socket.on("data", (chunk: Buffer) => {
      let frames: RespFrame[] = [];
      try {
        frames = parser.push(chunk);
      } catch {
        socket.write(encodeError("ERR protocol error"));
        return;
      }
      for (const frame of frames) {
        const command = commandFromFrame(frame);
        if (!command || command.length === 0) {
          socket.write(encodeError("ERR protocol error"));
          continue;
        }
        const name = (command[0] ?? "").toUpperCase();
        if (this.options.enforceDangerousCommandBan && isDangerousSharedRedisCommand(name)) {
          this.rejectedDangerous += 1;
          socket.write(encodeError(`ERR ${name} is disabled on the shared Redis server`));
          continue;
        }
        selected = this.execute(socket, selected, name, command);
      }
    });
  }

  private execute(socket: Socket, selected: number, name: string, command: readonly string[]): number {
    const arg = (index: number): string | undefined => command[index];
    if (name === "PING") {
      socket.write(encodeSimple("PONG"));
      return selected;
    }
    if (name === "SELECT") {
      const index = Number(arg(1));
      if (!Number.isInteger(index) || index < 0 || index > 15) {
        socket.write(encodeError("ERR DB index is out of range"));
        return selected;
      }
      socket.write(encodeSimple("OK"));
      return index;
    }
    if (name === "SET" && arg(1) !== undefined && arg(2) !== undefined) {
      this.db(selected).strings.set(arg(1) as string, { value: arg(2) as string });
      socket.write(encodeSimple("OK"));
      return selected;
    }
    if (name === "GET" && arg(1) !== undefined) {
      socket.write(encodeBulk(this.readString(selected, arg(1) as string)));
      return selected;
    }
    if (name === "DEL" && arg(1) !== undefined) {
      const key = arg(1) as string;
      const removed = this.db(selected).strings.delete(key) || this.db(selected).hashes.delete(key);
      socket.write(encodeInteger(removed ? 1 : 0));
      return selected;
    }
    if (name === "FLUSHDB") {
      this.db(selected).strings.clear();
      this.db(selected).hashes.clear();
      this.flushDbCount += 1;
      socket.write(encodeSimple("OK"));
      return selected;
    }
    if (name === "FLUSHALL") {
      for (const database of this.databases) {
        database.strings.clear();
        database.hashes.clear();
      }
      socket.write(encodeSimple("OK"));
      return selected;
    }
    if (name === "SHUTDOWN" || name === "CONFIG") {
      socket.write(encodeSimple("OK"));
      return selected;
    }
    if (name === "HSET" && arg(1) !== undefined && arg(2) !== undefined && arg(3) !== undefined) {
      const key = arg(1) as string;
      const hashes = this.db(selected).hashes;
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(arg(2) as string, arg(3) as string);
      hashes.set(key, hash);
      socket.write(encodeInteger(1));
      return selected;
    }
    if (name === "HGET" && arg(1) !== undefined && arg(2) !== undefined) {
      const value = this.db(selected).hashes.get(arg(1) as string)?.get(arg(2) as string) ?? null;
      socket.write(encodeBulk(value));
      return selected;
    }
    if (name === "EXPIRE" && arg(1) !== undefined && arg(2) !== undefined) {
      const key = arg(1) as string;
      const entry = this.db(selected).strings.get(key);
      const seconds = Number(arg(2));
      if (!entry || !Number.isFinite(seconds)) {
        socket.write(encodeInteger(0));
        return selected;
      }
      entry.expiresAt = Date.now() + seconds * 1000;
      socket.write(encodeInteger(1));
      return selected;
    }
    if (name === "DBSIZE") {
      socket.write(encodeInteger(this.db(selected).strings.size));
      return selected;
    }
    if (name === "INFO") {
      socket.write(
        encodeBulk(`flushdb_count:${this.flushDbCount}\r\nrejected_dangerous:${this.rejectedDangerous}\r\n`),
      );
      return selected;
    }
    socket.write(encodeError(`ERR unknown command '${name}'`));
    return selected;
  }

  private db(index: number): RedisDb {
    const database = this.databases[index];
    if (!database) throw new Error(`redis db ${index} is missing`);
    return database;
  }

  private readString(index: number, key: string): string | null {
    const entry = this.db(index).strings.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.db(index).strings.delete(key);
      return null;
    }
    return entry.value;
  }
}

export class RedisClient {
  private readonly parser = new RespStreamParser();
  private readonly pending: Array<(frame: RespFrame) => void> = [];

  private constructor(private readonly socket: Socket) {
    ignoreSocketError(socket);
    socket.on("data", (chunk: Buffer) => {
      for (const frame of this.parser.push(chunk)) {
        const waiter = this.pending.shift();
        waiter?.(frame);
      }
    });
  }

  static connect(port: number, host = "127.0.0.1"): Promise<RedisClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ port, host });
      const onError = (error: Error): void => {
        reject(error);
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        resolve(new RedisClient(socket));
      });
    });
  }

  command(parts: readonly string[]): Promise<RespFrame> {
    const reply = new Promise<RespFrame>((resolve) => {
      this.pending.push(resolve);
    });
    this.socket.write(encodeRespCommand(parts));
    return reply;
  }

  close(): void {
    this.socket.destroy();
  }
}

export async function flushRedisIndexes(port: number, indexes: readonly number[]): Promise<void> {
  const client = await RedisClient.connect(port);
  try {
    for (const index of indexes) {
      const selected = await client.command(["SELECT", String(index)]);
      if (selected.type === "error") {
        throw new Error(selected.text);
      }
      const flushed = await client.command(["FLUSHDB"]);
      if (flushed.type === "error") throw new Error(flushed.text);
    }
  } finally {
    client.close();
  }
}

export async function startRedisGuardProxy(
  backendPort: number,
  publicPort = 0,
): Promise<{ port: number; stop(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = net.createServer((client) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    ignoreSocketError(client);
    const backend = net.connect({ host: "127.0.0.1", port: backendPort });
    sockets.add(backend);
    backend.on("close", () => sockets.delete(backend));
    ignoreSocketError(backend);
    backend.on("error", () => client.destroy());
    client.on("error", () => backend.destroy());
    backend.pipe(client);
    const parser = new RespStreamParser();
    client.on("data", (chunk: Buffer) => {
      let frames: RespFrame[] = [];
      try {
        frames = parser.push(chunk);
      } catch {
        client.write(encodeError("ERR protocol error"));
        return;
      }
      for (const frame of frames) {
        const command = commandFromFrame(frame);
        const name = command?.[0];
        if (!command || !name) {
          client.write(encodeError("ERR protocol error"));
          continue;
        }
        if (isDangerousSharedRedisCommand(name)) {
          client.write(encodeError(`ERR ${name.toUpperCase()} is disabled on the shared Redis server`));
          continue;
        }
        backend.write(encodeRespCommand(command));
      }
    });
  });
  const port = await listenLoopback(server, publicPort);
  return {
    port,
    async stop() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await closeServer(server);
    },
  };
}
