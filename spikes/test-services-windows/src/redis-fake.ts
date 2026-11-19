import { createServer, type Server, type Socket } from "node:net";
import { LOOPBACK_HOST, REDIS_DATABASE_COUNT } from "./constants.ts";
import { assertLoopbackHost, assertPortInRange } from "./ports.ts";
import { encodeError, encodeSimple, encodeValue, RespParser, type RespValue } from "./resp.ts";

interface Database {
  strings: Map<string, { value: string; expiresAt?: number }>;
  hashes: Map<string, Map<string, string>>;
  zsets: Map<string, Map<string, number>>;
  lists: Map<string, string[]>;
}

interface Subscription {
  socket: Socket;
  channels: Set<string>;
}

export class InProcessRedis {
  readonly host = LOOPBACK_HOST;
  private readonly server: Server;
  private readonly databases: Database[];
  private readonly sockets = new Set<Socket>();
  private readonly subscriptions: Subscription[] = [];

  private constructor(server: Server, port: number) {
    this.server = server;
    this.port = port;
    this.databases = Array.from({ length: REDIS_DATABASE_COUNT }, () => emptyDatabase());
  }

  readonly port: number;

  static async start(port: number): Promise<InProcessRedis> {
    assertPortInRange(port);
    assertLoopbackHost(LOOPBACK_HOST);
    const server = createServer();
    const redis = new InProcessRedis(server, port);
    server.on("connection", (socket) => {
      redis.sockets.add(socket);
      socket.on("close", () => redis.sockets.delete(socket));
      redis.onConnection(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, LOOPBACK_HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return redis;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private onConnection(socket: Socket): void {
    let db = 0;
    const parser = new RespParser();
    socket.on("data", (chunk: Buffer) => {
      parser.push(chunk);
      while (true) {
        const value = parser.shift();
        if (value === undefined) return;
        if (value instanceof Error || !Array.isArray(value) || !value.every((item) => typeof item === "string")) {
          socket.write(encodeError("ERR protocol"));
          continue;
        }
        try {
          const result = this.execute(socket, value, db);
          if (result.kind === "select") db = result.db;
          if (result.reply) socket.write(result.reply);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          socket.write(encodeError(`ERR ${message}`));
        }
      }
    });
    socket.on("close", () => {
      const index = this.subscriptions.findIndex((entry) => entry.socket === socket);
      if (index >= 0) this.subscriptions.splice(index, 1);
    });
  }

  private execute(
    socket: Socket,
    args: string[],
    db: number,
  ): { reply: Buffer | null; kind?: "select"; db: number } {
    const command = (args[0] ?? "").toUpperCase();
    const database = this.database(db);
    if (command === "PING") return { reply: encodeSimple("PONG"), db };
    if (command === "SELECT") {
      const index = Number(args[1]);
      if (!Number.isInteger(index) || index < 0 || index >= REDIS_DATABASE_COUNT) {
        return { reply: encodeError("ERR DB index is out of range"), db };
      }
      return { reply: encodeSimple("OK"), kind: "select", db: index };
    }
    if (command === "SET") {
      database.strings.set(args[1] ?? "", { value: args[2] ?? "" });
      return { reply: encodeSimple("OK"), db };
    }
    if (command === "GET") {
      return { reply: encodeValue(this.readString(database, args[1] ?? "")), db };
    }
    if (command === "DEL") {
      const removed = database.strings.delete(args[1] ?? "") ? 1 : 0;
      return { reply: encodeValue(removed), db };
    }
    if (command === "INCR") {
      const current = Number(this.readString(database, args[1] ?? "") ?? "0");
      const next = (Number.isFinite(current) ? current : 0) + 1;
      database.strings.set(args[1] ?? "", { value: String(next) });
      return { reply: encodeValue(next), db };
    }
    if (command === "EXPIRE") {
      const record = database.strings.get(args[1] ?? "");
      if (!record) return { reply: encodeValue(0), db };
      const seconds = Number(args[2]);
      record.expiresAt = Date.now() + seconds * 1000;
      return { reply: encodeValue(1), db };
    }
    if (command === "TTL") {
      const record = database.strings.get(args[1] ?? "");
      if (!record) return { reply: encodeValue(-2), db };
      if (!record.expiresAt) return { reply: encodeValue(-1), db };
      return { reply: encodeValue(Math.max(0, Math.ceil((record.expiresAt - Date.now()) / 1000))), db };
    }
    if (command === "HSET") {
      const hash = database.hashes.get(args[1] ?? "") ?? new Map<string, string>();
      hash.set(args[2] ?? "", args[3] ?? "");
      database.hashes.set(args[1] ?? "", hash);
      return { reply: encodeValue(1), db };
    }
    if (command === "HGET") {
      const hash = database.hashes.get(args[1] ?? "");
      return { reply: encodeValue(hash?.get(args[2] ?? "") ?? null), db };
    }
    if (command === "ZADD") {
      const zset = database.zsets.get(args[1] ?? "") ?? new Map<string, number>();
      zset.set(args[3] ?? "", Number(args[2]));
      database.zsets.set(args[1] ?? "", zset);
      return { reply: encodeValue(1), db };
    }
    if (command === "LPUSH") {
      const list = database.lists.get(args[1] ?? "") ?? [];
      list.unshift(args[2] ?? "");
      database.lists.set(args[1] ?? "", list);
      return { reply: encodeValue(list.length), db };
    }
    if (command === "RPOP") {
      const list = database.lists.get(args[1] ?? "") ?? [];
      const value = list.pop() ?? null;
      return { reply: encodeValue(value), db };
    }
    if (command === "PUBLISH") {
      const channel = args[1] ?? "";
      const payload = args[2] ?? "";
      let receivers = 0;
      for (const subscription of this.subscriptions) {
        if (!subscription.channels.has(channel)) continue;
        receivers += 1;
        subscription.socket.write(encodeValue(["message", channel, payload]));
      }
      return { reply: encodeValue(receivers), db };
    }
    if (command === "SUBSCRIBE") {
      const channel = args[1] ?? "";
      let subscription = this.subscriptions.find((entry) => entry.socket === socket);
      if (!subscription) {
        subscription = { socket, channels: new Set() };
        this.subscriptions.push(subscription);
      }
      subscription.channels.add(channel);
      return { reply: encodeValue(["subscribe", channel, subscription.channels.size]), db };
    }
    if (command === "EVAL") {
      return { reply: this.evalScript(database, args.slice(1)), db };
    }
    if (command === "FLUSHDB") {
      this.databases[db] = emptyDatabase();
      return { reply: encodeSimple("OK"), db };
    }
    return { reply: encodeError(`ERR unknown command '${command}'`), db };
  }

  private evalScript(database: Database, args: string[]): Buffer {
    const script = args[0] ?? "";
    const keyCount = Number(args[1] ?? "0");
    const keys = args.slice(2, 2 + keyCount);
    const argv = args.slice(2 + keyCount);
    if (script.trim() === "return 1") return encodeValue(1);
    const rateLimit = "local c = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return c";
    if (script.trim() === rateLimit) {
      const key = keys[0] ?? "";
      const current = Number(this.readString(database, key) ?? "0");
      const next = (Number.isFinite(current) ? current : 0) + 1;
      const seconds = Number(argv[0] ?? "0");
      database.strings.set(key, { value: String(next), expiresAt: Date.now() + seconds * 1000 });
      return encodeValue(next);
    }
    return encodeError("ERR fake redis only implements the spike Lua scripts");
  }

  private readString(database: Database, key: string): string | null {
    const record = database.strings.get(key);
    if (!record) return null;
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      database.strings.delete(key);
      return null;
    }
    return record.value;
  }

  private database(index: number): Database {
    const database = this.databases[index];
    if (!database) throw new Error("missing database");
    return database;
  }
}

function emptyDatabase(): Database {
  return { strings: new Map(), hashes: new Map(), zsets: new Map(), lists: new Map() };
}

export function formatResp(value: RespValue): string {
  return JSON.stringify(value);
}
