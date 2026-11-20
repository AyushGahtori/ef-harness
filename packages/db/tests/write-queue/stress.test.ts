import { afterEach, describe, expect, it } from "vitest";

import { CoordinatorWriteQueue } from "../../src/write-queue/index.js";
import { openState, scalar, type OpenedState } from "./state-db.js";

const WORK_DDL = `
CREATE TABLE claims (id TEXT PRIMARY KEY, task TEXT NOT NULL, epoch INTEGER NOT NULL) STRICT;
CREATE TABLE reservations (id TEXT PRIMARY KEY, units INTEGER NOT NULL) STRICT;
CREATE TABLE check_results (id TEXT PRIMARY KEY, status TEXT NOT NULL) STRICT;
`;

const openDatabases: OpenedState[] = [];
const queues: CoordinatorWriteQueue[] = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.drainAndClose();
  for (const opened of openDatabases.splice(0)) opened.close();
});

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

describe("write-queue latency", () => {
  it("keeps p99 under 50ms for 50 simulated workers", async () => {
    const opened = openState({ file: true, extraSql: WORK_DDL });
    openDatabases.push(opened);
    const queue = new CoordinatorWriteQueue({
      stateDb: opened.stateDb,
      coalesceWindowMs: 2,
      maxBatchSize: 64,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
    });
    queues.push(queue);
    await queue.submitOperation({
      opId: "warmup",
      kind: "claim",
      request: { warmup: true },
      execute: (tx) => {
        tx.prepare("INSERT INTO claims (id, task, epoch) VALUES ('warmup', 'T00', 1)").run();
        return { warmup: true };
      },
    });

    const workers = 50;
    const rounds = 4;
    const samples: number[] = [];
    await Promise.all(
      Array.from({ length: workers }, async (_, worker) => {
        for (let round = 0; round < rounds; round += 1) {
          const kind = round % 3;
          const started = performance.now();
          if (kind === 0) {
            await queue.submitOperation({
              opId: `claim-${worker}-${round}`,
              kind: "claim",
              request: { worker, round, kind: "claim" },
              execute: (tx) => {
                tx.prepare("INSERT INTO claims (id, task, epoch) VALUES (:id, :task, :epoch)").run({
                  id: `c-${worker}-${round}`,
                  task: `T${worker}`,
                  epoch: round + 1,
                });
                return { worker, round };
              },
            });
          } else if (kind === 1) {
            await queue.submitOperation({
              opId: `reserve-${worker}-${round}`,
              kind: "reserve",
              request: { worker, round, kind: "reserve" },
              execute: (tx) => {
                tx.prepare("INSERT INTO reservations (id, units) VALUES (:id, :units)").run({
                  id: `r-${worker}-${round}`,
                  units: 1000 + worker,
                });
                return { worker, round };
              },
            });
          } else {
            await queue.submitOperation({
              opId: `check-${worker}-${round}`,
              kind: "check_result",
              request: { worker, round, kind: "check" },
              execute: (tx) => {
                tx.prepare("INSERT INTO check_results (id, status) VALUES (:id, 'pass')").run({
                  id: `k-${worker}-${round}`,
                });
                return { worker, round };
              },
            });
          }
          samples.push(performance.now() - started);
        }
      }),
    );

    const sorted = [...samples].sort((left, right) => left - right);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    const metrics = queue.getQueueMetrics();
    expect(samples).toHaveLength(workers * rounds);
    expect(scalar(opened.database, "SELECT count(*) AS n FROM operations")).toBe(workers * rounds + 1);
    expect(
      p99,
      `p50=${p50.toFixed(2)} p95=${p95.toFixed(2)} p99=${p99.toFixed(2)} queueP99=${metrics.p99Ms.toFixed(2)}`,
    ).toBeLessThan(50);
    expect(metrics.p99Ms).toBeLessThan(50);
    expect(metrics.operationsRejected).toBe(0);
  }, 30_000);
});
