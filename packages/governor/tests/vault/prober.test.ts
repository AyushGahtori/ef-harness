import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  postgresMd5Password,
  probePostgresSelectOne,
  PostgresUnreachableError,
  scramClientProof,
} from "../../src/vault/postgres-probe.js";
import { ProviderSecretProber } from "../../src/vault/prober.js";
import { POSTGRES_PROBE_TIMEOUT_MS } from "../../src/vault/types.js";

describe("ProviderSecretProber", () => {
  it("uses the five second postgres timeout by default", () => {
    expect(new ProviderSecretProber().timeoutMs).toBe(POSTGRES_PROBE_TIMEOUT_MS);
    expect(POSTGRES_PROBE_TIMEOUT_MS).toBe(5_000);
  });

  it("marks Stripe test and live mode, and zero-token model checks", async () => {
    const seen: { url: string; method: string; headers: Record<string, string> }[] = [];
    const prober = new ProviderSecretProber({
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        const flat: Record<string, string> = {};
        headers.forEach((value, key) => {
          flat[key] = value;
        });
        seen.push({ url: String(url), method: init?.method ?? "GET", headers: flat });
        if (String(url).includes("stripe.com") && flat.authorization?.includes("livemode_on")) {
          return new Response(JSON.stringify({ livemode: true, object: "balance" }), { status: 200 });
        }
        if (String(url).includes("stripe.com") && flat.authorization?.includes("missing")) {
          return new Response("{}", { status: 200 });
        }
        if (String(url).includes("stripe.com") && flat.authorization?.includes("bad")) {
          return new Response("no", { status: 401 });
        }
        if (String(url).includes("stripe.com")) {
          return new Response(JSON.stringify({ livemode: false }), { status: 200 });
        }
        if (String(url).includes("down.example")) return new Response("no", { status: 503 });
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    const live = await prober.probe({
      provider: "stripe",
      secret: "sk_test_fixture_livemode_on",
      envScope: "test",
    });
    expect(live.status).toBe("verified_live");
    expect(live.stripeLivemode).toBe(true);
    const testMode = await prober.probe({
      provider: "stripe",
      secret: "sk_test_fixture_ok",
      envScope: "test",
    });
    expect(testMode).toEqual({ status: "verified_test", stripeLivemode: false });
    expect(await prober.probe({ provider: "stripe", secret: "sk_test_fixture_bad", envScope: "test" })).toEqual({
      status: "invalid",
    });
    expect(await prober.probe({ provider: "stripe", secret: "sk_test_fixture_missing", envScope: "test" })).toEqual({
      status: "invalid",
    });
    expect((await prober.probe({ provider: "openai", secret: "openai_test_fixture_key_999", envScope: "test" })).status).toBe(
      "verified_test",
    );
    expect((await prober.probe({ provider: "anthropic", secret: "anthropic_test_fixture_key_999", envScope: "dev" })).status).toBe(
      "verified_test",
    );
    expect((await prober.probe({ provider: "gemini", secret: "gemini_test_fixture_key_999", envScope: "test" })).status).toBe(
      "verified_test",
    );
    expect((await prober.probe({ provider: "openrouter", secret: "router_test_fixture_key_999", envScope: "test" })).status).toBe(
      "verified_test",
    );
    expect((await prober.probe({ provider: "resend", secret: "resend_test_fixture_key_999", envScope: "test" })).status).toBe(
      "verified_test",
    );
    expect((await prober.probe({ provider: "sendgrid", secret: "sendgrid_test_fixture_key_999", envScope: "prod" })).status).toBe(
      "verified_live",
    );
    const anthropic = seen.find((call) => call.url.includes("anthropic.com"));
    expect(anthropic?.method).toBe("GET");
    expect(anthropic?.headers["x-api-key"]).toBe("anthropic_test_fixture_key_999");
    expect(anthropic?.headers["anthropic-version"]).toBe("2023-06-01");
    const gemini = seen.find((call) => call.url.includes("generativelanguage.googleapis.com"));
    expect(gemini?.url.includes("gemini_test_fixture_key_999")).toBe(true);
    expect(seen.every((call) => call.method === "GET")).toBe(true);
  });

  it("runs SELECT 1 against a postgres handshake and times out", async () => {
    const proof = scramClientProof({
      password: "pencil",
      clientFirstBare: "n=user,r=rOprNGfwEbeRWgbNEkqO",
      serverFirst:
        "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
      clientFinalWithoutProof: "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0",
    });
    expect(proof.proof).toBe("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=");
    expect(proof.serverSignature).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
    const ok = await listen((socket, bufferRef) => {
      socket.on("data", (chunk) => {
        bufferRef.buffer = Buffer.concat([bufferRef.buffer, chunk]);
        if (bufferRef.phase === "startup") {
          if (bufferRef.buffer.length < 8) return;
          const length = bufferRef.buffer.readInt32BE(0);
          if (bufferRef.buffer.length < length) return;
          bufferRef.buffer = bufferRef.buffer.subarray(length);
          bufferRef.phase = "query";
          socket.write(Buffer.concat([typed("R", int32(0)), typed("Z", Buffer.from("I"))]));
          return;
        }
        const message = takeMessage(bufferRef);
        if (message?.type === "Q") {
          socket.write(Buffer.concat([typed("C", Buffer.from("SELECT 1\0")), typed("Z", Buffer.from("I"))]));
        }
      });
    });
    const prober = new ProviderSecretProber({ timeoutMs: 2_000 });
    const result = await prober.probe({
      provider: "postgres",
      secret: `postgres://app:local_fixture@127.0.0.1:${ok.port}/app`,
      envScope: "test",
    });
    await ok.close();
    expect(result.status).toBe("verified_test");

    const md5 = await listen((socket, bufferRef) => {
      const salt = Buffer.from([1, 2, 3, 4]);
      socket.on("data", (chunk) => {
        bufferRef.buffer = Buffer.concat([bufferRef.buffer, chunk]);
        if (bufferRef.phase === "startup") {
          if (bufferRef.buffer.length < 8) return;
          const length = bufferRef.buffer.readInt32BE(0);
          if (bufferRef.buffer.length < length) return;
          bufferRef.buffer = bufferRef.buffer.subarray(length);
          bufferRef.phase = "auth";
          socket.write(typed("R", Buffer.concat([int32(5), salt])));
          return;
        }
        const message = takeMessage(bufferRef);
        if (!message) return;
        if (message.type === "Q") {
          socket.write(Buffer.concat([typed("C", Buffer.from("SELECT 1\0")), typed("Z", Buffer.from("I"))]));
          return;
        }
        if (message.type !== "p") return;
        const expected = postgresMd5Password("app", "local_fixture", salt);
        const got = message.body.toString("utf8").replace(/\0+$/, "");
        if (got !== expected) {
          socket.write(typed("E", Buffer.from("SERROR\0C28P01\0\0")));
          return;
        }
        bufferRef.phase = "query";
        socket.write(Buffer.concat([typed("R", int32(0)), typed("Z", Buffer.from("I"))]));
      });
    });
    await probePostgresSelectOne(`postgres://app:local_fixture@127.0.0.1:${md5.port}/app`, 2_000);
    await md5.close();

    const hung = await listen(() => undefined);
    await expect(
      probePostgresSelectOne(`postgres://app:local_fixture@127.0.0.1:${hung.port}/app`, 200),
    ).rejects.toBeInstanceOf(PostgresUnreachableError);
    await hung.close();
  });
});

interface ServerState {
  buffer: Buffer;
  phase: "startup" | "auth" | "query";
}

function listen(
  onConnection: (socket: net.Socket, state: ServerState) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    onConnection(socket, { buffer: Buffer.alloc(0), phase: "startup" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

function typed(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, "ascii");
  header.writeInt32BE(4 + payload.length, 1);
  return Buffer.concat([header, payload]);
}

function int32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function takeMessage(state: ServerState): { type: string; body: Buffer } | null {
  if (state.buffer.length < 5) return null;
  const type = String.fromCharCode(state.buffer[0] ?? 0);
  const length = state.buffer.readInt32BE(1);
  if (state.buffer.length < 1 + length) return null;
  const body = state.buffer.subarray(5, 1 + length);
  state.buffer = state.buffer.subarray(1 + length);
  return { type, body };
}
