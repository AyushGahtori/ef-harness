import { array, assert, boolean, constant, integer, oneof, property, record } from "fast-check";
import { describe, expect, it } from "vitest";
import { BudgetLedgerRepo, openLedgerDatabase } from "../../src/ledger/index.js";
import type { ScopeKind } from "../../src/ledger/index.js";

interface OpenReservation {
  id: string;
  amount: number;
  state: "held" | "unknown";
}

type Command =
  | { type: "reserve"; amount: number; includeGrant: boolean }
  | { type: "settle"; actualBps: number }
  | { type: "release" }
  | { type: "unknown" }
  | { type: "reconcile"; resolution: "settle" | "release"; actualBps: number }
  | { type: "raise"; scope: "project" | "feature" | "task" | "grant"; delta: number };

const commandArb = oneof(
  record({
    type: constant("reserve" as const),
    amount: integer({ min: 1, max: 80_000 }),
    includeGrant: boolean(),
  }),
  record({
    type: constant("settle" as const),
    actualBps: integer({ min: 0, max: 30_000 }),
  }),
  record({ type: constant("release" as const) }),
  record({ type: constant("unknown" as const) }),
  record({
    type: constant("reconcile" as const),
    resolution: oneof(constant("settle" as const), constant("release" as const)),
    actualBps: integer({ min: 0, max: 30_000 }),
  }),
  record({
    type: constant("raise" as const),
    scope: oneof(
      constant("project" as const),
      constant("feature" as const),
      constant("task" as const),
      constant("grant" as const),
    ),
    delta: integer({ min: 1, max: 100_000 }),
  }),
);

describe("ledger conservation properties", () => {
  it("keeps reserved and spent units exact across 1000 interleaved sequences", () => {
    assert(
      property(array(commandArb, { minLength: 12, maxLength: 30 }), (commands) => {
        const db = openLedgerDatabase();
        try {
          const repo = new BudgetLedgerRepo(db);
          repo.registerCurrency("usd");
          repo.createBudgetScope({
            scopeKind: "project",
            scopeId: "P",
            currency: "usd",
            limitUnits: 200_000,
          });
          repo.createBudgetScope({
            scopeKind: "feature",
            scopeId: "F",
            currency: "usd",
            limitUnits: 200_000,
            parentKind: "project",
            parentId: "P",
          });
          repo.createBudgetScope({
            scopeKind: "task",
            scopeId: "T",
            currency: "usd",
            limitUnits: 150_000,
            parentKind: "feature",
            parentId: "F",
          });
          repo.createBudgetScope({
            scopeKind: "grant",
            scopeId: "G",
            currency: "usd",
            limitUnits: 120_000,
          });
          const open: OpenReservation[] = [];
          let sequence = 0;
          for (const command of commands) {
            sequence += 1;
            applyCommand(repo, open, command, sequence);
            const audit = repo.auditConservation();
            if (!audit.ok) {
              throw new Error(`conservation drift after ${JSON.stringify(command)}: ${JSON.stringify(audit.mismatches)}`);
            }
          }
        } finally {
          db.close();
        }
      }),
      { numRuns: 1000, seed: 23 },
    );
    expect(true).toBe(true);
  }, 120_000);
});

function applyCommand(
  repo: BudgetLedgerRepo,
  open: OpenReservation[],
  command: Command,
  sequence: number,
): void {
  if (command.type === "reserve") {
    const reservationId = `R${sequence}`;
    const additionalScopes = command.includeGrant
      ? [{ scopeKind: "grant" as const, scopeId: "G" }]
      : undefined;
    const result = repo.reserveAcrossScopes({
      reservationId,
      purpose: "model_call",
      currency: "usd",
      amountUnits: command.amount,
      scopeKind: "task",
      scopeId: "T",
      createdAt: sequence,
      ...(additionalScopes ? { additionalScopes } : {}),
    });
    if (!result.ok) {
      if (repo.getReservation(reservationId) !== null) {
        throw new Error(`failed reserve ${reservationId} left a row`);
      }
      return;
    }
    for (const scope of result.reservation.scopes) {
      const row = repo
        .getBudgetRemaining(scope.scopeKind, scope.scopeId)
        .find((item) => item.currency === "usd");
      if (!row) throw new Error(`missing scope ${scope.scopeKind}`);
      if (BigInt(row.reservedUnits) + BigInt(row.spentUnits) > BigInt(row.limitUnits)) {
        throw new Error(`reserve ${reservationId} overdrew ${scope.scopeKind}`);
      }
    }
    open.push({ id: reservationId, amount: command.amount, state: "held" });
    return;
  }
  if (command.type === "settle") {
    const target = open.find((item) => item.state === "held" || item.state === "unknown");
    if (!target) return;
    const actual = scaled(target.amount, command.actualBps);
    const settled = repo.settleReservation({
      reservationId: target.id,
      actualUnits: actual,
      now: sequence,
    });
    if (!settled.ok) throw new Error(`settle ${target.id} was rejected while ${target.state}`);
    remove(open, target.id);
    return;
  }
  if (command.type === "release") {
    const target = open.find((item) => item.state === "held");
    if (!target) return;
    const released = repo.releaseReservation(target.id);
    if (!released.ok) throw new Error(`release ${target.id} was rejected while held`);
    remove(open, target.id);
    return;
  }
  if (command.type === "unknown") {
    const target = open.find((item) => item.state === "held");
    if (!target) return;
    const marked = repo.markReservationUnknown(target.id);
    if (!marked.ok) throw new Error(`mark unknown ${target.id} was rejected while held`);
    target.state = "unknown";
    return;
  }
  if (command.type === "reconcile") {
    const target = open.find((item) => item.state === "unknown");
    if (!target) return;
    if (command.resolution === "release") {
      const released = repo.reconcileUnknownReservation({
        reservationId: target.id,
        resolution: "release",
        now: sequence,
      });
      if (!released.ok) throw new Error(`reconcile release ${target.id} failed`);
    } else {
      const settled = repo.reconcileUnknownReservation({
        reservationId: target.id,
        resolution: "settle",
        actualUnits: scaled(target.amount, command.actualBps),
        now: sequence,
      });
      if (!settled.ok) throw new Error(`reconcile settle ${target.id} failed`);
    }
    remove(open, target.id);
    return;
  }
  const scope = scopeRef(command.scope);
  const current = repo.getBudgetRemaining(scope.scopeKind, scope.scopeId)[0];
  if (!current) throw new Error(`missing ${command.scope} budget`);
  repo.raiseBudgetLimit(scope.scopeKind, scope.scopeId, "usd", current.limitUnits + command.delta);
}

function scaled(amount: number, bps: number): number {
  return Number((BigInt(amount) * BigInt(bps)) / 10_000n);
}

function remove(open: OpenReservation[], id: string): void {
  const index = open.findIndex((item) => item.id === id);
  if (index >= 0) open.splice(index, 1);
}

function scopeRef(scope: "project" | "feature" | "task" | "grant"): { scopeKind: ScopeKind; scopeId: string } {
  if (scope === "project") return { scopeKind: "project", scopeId: "P" };
  if (scope === "feature") return { scopeKind: "feature", scopeId: "F" };
  if (scope === "task") return { scopeKind: "task", scopeId: "T" };
  return { scopeKind: "grant", scopeId: "G" };
}
