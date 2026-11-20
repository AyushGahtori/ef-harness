import { describe, expect, it } from "vitest";
import { ConcurrencyPerfVerifier } from "../../src/surfaces/concurrency-perf-verifier.js";
import { createAsyncBarrier } from "../../src/surfaces/ports/barrier.js";
import type { HostCpuSampler } from "../../src/surfaces/ports/cpu.js";
import { listen, readBody, sendJson, verifierContext } from "./support.js";

type Mode = "optimistic" | "last-write" | "corrupt" | "slow";

function spec(dialect: "sqlite" | "postgres", mode: "optimistic_version" | "last_write_wins", threshold: number) {
  return {
    checkId: "concurrency.item",
    mode,
    path: "/items/1",
    readPath: "/items/1",
    manifestDialect: dialect,
    dialectProbePath: "/meta/dialect",
    clients: [
      { body: { expectedVersion: 1, title: "A", note: "A" } },
      { body: { expectedVersion: 1, title: "B", note: "B" } },
    ],
    performance: {
      path: "/bench/query",
      datasetRows: 10_000,
      seed: 42,
      warmup: 2,
      iterations: 20,
      p95ThresholdMs: threshold,
      maxHostCpuPercent: 95,
    },
  };
}

const quietCpu: HostCpuSampler = {
  sample: () => ({ idleMs: 100, totalMs: 100 }),
};

async function startTarget(dialect: "sqlite" | "postgres", mode: Mode) {
  let version = 1;
  let row = { title: "base", note: "base" };
  const waiters = new Map<string, Array<() => void>>();
  const cache = new Map<string, { rows: number; seed: number }>();
  return listen(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/meta/dialect") {
      sendJson(response, 200, { dialect });
      return;
    }
    if (url.pathname === "/bench/query") {
      const seed = Number(url.searchParams.get("seed"));
      const rows = Number(url.searchParams.get("rows"));
      const key = `${seed}:${rows}`;
      if (!cache.has(key)) {
        let state = seed >>> 0;
        for (let index = 0; index < rows; index += 1) {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        }
        cache.set(key, { rows, seed });
      }
      if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 25));
      sendJson(response, 200, cache.get(key));
      return;
    }
    if (request.method === "GET") {
      sendJson(response, 200, { row, version, dialect });
      return;
    }
    const barrier = request.headers["x-barrier-id"];
    const barrierId = Array.isArray(barrier) ? barrier[0] : barrier;
    const parties = Number(request.headers["x-barrier-parties"] ?? 2);
    await new Promise<void>((resolve) => {
      const list = waiters.get(barrierId ?? "none") ?? [];
      list.push(resolve);
      waiters.set(barrierId ?? "none", list);
      if (list.length >= parties) {
        waiters.delete(barrierId ?? "none");
        for (const release of list) release();
      }
    });
    const body = JSON.parse(await readBody(request)) as {
      expectedVersion: number;
      title: string;
      note: string;
    };
    if (mode === "optimistic") {
      const seen = version;
      await new Promise((resolve) => setImmediate(resolve));
      if (seen !== version) {
        sendJson(response, 409, { conflict: true });
        return;
      }
      version = seen + 1;
      row = { title: body.title, note: body.note };
      sendJson(response, 200, { ok: true });
      return;
    }
    if (mode === "corrupt") {
      if (body.title === "A") {
        row = { ...row, title: body.title };
        await new Promise((resolve) => setImmediate(resolve));
        row = { ...row, note: body.note };
      } else {
        row = { ...row, note: body.note };
        await new Promise((resolve) => setImmediate(resolve));
        row = { ...row, title: body.title };
      }
      sendJson(response, 200, { ok: true });
      return;
    }
    const next = { title: body.title, note: body.note };
    await new Promise((resolve) => setImmediate(resolve));
    row = next;
    sendJson(response, 200, { ok: true });
  });
}

describe("ConcurrencyPerfVerifier", () => {
  it("releases both barrier parties together", async () => {
    const barrier = createAsyncBarrier(2);
    let first = false;
    const left = barrier.arrive().then(() => {
      first = true;
    });
    expect(first).toBe(false);
    const right = barrier.arrive();
    await Promise.all([left, right]);
    expect(first).toBe(true);
  });

  it("accepts an optimistic 409 and a last-write-wins row on the manifest dialect", async () => {
    const sqlite = await startTarget("sqlite", "optimistic");
    const postgres = await startTarget("postgres", "last-write");
    try {
      const optimistic = await new ConcurrencyPerfVerifier({ hostCpu: quietCpu }).verify(
        spec("sqlite", "optimistic_version", 500),
        verifierContext(sqlite.url),
      );
      const lastWrite = await new ConcurrencyPerfVerifier({ hostCpu: quietCpu }).verify(
        spec("postgres", "last_write_wins", 500),
        verifierContext(postgres.url),
      );
      expect(optimistic.every((result) => result.status === "pass")).toBe(true);
      expect(lastWrite.every((result) => result.status === "pass")).toBe(true);
      const receipt = optimistic.find((result) => result.check_id === "concurrency.item:perf")?.receipt;
      expect(receipt).toMatchObject({
        datasetRowCount: 10_000,
        iterationCount: 20,
        seed: 42,
        p95ThresholdMs: 500,
        engineDialect: "sqlite",
      });
    } finally {
      await sqlite.close();
      await postgres.close();
    }
  });

  it("fails when the target dialect disagrees and when last-write-wins mixes fields", async () => {
    const mismatch = await startTarget("sqlite", "optimistic");
    const corrupt = await startTarget("postgres", "corrupt");
    try {
      const dialect = await new ConcurrencyPerfVerifier({ hostCpu: quietCpu }).verify(
        spec("postgres", "optimistic_version", 500),
        verifierContext(mismatch.url),
      );
      const mixed = await new ConcurrencyPerfVerifier({ hostCpu: quietCpu }).verify(
        spec("postgres", "last_write_wins", 500),
        verifierContext(corrupt.url),
      );
      expect(dialect.find((result) => result.check_id === "concurrency.item:dialect")?.status).toBe("fail");
      expect(mixed.find((result) => result.check_id === "concurrency.item:race")?.status).toBe("fail");
    } finally {
      await mismatch.close();
      await corrupt.close();
    }
  });

  it("fails a slow p95 and defers when the host is noisy instead of failing the benchmark", async () => {
    const slow = await startTarget("sqlite", "slow");
    try {
      const failed = await new ConcurrencyPerfVerifier({ hostCpu: quietCpu }).verify(
        spec("sqlite", "optimistic_version", 5),
        verifierContext(slow.url),
      );
      const noisySpec = {
        ...spec("sqlite", "optimistic_version", 5),
      };
      noisySpec.performance = { ...noisySpec.performance, maxHostCpuPercent: 50 };
      let samples = 0;
      const noisy = await new ConcurrencyPerfVerifier({
        hostCpu: {
          sample() {
            samples += 1;
            return samples === 1 ? { idleMs: 0, totalMs: 0 } : { idleMs: 0, totalMs: 100 };
          },
        },
      }).verify(noisySpec, verifierContext(slow.url));
      expect(failed.find((result) => result.check_id === "concurrency.item:perf")?.status).toBe("fail");
      const deferred = noisy.find((result) => result.check_id === "concurrency.item:perf");
      expect(deferred?.status).toBe("error");
      expect(deferred?.receipt.flag).toBe("environment_noisy");
      expect(deferred?.attribution).toBe("environment");
    } finally {
      await slow.close();
    }
  });
});
