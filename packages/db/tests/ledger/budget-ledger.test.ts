import { afterEach, describe, expect, it } from "vitest";
import {
  BudgetLedgerRepo,
  NonIntegerCurrencyUnitsError,
  ScopeBindingError,
} from "../../src/ledger/index.js";
import { createTestLedger } from "./support.js";

const open: { db: { close(): void } }[] = [];

afterEach(() => {
  for (const item of open) item.db.close();
  open.length = 0;
});

function ledger(): BudgetLedgerRepo {
  const created = createTestLedger();
  open.push(created);
  return created.repo;
}

function schemaChain(repo: BudgetLedgerRepo): void {
  repo.createBudgetScope({
    scopeKind: "project",
    scopeId: "P",
    currency: "usd",
    limitUnits: 1_000_000,
  });
  repo.createBudgetScope({
    scopeKind: "task",
    scopeId: "T07",
    currency: "usd",
    limitUnits: 300_000,
    parentKind: "project",
    parentId: "P",
  });
  repo.createBudgetScope({
    scopeKind: "grant",
    scopeId: "G1",
    currency: "usd",
    limitUnits: 800_000,
  });
}

describe("budget ledger schema scenarios", () => {
  it("reserves across task, project, and grant, then settles an overrun that blocks the next unit", () => {
    const repo = ledger();
    schemaChain(repo);
    const first = repo.reserveAcrossScopes({
      reservationId: "RES-1",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 100_000,
      scopeKind: "task",
      scopeId: "T07",
      additionalScopes: [{ scopeKind: "grant", scopeId: "G1" }],
      createdAt: 0,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.reservation.scopes.map((scope) => scope.scopeKind)).toEqual(["task", "project", "grant"]);
    expect(repo.getBudgetRemaining("project", "P").find((row) => row.currency === "usd")?.reservedUnits).toBe(
      100_000,
    );

    const overflow = repo.reserveAcrossScopes({
      reservationId: "RES-2",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 250_000,
      scopeKind: "task",
      scopeId: "T07",
      additionalScopes: [{ scopeKind: "grant", scopeId: "G1" }],
      createdAt: 1,
    });
    expect(overflow).toEqual({ ok: false, blockingScopes: ["task"] });
    expect(repo.getReservation("RES-2")).toBeNull();
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(100_000);
    expect(repo.auditConservation().ok).toBe(true);

    const settled = repo.settleReservation({ reservationId: "RES-1", actualUnits: 340_000, now: 1 });
    expect(settled).toMatchObject({
      ok: true,
      idempotent: false,
      actualUnits: 340_000,
      overrunUnits: 240_000,
    });
    const task = repo.getBudgetRemaining("task", "T07")[0];
    expect(task?.spentUnits).toBe(340_000);
    expect(task?.reservedUnits).toBe(0);
    expect(task?.overrun).toBe(true);
    expect(repo.getReservation("RES-1")).toMatchObject({ state: "settled", overrunUnits: 240_000 });

    const blocked = repo.reserveAcrossScopes({
      reservationId: "RES-3",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 1,
      scopeKind: "task",
      scopeId: "T07",
      additionalScopes: [{ scopeKind: "grant", scopeId: "G1" }],
      createdAt: 2,
    });
    expect(blocked.ok).toBe(false);
    expect(100_000 + 100_000 + 100_000).toBe(300_000);
    expect(0.1 + 0.1 + 0.1 === 0.3).toBe(false);
    expect(repo.auditConservation().ok).toBe(true);
  });

  it("returns blockingScopes project when two reserves compete for the last $0.20 of $1.00", () => {
    const repo = ledger();
    repo.createBudgetScope({
      scopeKind: "project",
      scopeId: "P",
      currency: "usd",
      limitUnits: 1_000_000,
    });
    repo.createBudgetScope({
      scopeKind: "feature",
      scopeId: "F",
      currency: "usd",
      limitUnits: 5_000_000,
      parentKind: "project",
      parentId: "P",
    });
    repo.createBudgetScope({
      scopeKind: "task",
      scopeId: "T",
      currency: "usd",
      limitUnits: 5_000_000,
      parentKind: "feature",
      parentId: "F",
    });
    const held = repo.reserveAcrossScopes({
      reservationId: "held-80",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 800_000,
      scopeKind: "task",
      scopeId: "T",
      createdAt: 1,
    });
    expect(held.ok).toBe(true);
    const first = repo.reserveAcrossScopes({
      reservationId: "worker-a",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 200_000,
      scopeKind: "task",
      scopeId: "T",
      createdAt: 2,
    });
    const second = repo.reserveAcrossScopes({
      reservationId: "worker-b",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 200_000,
      scopeKind: "task",
      scopeId: "T",
      createdAt: 3,
    });
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, blockingScopes: ["project"] });
    expect(repo.getReservation("worker-b")).toBeNull();
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(1_000_000);
    expect(repo.auditConservation().ok).toBe(true);
  });

  it("stores explicit parent links for every scope kind", () => {
    const created = createTestLedger();
    open.push(created);
    const { db, repo } = created;
    repo.createBudgetScope({
      scopeKind: "project",
      scopeId: "P",
      currency: "usd",
      limitUnits: 10,
    });
    repo.createBudgetScope({
      scopeKind: "feature",
      scopeId: "F",
      currency: "usd",
      limitUnits: 10,
      parentKind: "project",
      parentId: "P",
    });
    repo.createBudgetScope({
      scopeKind: "task",
      scopeId: "T",
      currency: "usd",
      limitUnits: 10,
      parentKind: "feature",
      parentId: "F",
    });
    repo.createBudgetScope({
      scopeKind: "grant",
      scopeId: "G",
      currency: "usd",
      limitUnits: 10,
      parentKind: "project",
      parentId: "P",
    });
    const parents = db
      .prepare(
        `SELECT scope_kind, parent_kind, parent_id FROM budgets WHERE currency = 'usd' ORDER BY scope_kind`,
      )
      .all() as { scope_kind: string; parent_kind: string | null; parent_id: string | null }[];
    expect(parents).toEqual([
      { scope_kind: "feature", parent_kind: "project", parent_id: "P" },
      { scope_kind: "grant", parent_kind: "project", parent_id: "P" },
      { scope_kind: "project", parent_kind: null, parent_id: null },
      { scope_kind: "task", parent_kind: "feature", parent_id: "F" },
    ]);
  });
});

describe("budget ledger edge cases", () => {
  it("rejects a second settlement and a release after settle without moving reserved units", () => {
    const repo = ledger();
    schemaChain(repo);
    expect(
      repo.reserveAcrossScopes({
        reservationId: "RES-1",
        purpose: "model_call",
        currency: "usd",
        amountUnits: 100_000,
        scopeKind: "task",
        scopeId: "T07",
        additionalScopes: [{ scopeKind: "grant", scopeId: "G1" }],
        createdAt: 1,
      }).ok,
    ).toBe(true);
    expect(repo.settleReservation({ reservationId: "RES-1", actualUnits: 80_000, now: 2 }).ok).toBe(true);
    const again = repo.settleReservation({ reservationId: "RES-1", actualUnits: 80_000, now: 3 });
    expect(again).toMatchObject({ ok: true, idempotent: true, actualUnits: 80_000 });
    const different = repo.settleReservation({ reservationId: "RES-1", actualUnits: 90_000, now: 4 });
    expect(different).toEqual({ ok: false, reason: "already_settled" });
    expect(repo.releaseReservation("RES-1")).toEqual({ ok: false, reason: "already_settled" });
    expect(repo.getBudgetRemaining("task", "T07")[0]).toMatchObject({
      reservedUnits: 0,
      spentUnits: 80_000,
    });
    expect(repo.auditConservation().ok).toBe(true);
  });

  it("throws NonIntegerCurrencyUnitsError for fractional or negative units", () => {
    const repo = ledger();
    schemaChain(repo);
    expect(() =>
      repo.reserveAcrossScopes({
        reservationId: "float",
        purpose: "model_call",
        currency: "usd",
        amountUnits: 0.1,
        scopeKind: "task",
        scopeId: "T07",
        createdAt: 1,
      }),
    ).toThrow(NonIntegerCurrencyUnitsError);
    expect(() =>
      repo.reserveAcrossScopes({
        reservationId: "neg",
        purpose: "model_call",
        currency: "usd",
        amountUnits: -1,
        scopeKind: "task",
        scopeId: "T07",
        createdAt: 1,
      }),
    ).toThrow(NonIntegerCurrencyUnitsError);
    expect(
      repo.reserveAcrossScopes({
        reservationId: "RES-1",
        purpose: "model_call",
        currency: "usd",
        amountUnits: 10,
        scopeKind: "task",
        scopeId: "T07",
        createdAt: 1,
      }).ok,
    ).toBe(true);
    expect(() => repo.settleReservation({ reservationId: "RES-1", actualUnits: 1.5, now: 2 })).toThrow(
      NonIntegerCurrencyUnitsError,
    );
    expect(repo.getReservation("float")).toBeNull();
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(10);
  });

  it("rolls back a chain that includes a closed grant and leaves sibling scopes untouched", () => {
    const created = createTestLedger();
    open.push(created);
    const { db, repo } = created;
    schemaChain(repo);
    db.prepare(`UPDATE budgets SET closed = 1 WHERE scope_kind = 'grant' AND scope_id = 'G1'`).run();
    const result = repo.reserveAcrossScopes({
      reservationId: "closed-grant",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 10,
      scopeKind: "task",
      scopeId: "T07",
      additionalScopes: [{ scopeKind: "grant", scopeId: "G1" }],
      createdAt: 1,
    });
    expect(result).toEqual({ ok: false, blockingScopes: ["grant"] });
    expect(repo.getReservation("closed-grant")).toBeNull();
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(0);
    expect(repo.getBudgetRemaining("task", "T07")[0]?.reservedUnits).toBe(0);
  });

  it("settles a zero actual and frees the reservation", () => {
    const repo = ledger();
    schemaChain(repo);
    repo.reserveAcrossScopes({
      reservationId: "free",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 50,
      scopeKind: "task",
      scopeId: "T07",
      createdAt: 1,
    });
    const settled = repo.settleReservation({ reservationId: "free", actualUnits: 0, now: 2 });
    expect(settled).toMatchObject({ ok: true, actualUnits: 0, overrunUnits: 0 });
    expect(repo.getBudgetRemaining("task", "T07")[0]).toMatchObject({ reservedUnits: 0, spentUnits: 0 });
    expect(repo.getReservation("free")?.state).toBe("settled");
    expect(repo.auditConservation().ok).toBe(true);
  });

  it("retains an unknown reservation until release or settlement reconciliation", () => {
    const repo = ledger();
    schemaChain(repo);
    repo.reserveAcrossScopes({
      reservationId: "sleep",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 40_000,
      scopeKind: "task",
      scopeId: "T07",
      createdAt: 1,
    });
    expect(repo.markReservationUnknown("sleep")).toEqual({
      ok: true,
      reservationId: "sleep",
      idempotent: false,
    });
    expect(repo.releaseReservation("sleep")).toEqual({ ok: false, reason: "unknown_retained" });
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(40_000);
    expect(repo.markReservationUnknown("sleep")).toMatchObject({ ok: true, idempotent: true });

    const released = repo.reconcileUnknownReservation({
      reservationId: "sleep",
      resolution: "release",
      now: 2,
    });
    expect(released).toEqual({ ok: true, resolution: "release", reservationId: "sleep" });
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(0);
    expect(repo.getReservation("sleep")?.state).toBe("released");

    repo.reserveAcrossScopes({
      reservationId: "receipt",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 25_000,
      scopeKind: "task",
      scopeId: "T07",
      createdAt: 3,
    });
    repo.markReservationUnknown("receipt");
    const settled = repo.reconcileUnknownReservation({
      reservationId: "receipt",
      resolution: "settle",
      actualUnits: 22_000,
      now: 4,
    });
    expect(settled.ok).toBe(true);
    if (settled.ok && settled.resolution === "settle") {
      expect(settled.settle).toMatchObject({ actualUnits: 22_000, overrunUnits: 0 });
    }
    expect(repo.getBudgetRemaining("task", "T07")[0]).toMatchObject({
      reservedUnits: 0,
      spentUnits: 22_000,
    });
    expect(repo.auditConservation().ok).toBe(true);
  });

  it("releases a held reservation before dispatch", () => {
    const repo = ledger();
    schemaChain(repo);
    repo.reserveAcrossScopes({
      reservationId: "cancel",
      purpose: "effect",
      currency: "usd",
      amountUnits: 15,
      scopeKind: "task",
      scopeId: "T07",
      createdAt: 1,
    });
    expect(repo.releaseReservation("cancel")).toEqual({ ok: true, reservationId: "cancel" });
    expect(repo.releaseReservation("cancel")).toEqual({ ok: false, reason: "already_released" });
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(0);
    expect(repo.auditConservation().ok).toBe(true);
  });

  it("rejects model_call reservations that touch wave_paperwork", () => {
    const repo = ledger();
    repo.createBudgetScope({
      scopeKind: "project",
      scopeId: "P",
      currency: "usd",
      limitUnits: 1_000_000,
    });
    const envelopes = repo.createWavePaperworkEnvelopes({
      projectScopeId: "P",
      currency: "usd",
      waves: [{ waveId: "w3", weight: 1 }],
    });
    const planning = envelopes.find((envelope) => envelope.waveId === "w3" && envelope.phase === "planning");
    expect(planning).toBeDefined();
    expect(() =>
      repo.reserveAcrossScopes({
        reservationId: "coding-dip",
        purpose: "model_call",
        currency: "usd",
        amountUnits: 10,
        scopeKind: "wave_paperwork",
        scopeId: planning?.scopeId ?? "",
        createdAt: 1,
      }),
    ).toThrow(ScopeBindingError);
    expect(repo.getReservation("coding-dip")).toBeNull();
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(0);
  });

  it("registers usd, allowance, and local slot currencies with their integer scales", () => {
    const created = createTestLedger();
    open.push(created);
    const { db, repo } = created;
    expect(repo.registerCurrency("usd")).toEqual({ code: "usd", unit: "micro-USD", scale: 1_000_000 });
    expect(repo.registerCurrency("allowance:chatgpt-personal")).toEqual({
      code: "allowance:chatgpt-personal",
      unit: "ppm of window share",
      scale: 1_000_000,
    });
    expect(repo.registerCurrency("slots:local")).toEqual({ code: "slots:local", unit: "slot", scale: 1 });
    const rows = db
      .prepare(`SELECT code, unit, scale FROM currencies ORDER BY code`)
      .all() as { code: string; unit: string; scale: number }[];
    expect(rows).toEqual([
      { code: "allowance:chatgpt-personal", unit: "ppm of window share", scale: 1_000_000 },
      { code: "slots:local", unit: "slot", scale: 1 },
      { code: "usd", unit: "micro-USD", scale: 1_000_000 },
    ]);
    repo.createBudgetScope({
      scopeKind: "project",
      scopeId: "slots",
      currency: "slots:local",
      limitUnits: 2,
    });
    expect(
      repo.reserveAcrossScopes({
        reservationId: "slot-1",
        purpose: "model_call",
        currency: "slots:local",
        amountUnits: 1,
        scopeKind: "project",
        scopeId: "slots",
        createdAt: 1,
      }).ok,
    ).toBe(true);
    expect(
      repo.reserveAcrossScopes({
        reservationId: "slot-2",
        purpose: "model_call",
        currency: "slots:local",
        amountUnits: 1,
        scopeKind: "project",
        scopeId: "slots",
        createdAt: 2,
      }).ok,
    ).toBe(true);
    expect(
      repo.reserveAcrossScopes({
        reservationId: "slot-3",
        purpose: "model_call",
        currency: "slots:local",
        amountUnits: 1,
        scopeKind: "project",
        scopeId: "slots",
        createdAt: 3,
      }),
    ).toEqual({ ok: false, blockingScopes: ["project"] });
  });
});
