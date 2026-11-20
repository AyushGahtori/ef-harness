import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeJsonRpc } from "../../src/transport/json-rpc.js";
import {
  FrameCodec,
  FrameTooLargeError,
  LocalSecretRedactor,
  MessagePortBridge,
  NamedPipeClient,
  NamedPipeServer,
  OutboundBufferLimitError,
  PipeInUseError,
  RPC_AUTH_FAILED,
  RPC_PROTOCOL_MISMATCH,
  SessionTokenStore,
  createRedactingLogger,
  currentUserSid,
  listTcpUdpListeners,
  readNamedPipeSddl,
  securityTrustees,
  testPipePath,
  warmWindowsSecurity,
  type PipeSession,
} from "../../src/transport/index.js";

const cleanup: Array<() => Promise<void>> = [];

beforeAll(async () => {
  await warmWindowsSecurity();
}, 30_000);

afterEach(async () => {
  for (const job of cleanup.splice(0)) await job();
});

function remember(job: () => Promise<void>): void {
  cleanup.push(job);
}

async function boot(options?: { handshakeTimeoutMs?: number; maxOutboundBytes?: number }) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ef-pipe-"));
  const pipePath = testPipePath();
  const redactor = new LocalSecretRedactor();
  const lines: string[] = [];
  const logger = createRedactingLogger(redactor, (line) => lines.push(line));
  const tokenStore = new SessionTokenStore({ directory, redactor, logger });
  const server = new NamedPipeServer({
    pipePath,
    tokenStore,
    logger,
    daemonVersion: "0.0.0-test",
    ...(options?.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    ...(options?.maxOutboundBytes === undefined ? {} : { maxOutboundBytes: options.maxOutboundBytes }),
  });
  remember(async () => {
    await server.close();
    await fs.promises.rm(directory, { recursive: true, force: true });
  });
  await server.listen();
  return { directory, pipePath, lines, logger, tokenStore, server };
}

function helloFrame(id: number, token: string, protocol = "1.1"): Buffer {
  return encodeJsonRpc({
    jsonrpc: "2.0",
    id,
    method: "session.hello",
    params: { token, protocol, client: { name: "test-client", version: "1" } },
  });
}

function decodeError(buffer: Buffer): { code?: number; data?: { name?: string; protocol?: string } } {
  const frame = new FrameCodec().push(buffer)[0];
  const parsed = JSON.parse(Buffer.from(frame?.payload ?? new Uint8Array()).toString("utf8")) as {
    error?: { code?: number; data?: { name?: string; protocol?: string } };
  };
  return parsed.error ?? {};
}

async function collectUntilClose(socket: net.Socket, write: () => void): Promise<Buffer> {
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  const closed = once(socket, "close");
  write();
  await closed;
  return Buffer.concat(chunks);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("transport named pipe", () => {
  it("accepts session.hello and rejects bad tokens, early RPC, and incompatible versions", async () => {
    const { pipePath, tokenStore, server, lines } = await boot({ handshakeTimeoutMs: 1_000 });
    const token = tokenStore.token;
    expect(lines.join("\n").includes(token)).toBe(false);

    const goodSession = once(server, "session");
    const good = net.connect(pipePath);
    remember(async () => {
      good.destroy();
    });
    await goodSession;
    const goodPayload = new Promise<Buffer>((resolve) => {
      good.once("data", (chunk: Buffer) => resolve(chunk));
    });
    good.write(helloFrame(1, token, "1.0"));
    const hello = JSON.parse(Buffer.from(new FrameCodec().push(await goodPayload)[0]?.payload ?? []).toString("utf8")) as {
      result?: { protocol?: string; daemonVersion?: string; capabilities?: { currentProtocol?: string } };
    };
    expect(hello.result?.protocol).toBe("1.0");
    expect(hello.result?.daemonVersion).toBe("0.0.0-test");
    expect(hello.result?.capabilities?.currentProtocol).toBe("1.1");

    let requests = 0;
    server.on("request", () => {
      requests += 1;
    });

    const badSession = once(server, "session");
    const bad = net.connect(pipePath);
    await badSession;
    const started = performance.now();
    const badBuffer = await collectUntilClose(bad, () => {
      bad.write(helloFrame(2, "0".repeat(64)));
    });
    expect(performance.now() - started).toBeLessThan(100);
    expect(decodeError(badBuffer).code).toBe(RPC_AUTH_FAILED);

    const earlySession = once(server, "session");
    const early = net.connect(pipePath);
    await earlySession;
    const earlyBuffer = await collectUntilClose(early, () => {
      early.write(
        encodeJsonRpc({
          jsonrpc: "2.0",
          id: 3,
          method: "build.start",
          op_id: "op-1",
          params: { project_id: "project" },
        }),
      );
    });
    expect(requests).toBe(0);
    expect(decodeError(earlyBuffer).code).toBe(RPC_AUTH_FAILED);

    const mismatchSession = once(server, "session");
    const mismatch = net.connect(pipePath);
    await mismatchSession;
    const mismatchBuffer = await collectUntilClose(mismatch, () => {
      mismatch.write(helloFrame(4, token, "2.0"));
    });
    const version = decodeError(mismatchBuffer);
    expect(version.code).toBe(RPC_PROTOCOL_MISMATCH);
    expect(version.data?.name).toBe("ProtocolVersionMismatchError");

    const minorSession = once(server, "session");
    const minor = net.connect(pipePath);
    await minorSession;
    const minorBuffer = await collectUntilClose(minor, () => {
      minor.write(helloFrame(5, token, "1.2"));
    });
    expect(decodeError(minorBuffer).code).toBe(RPC_PROTOCOL_MISMATCH);
  }, 20_000);

  it("closes a silent connection after the 5-second handshake timeout and opens no TCP port", async () => {
    const listenersBefore = listTcpUdpListeners();
    const listenSpy = vi.spyOn(net.Server.prototype, "listen");
    const { pipePath, server } = await boot();
    for (const call of listenSpy.mock.calls) {
      const first: unknown = call[0];
      expect(typeof first).not.toBe("number");
      if (first && typeof first === "object" && "port" in first) {
        throw new Error("named pipe server listened on a TCP port");
      }
    }
    listenSpy.mockRestore();
    expect(listTcpUdpListeners()).toEqual(listenersBefore);
    const socket = net.connect(pipePath);
    const started = performance.now();
    await once(socket, "close");
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(8_000);
    expect(server.clientCount).toBe(0);
  }, 20_000);

  it("reports EADDRINUSE and restricts the pipe to the current user and SYSTEM", async () => {
    const { pipePath, tokenStore } = await boot({ handshakeTimeoutMs: 1_000 });
    const second = new NamedPipeServer({ pipePath, tokenStore, handshakeTimeoutMs: 1_000 });
    await expect(second.listen()).rejects.toBeInstanceOf(PipeInUseError);
    await second.close();
    if (process.platform !== "win32") return;
    const sid = await currentUserSid();
    const leaf = pipePath.slice(pipePath.lastIndexOf("\\") + 1);
    const descriptors = await readNamedPipeSddl(leaf);
    expect(descriptors.length).toBeGreaterThan(0);
    for (const sddl of descriptors) {
      expect([...securityTrustees(sddl)].sort()).toEqual([sid, "SY"].sort());
    }
  }, 20_000);

  it("closes the socket when a frame length exceeds 1 MB", async () => {
    const { pipePath, server } = await boot({ handshakeTimeoutMs: 1_000 });
    const sessionPromise = once(server, "session");
    const failed = once(server, "frame-error");
    const socket = net.connect(pipePath);
    await sessionPromise;
    const header = Buffer.alloc(5);
    header.writeUInt32BE(0xffff_ffff, 0);
    header.writeUInt8(0, 4);
    const closed = once(socket, "close");
    socket.write(header);
    const [error] = (await failed) as [unknown];
    expect(error).toBeInstanceOf(FrameTooLargeError);
    await closed;
  }, 20_000);

  it("isolates three clients and re-authenticates after the daemon rotates the token", async () => {
    const { directory, pipePath, logger, server } = await boot({ handshakeTimeoutMs: 1_000 });
    server.setRequestHandler((request, session) => {
      const params = request.params;
      const nonce =
        params && typeof params === "object" && "nonce" in params && typeof params.nonce === "string"
          ? params.nonce
          : "";
      return { nonce, sessionId: session.id };
    });
    const tokenPath = path.join(directory, "session.token");
    const clients = [0, 1, 2].map(
      () =>
        new NamedPipeClient({
          pipePath,
          tokenPath,
          heartbeatMs: 0,
          backoffBaseMs: 15,
          backoffMaxMs: 60,
          requestTimeoutMs: 1_000,
        }),
    );
    remember(async () => {
      await Promise.all(clients.map((client) => client.close()));
    });
    await Promise.all(clients.map((client) => client.start()));
    expect(server.clientCount).toBe(3);
    const replies = await Promise.all(clients.map((client, index) => client.request("echo", { nonce: `n-${index}` })));
    expect(replies.map((reply) => (reply as { nonce: string }).nonce)).toEqual(["n-0", "n-1", "n-2"]);
    expect(new Set(replies.map((reply) => (reply as { sessionId: number }).sessionId)).size).toBe(3);

    await clients[2]?.close();
    await sleep(80);
    expect(server.clientCount).toBe(2);

    const oldToken = (await fs.promises.readFile(tokenPath, "utf8")).trim();
    await server.close();
    const next = new NamedPipeServer({
      pipePath,
      tokenStore: new SessionTokenStore({ directory, logger }),
      logger,
      handshakeTimeoutMs: 1_000,
    });
    remember(async () => {
      await next.close();
    });
    await next.listen();
    const rotated = (await fs.promises.readFile(tokenPath, "utf8")).trim();
    expect(rotated).not.toBe(oldToken);

    const deadline = Date.now() + 5_000;
    let ping: unknown;
    while (Date.now() < deadline) {
      try {
        ping = await clients[0]?.request("session.ping", {});
        break;
      } catch {
        await sleep(30);
      }
    }
    expect(ping).toEqual({ ok: true });

    const rejected = net.connect(pipePath);
    const rejectedBuffer = await collectUntilClose(rejected, () => {
      rejected.write(helloFrame(9, oldToken));
    });
    expect(decodeError(rejectedBuffer).code).toBe(RPC_AUTH_FAILED);
  }, 20_000);

  it("heartbeats with session.ping and transfers channel 1 frames to a MessagePort", async () => {
    const { directory, pipePath, server } = await boot({ handshakeTimeoutMs: 1_000 });
    let pings = 0;
    server.on("ping", () => {
      pings += 1;
    });
    const { utility, renderer } = MessagePortBridge.pair();
    remember(async () => {
      utility.close();
      renderer.close();
    });
    const sessionPromise = once(server, "session");
    const client = new NamedPipeClient({
      pipePath,
      tokenPath: path.join(directory, "session.token"),
      heartbeatMs: 40,
      backoffBaseMs: 20,
      backoffMaxMs: 80,
      requestTimeoutMs: 1_000,
      bridge: utility,
    });
    remember(async () => {
      await client.close();
    });
    await client.start();
    const [session] = (await sessionPromise) as [PipeSession];
    const started = Date.now();
    while (pings < 2 && Date.now() - started < 2_000) await sleep(15);
    expect(pings).toBeGreaterThanOrEqual(2);

    const transferred = new Promise<Uint8Array>((resolve) => {
      renderer.onBinary((message) => resolve(new Uint8Array(message.payload)));
    });
    await session.sendBinary(3, Uint8Array.from([4, 5, 6]));
    expect([...(await transferred)]).toEqual([4, 5, 6]);
  }, 20_000);

  it("rejects outbound frames that would grow a client buffer without a bound", async () => {
    const { pipePath, tokenStore, server } = await boot({
      handshakeTimeoutMs: 1_000,
      maxOutboundBytes: 32_768,
    });
    const found = new Promise<PipeSession>((resolve) => {
      server.once("session", (session: PipeSession) => resolve(session));
    });
    const socket = net.connect(pipePath);
    remember(async () => {
      socket.destroy();
    });
    const session = await found;
    const response = new Promise<void>((resolve) => {
      socket.once("data", () => resolve());
    });
    socket.write(helloFrame(1, tokenStore.token));
    await response;
    const payload = new Uint8Array(8_000);
    let rejected = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        session.sendBinary(1, payload).then(
          () => undefined,
          (error: unknown) => {
            if (error instanceof OutboundBufferLimitError) rejected += 1;
            else throw error;
          },
        ),
      ),
    );
    expect(rejected).toBeGreaterThan(0);
    expect(server.clientCount).toBe(1);
  }, 20_000);
});
