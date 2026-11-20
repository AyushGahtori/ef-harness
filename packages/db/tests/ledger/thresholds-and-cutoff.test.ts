import { afterEach, describe, expect, it } from "vitest";
import { estimateP95OutputUnits } from "../../src/ledger/index.js";
import { createTestLedger } from "./support.js";

const open: { db: { close(): void } }[] = [];

afterEach(() => {
  for (const item of open) item.db.close();
  open.length = 0;
});

describe("spend thresholds and p95 stream cutoff", () => {
  it("signals 50 and 80 as alerts, 90 as wind-down, and 100 as stopped", () => {
    const created = createTestLedger();
    open.push(created);
    const { repo } = created;
    repo.createBudgetScope({
      scopeKind: "project",
      scopeId: "P",
      currency: "usd",
      limitUnits: 1_000,
    });
    expect(repo.evaluateSpendThresholds("project", "P")).toEqual([]);

    repo.reserveAcrossScopes({
      reservationId: "half",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 499,
      scopeKind: "project",
      scopeId: "P",
      createdAt: 1,
    });
    expect(repo.evaluateSpendThresholds("project", "P")).toEqual([]);
    repo.settleReservation({ reservationId: "half", actualUnits: 500, now: 2 });
    expect(repo.evaluateSpendThresholds("project", "P").map((event) => event.thresholdPercent)).toEqual([50]);
    expect(repo.evaluateSpendThresholds("project", "P")[0]).toMatchObject({
      level: "alert",
      stopNewDispatches: false,
      currency: "usd",
    });

    repo.raiseBudgetLimit("project", "P", "usd", 1_000);
    repo.reserveAcrossScopes({
      reservationId: "eighty",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 300,
      scopeKind: "project",
      scopeId: "P",
      createdAt: 3,
    });
    repo.settleReservation({ reservationId: "eighty", actualUnits: 300, now: 4 });
    expect(repo.evaluateSpendThresholds("project", "P").map((event) => event.thresholdPercent)).toEqual([
      50, 80,
    ]);
    expect(repo.evaluateSpendThresholds("project", "P").every((event) => event.level === "alert")).toBe(true);

    repo.reserveAcrossScopes({
      reservationId: "ninety",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 100,
      scopeKind: "project",
      scopeId: "P",
      createdAt: 5,
    });
    repo.settleReservation({ reservationId: "ninety", actualUnits: 100, now: 6 });
    const windDown = repo.evaluateSpendThresholds("project", "P");
    expect(windDown.map((event) => event.thresholdPercent)).toEqual([50, 80, 90]);
    expect(windDown.find((event) => event.thresholdPercent === 90)).toMatchObject({
      level: "wind_down",
      stopNewDispatches: true,
      keepCheckpointReserve: true,
      parkAttempts: false,
    });

    repo.reserveAcrossScopes({
      reservationId: "all",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 100,
      scopeKind: "project",
      scopeId: "P",
      createdAt: 7,
    });
    repo.settleReservation({ reservationId: "all", actualUnits: 100, now: 8 });
    const stopped = repo.evaluateSpendThresholds("project", "P");
    expect(stopped.map((event) => event.thresholdPercent)).toEqual([50, 80, 90, 100]);
    expect(stopped.find((event) => event.thresholdPercent === 100)).toMatchObject({
      level: "stopped",
      stopNewDispatches: true,
      keepCheckpointReserve: false,
      parkAttempts: true,
    });
    expect(repo.auditConservation().ok).toBe(true);
  });

  it("reserves the 95th percentile output and settles the streamed actual", () => {
    const created = createTestLedger();
    open.push(created);
    const { repo } = created;
    const samples = [10, 20, 30, 40, 100, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 90];
    expect(estimateP95OutputUnits(samples)).toBe(90);
    expect(estimateP95OutputUnits([4])).toBe(4);
    repo.createBudgetScope({
      scopeKind: "project",
      scopeId: "P",
      currency: "usd",
      limitUnits: 1_000,
    });
    repo.registerCurrency("allowance:chatgpt");
    repo.createBudgetScope({
      scopeKind: "project",
      scopeId: "P",
      currency: "allowance:chatgpt",
      limitUnits: 1_000_000,
    });
    const reserved = repo.reserveP95StreamCutoff({
      reservationId: "stream",
      purpose: "model_call",
      currency: "allowance:chatgpt",
      scopeKind: "project",
      scopeId: "P",
      createdAt: 1,
      taskClass: "implement",
      observedOutputUnits: samples,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.reservation).toMatchObject({
      amountUnits: 90,
      taskClass: "implement",
      estimateKind: "p95_stream_cutoff",
    });
    const settled = repo.settleReservation({ reservationId: "stream", actualUnits: 40, now: 2 });
    expect(settled).toMatchObject({ ok: true, actualUnits: 40, overrunUnits: 0 });
    expect(repo.getBudgetRemaining("project", "P").find((row) => row.currency === "allowance:chatgpt")).toMatchObject({
      reservedUnits: 0,
      spentUnits: 40,
    });
    expect(repo.auditConservation().ok).toBe(true);
  });
});
