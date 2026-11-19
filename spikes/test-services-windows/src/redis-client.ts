import { connect, type Socket } from "node:net";
import { LOOPBACK_HOST } from "./constants.ts";
import { SpikeError } from "./errors.ts";
import { encodeCommand, RedisReplyError, RespParser, type RespValue } from "./resp.ts";

export class RedisClient {
  private readonly socket: Socket;
  private readonly parser = new RespParser();
  private readonly waiters: Array<(value: RespValue | RedisReplyError) => void> = [];
  private readonly messages: Array<{ channel: string; payload: string }> = [];
  private messageWaiters: Array<(message: { channel: string; payload: string }) => void> = [];

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.parser.push(chunk);
      this.drain();
    });
    socket.on("error", (error) => {
      const failure = new RedisReplyError(error.message);
      const waiter = this.waiters.shift();
      if (waiter) waiter(failure);
    });
  }

  static async connect(port: number, host = LOOPBACK_HOST): Promise<RedisClient> {
    if (host !== LOOPBACK_HOST) {
      throw new SpikeError("non_loopback_bind", `Redis client refuses ${host}.`);
    }
    const socket = connect({ host, port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    return new RedisClient(socket);
  }

  async command(...args: string[]): Promise<RespValue> {
    const value = await this.roundTrip(encodeCommand(args));
    if (value instanceof RedisReplyError) throw value;
    return value;
  }

  async subscribe(channel: string): Promise<void> {
    const value = await this.roundTrip(encodeCommand(["SUBSCRIBE", channel]));
    if (value instanceof RedisReplyError) throw value;
  }

  async nextMessage(timeoutMs: number): Promise<{ channel: string; payload: string }> {
    const queued = this.messages.shift();
    if (queued) return queued;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageWaiters = this.messageWaiters.filter((waiter) => waiter !== onMessage);
        reject(new SpikeError("redis_timeout", "Timed out waiting for a pub/sub message."));
      }, timeoutMs);
      const onMessage = (message: { channel: string; payload: string }) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.messageWaiters.push(onMessage);
    });
  }

  close(): void {
    this.socket.end();
  }

  private roundTrip(payload: Buffer): Promise<RespValue | RedisReplyError> {
    const ready = new Promise<RespValue | RedisReplyError>((resolve) => {
      this.waiters.push(resolve);
    });
    this.socket.write(payload);
    return ready;
  }

  private drain(): void {
    while (true) {
      const value = this.parser.shift();
      if (value === undefined) return;
      if (isPubSubPush(value)) {
        const message = { channel: String(value[1]), payload: String(value[2]) };
        const waiter = this.messageWaiters.shift();
        if (waiter) waiter(message);
        else this.messages.push(message);
        continue;
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter(value);
    }
  }
}

function isPubSubPush(value: RespValue | RedisReplyError): value is RespValue[] {
  return Array.isArray(value) && value[0] === "message" && value.length >= 3;
}

export interface CommandProbe {
  command: string;
  ok: boolean;
  detail: string;
}

export async function probeRedisBasics(port: number): Promise<{
  commands: CommandProbe[];
  selectIsolated: boolean;
  selectDetail: string;
  publishDetail: string;
}> {
  const commands: CommandProbe[] = [];
  const client = await RedisClient.connect(port);
  const samples: string[][] = [
    ["PING"],
    ["SET", "spike:key", "alpha"],
    ["GET", "spike:key"],
    ["HSET", "spike:hash", "field", "value"],
    ["HGET", "spike:hash", "field"],
    ["ZADD", "spike:z", "1", "member"],
    ["EXPIRE", "spike:key", "30"],
    ["INCR", "spike:rate"],
    ["EVAL", "return 1", "0"],
    ["EVAL", "local c = redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ARGV[1]); return c", "1", "spike:lua", "30"],
  ];
  try {
    for (const args of samples) {
      try {
        const value = await client.command(...args);
        commands.push({ command: args[0] ?? "", ok: true, detail: JSON.stringify(value) });
      } catch (error) {
        commands.push({
          command: args[0] ?? "",
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const other = await RedisClient.connect(port);
    let selectIsolated = false;
    let selectDetail = "";
    try {
      await client.command("SELECT", "0");
      await client.command("SET", "iso", "db0");
      await other.command("SELECT", "1");
      await other.command("SET", "iso", "db1");
      const left = await client.command("GET", "iso");
      const right = await other.command("GET", "iso");
      selectIsolated = left === "db0" && right === "db1";
      selectDetail = `db0=${JSON.stringify(left)} db1=${JSON.stringify(right)}`;
      commands.push({ command: "SELECT", ok: selectIsolated, detail: selectDetail });
    } catch (error) {
      selectDetail = error instanceof Error ? error.message : String(error);
      commands.push({ command: "SELECT", ok: false, detail: selectDetail });
    }
    let publishDetail = "";
    try {
      const subscriber = await RedisClient.connect(port);
      await subscriber.subscribe("spike:events");
      const waiting = subscriber.nextMessage(2000);
      const receivers = await other.command("PUBLISH", "spike:events", "hello");
      const message = await waiting;
      publishDetail = `receivers=${JSON.stringify(receivers)} payload=${message.payload}`;
      commands.push({
        command: "PUBLISH",
        ok: message.payload === "hello",
        detail: publishDetail,
      });
      commands.push({ command: "SUBSCRIBE", ok: message.channel === "spike:events", detail: message.channel });
      subscriber.close();
    } catch (error) {
      publishDetail = error instanceof Error ? error.message : String(error);
      commands.push({ command: "PUBLISH", ok: false, detail: publishDetail });
      commands.push({ command: "SUBSCRIBE", ok: false, detail: publishDetail });
    }
    other.close();
    return { commands, selectIsolated, selectDetail, publishDetail };
  } finally {
    client.close();
  }
}
