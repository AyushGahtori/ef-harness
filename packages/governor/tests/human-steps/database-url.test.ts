import net from "node:net";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

import {
  DB_AUTH_FAILED_DIAGNOSIS,
  authenticationCleartext,
  authenticationMd5,
  authenticationOk,
  clientProof,
  commandComplete,
  dataRow,
  errorResponse,
  md5PostgresPassword,
  openHumanSteps,
  readyForQuery,
  type ProbeLogger,
} from "../../src/human-steps/index.js";

const PASSWORD = "db-password-canary";

it("matches the SCRAM-SHA-256 and MD5 handshake vectors", () => {
  const proof = clientProof(
    "pencil",
    "n=user,r=rOprNGfwEbeRWgbNEkqO",
    "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
  );
  expect(proof.proof).toBe("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=");
  expect(proof.server).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
  const salt = Buffer.from("abcd");
  const inner = createHash("md5").update(`secretuser`).digest("hex");
  const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
  expect(md5PostgresPassword("user", "secret", salt)).toBe(`md5${outer}`);
});

it("runs SELECT 1 and PING, and masks a failed database password", async () => {
  const logs: string[] = [];
  const logger: ProbeLogger = {
    write(event, fields) {
      logs.push(JSON.stringify({ event, fields }));
    },
  };
  const postgres = await listen((socket) => {
    const queries: Buffer[] = [];
    socket.once("data", () => {
      socket.write(authenticationOk());
      socket.write(readyForQuery());
      socket.on("data", (chunk) => {
        queries.push(Buffer.from(chunk));
        const text = chunk.toString("utf8");
        expect(text).not.toMatch(/create|insert|update|delete|drop/i);
        expect(text).toContain("SELECT 1");
        socket.write(dataRow("1"));
        socket.write(commandComplete("SELECT 1"));
        socket.write(readyForQuery());
      });
    });
  });
  const redis = await listen((socket) => {
    socket.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      expect(text).not.toMatch(/SET|FLUSH|DEL/);
      if (text.includes("PING")) socket.write(Buffer.from("+PONG\r\n"));
    });
  });
  const denied = await listen((socket) => {
    socket.once("data", () => {
      socket.end(errorResponse("28P01", `password authentication failed for user "user" secret ${PASSWORD}`));
    });
  });
  const runtime = openHumanSteps({
    now: () => 70,
    timeoutMs: 2_000,
    logger,
    vault: {
      readSecret(secretId: string) {
        if (secretId === "pg") return `postgresql://user:${PASSWORD}@127.0.0.1:${postgres.port}/app`;
        if (secretId === "redis") return `redis://127.0.0.1:${redis.port}/0`;
        return `postgresql://user:${PASSWORD}@127.0.0.1:${denied.port}/app`;
      },
    },
  });
  const pg = runtime.createStep(dbStep("pg", "postgres", "T-pg"));
  const pgResult = await runtime.checkAgain(pg.stepId);
  expect(pgResult.code).toBe("SELECT_1");
  expect(runtime.store.require(pg.stepId).status).toBe("verified");

  const cache = runtime.createStep(dbStep("redis", "redis", "T-redis"));
  expect((await runtime.checkAgain(cache.stepId)).code).toBe("PONG");

  const auth = runtime.createStep(dbStep("denied", "postgres", "T-auth"));
  const authResult = await runtime.checkAgain(auth.stepId);
  expect(authResult.code).toBe("AUTH_FAILED");
  expect(authResult.diagnosis).toBe(DB_AUTH_FAILED_DIAGNOSIS);
  expect(authResult.evidence.target).toBe(`postgresql://user:***@127.0.0.1:${denied.port}/app`);
  const dumped = JSON.stringify(authResult) + logs.join("\n") + JSON.stringify(runtime.store.require(auth.stepId));
  expect(dumped).not.toContain(PASSWORD);
  await postgres.close();
  await redis.close();
  await denied.close();
  runtime.close();
});

it("accepts a Postgres MD5 password without echoing it", async () => {
  const salt = Buffer.from("wxyz");
  const server = await listen((socket) => {
    socket.once("data", () => {
      socket.write(authenticationMd5(salt));
      socket.once("data", (chunk) => {
        const expected = md5PostgresPassword("user", PASSWORD, salt);
        if (!chunk.toString("utf8").includes(expected)) {
          socket.end(errorResponse("28P01", "password authentication failed"));
          return;
        }
        socket.write(authenticationOk());
        socket.write(readyForQuery());
        socket.on("data", () => {
          socket.write(dataRow("1"));
          socket.write(commandComplete("SELECT 1"));
          socket.write(readyForQuery());
        });
      });
    });
  });
  const runtime = openHumanSteps({
    now: () => 80,
    timeoutMs: 2_000,
    vault: { readSecret: () => `postgresql://user:${PASSWORD}@127.0.0.1:${server.port}/app` },
  });
  const step = runtime.createStep(dbStep("pg", "postgres", "T-md5"));
  expect((await runtime.checkAgain(step.stepId)).outcome).toBe("pass");
  expect(JSON.stringify(runtime.store.require(step.stepId))).not.toContain(PASSWORD);
  await server.close();
  runtime.close();
});

it("accepts a cleartext Postgres password handshake", async () => {
  const seen: string[] = [];
  const server = await listen((socket) => {
    socket.once("data", () => {
      socket.write(authenticationCleartext());
      socket.once("data", (chunk) => {
        seen.push(chunk.toString("utf8"));
        socket.write(authenticationOk());
        socket.write(readyForQuery());
        socket.on("data", () => {
          socket.write(dataRow("1"));
          socket.write(commandComplete("SELECT 1"));
          socket.write(readyForQuery());
        });
      });
    });
  });
  const runtime = openHumanSteps({
    now: () => 90,
    timeoutMs: 2_000,
    vault: { readSecret: () => `postgresql://user:${PASSWORD}@127.0.0.1:${server.port}/app` },
  });
  const step = runtime.createStep(dbStep("pg", "postgres", "T-clear"));
  expect((await runtime.checkAgain(step.stepId)).code).toBe("SELECT_1");
  expect(seen.join("")).toContain(PASSWORD);
  expect(JSON.stringify(runtime.store.require(step.stepId))).not.toContain(PASSWORD);
  await server.close();
  runtime.close();
});

it("reports a refused database port and a black-holed handshake within the cap", async () => {
  const closed = await listen(() => undefined);
  const port = closed.port;
  await closed.close();
  const blackhole = await listen(() => undefined);
  const runtime = openHumanSteps({
    now: () => 100,
    timeoutMs: 200,
    vault: {
      readSecret(secretId: string) {
        if (secretId === "closed") return `postgresql://user:${PASSWORD}@127.0.0.1:${port}/app`;
        return `redis://:${PASSWORD}@127.0.0.1:${blackhole.port}/0`;
      },
    },
  });
  const refused = runtime.createStep(dbStep("closed", "postgres", "T-refused"));
  const refusedResult = await runtime.checkAgain(refused.stepId);
  expect(refusedResult.code).toBe("ECONNREFUSED");
  expect(refusedResult.diagnosis).toContain(`127.0.0.1:${port}`);
  expect(refusedResult.diagnosis).not.toContain(PASSWORD);
  const hung = runtime.createStep(dbStep("blackhole", "redis", "T-hang"));
  const started = Date.now();
  const hungResult = await runtime.checkAgain(hung.stepId);
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(hungResult.code).toBe("PROBE_TIMEOUT");
  expect(hungResult.durationMs).toBeLessThan(10_000);
  expect(JSON.stringify(hungResult)).not.toContain(PASSWORD);
  await blackhole.close();
  runtime.close();
});

function dbStep(secretId: string, engine: "postgres" | "redis", task: string) {
  return {
    stepType: "database" as const,
    title: "Database",
    plainEnglishInstructions: ["The database must accept a read-only probe."],
    probeSpec: { kind: "database_url" as const, secretId, engine, requiredFor: "migrations" as const },
    blockingTaskIds: [task],
  };
}

function listen(onConnection: (socket: net.Socket) => void): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    onConnection(socket);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing port");
      resolve({
        port: address.port,
        close: () =>
          new Promise((done, reject) => {
            for (const socket of sockets) socket.destroy();
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}
