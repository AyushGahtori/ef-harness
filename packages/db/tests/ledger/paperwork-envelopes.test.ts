import { afterEach, describe, expect, it } from "vitest";
import { CrossWaveBorrowError, ScopeBindingError } from "../../src/ledger/index.js";
import { createTestLedger } from "./support.js";

const open: { db: { close(): void } }[] = [];

afterEach(() => {
  for (const item of open) item.db.close();
  open.length = 0;
});

describe("wave paperwork envelopes", () => {
  it("splits the 20% cap into phase envelopes per wave and isolates coding spend", () => {
    const created = createTestLedger();
    open.push(created);
    const { repo } = created;
    repo.createBudgetScope({
      scopeKind: "project",
      scopeId: "P",
      currency: "usd",
      limitUnits: 1_000_000,
    });
    repo.createBudgetScope({
      scopeKind: "task",
      scopeId: "T",
      currency: "usd",
      limitUnits: 1_000_000,
      parentKind: "project",
      parentId: "P",
    });
    const envelopes = repo.createWavePaperworkEnvelopes({
      projectScopeId: "P",
      currency: "usd",
      upfrontWeight: 1,
      waves: [
        { waveId: "w1", weight: 1 },
        { waveId: "w3", weight: 1 },
      ],
    });
    const limitFor = (waveId: string, phase: string) =>
      envelopes.find((envelope) => envelope.waveId === waveId && envelope.phase === phase)?.limitUnits;
    expect(limitFor("upfront", "spec")).toBe(10_000);
    expect(limitFor("w1", "spec")).toBe(10_000);
    expect(limitFor("w3", "spec")).toBe(10_000);
    const specTotal = ["upfront", "w1", "w3"].reduce((sum, waveId) => sum + (limitFor(waveId, "spec") ?? 0), 0);
    const researchTotal = ["upfront", "w1", "w3"].reduce(
      (sum, waveId) => sum + (limitFor(waveId, "research") ?? 0),
      0,
    );
    const architectureTotal = ["upfront", "w1", "w3"].reduce(
      (sum, waveId) => sum + (limitFor(waveId, "architecture") ?? 0),
      0,
    );
    const planningTotal = ["upfront", "w1", "w3"].reduce(
      (sum, waveId) => sum + (limitFor(waveId, "planning") ?? 0),
      0,
    );
    const auditTotal = ["upfront", "w1", "w3"].reduce(
      (sum, waveId) => sum + (limitFor(waveId, "audit") ?? 0),
      0,
    );
    expect(specTotal).toBe(30_000);
    expect(researchTotal).toBe(50_000);
    expect(architectureTotal).toBe(60_000);
    expect(planningTotal).toBe(40_000);
    expect(auditTotal).toBe(20_000);
    expect(specTotal + researchTotal + architectureTotal + planningTotal + auditTotal).toBe(200_000);

    const wave3Planning = envelopes.find((envelope) => envelope.waveId === "w3" && envelope.phase === "planning");
    expect(wave3Planning).toBeDefined();
    if (!wave3Planning) return;
    expect(() =>
      repo.reserveAcrossScopes({
        reservationId: "retry",
        purpose: "model_call",
        currency: "usd",
        amountUnits: 100,
        scopeKind: "task",
        scopeId: "T",
        additionalScopes: [{ scopeKind: "wave_paperwork", scopeId: wave3Planning.scopeId }],
        createdAt: 1,
      }),
    ).toThrow(ScopeBindingError);

    const coding = repo.reserveAcrossScopes({
      reservationId: "code",
      purpose: "model_call",
      currency: "usd",
      amountUnits: 100,
      scopeKind: "task",
      scopeId: "T",
      createdAt: 2,
    });
    expect(coding.ok).toBe(true);
    expect(repo.getBudgetRemaining("wave_paperwork", wave3Planning.scopeId)[0]?.reservedUnits).toBe(0);

    const wave1Planning = envelopes.find((envelope) => envelope.waveId === "w1" && envelope.phase === "planning");
    expect(wave1Planning).toBeDefined();
    if (!wave1Planning) return;
    const paperwork = repo.reserveAcrossScopes({
      reservationId: "plan",
      purpose: "paperwork",
      currency: "usd",
      amountUnits: 100,
      scopeKind: "wave_paperwork",
      scopeId: wave1Planning.scopeId,
      activeWaveId: "w1",
      createdAt: 3,
    });
    expect(paperwork.ok).toBe(true);
    expect(repo.getBudgetRemaining("wave_paperwork", wave1Planning.scopeId)[0]?.reservedUnits).toBe(100);
    expect(repo.getBudgetRemaining("project", "P")[0]?.reservedUnits).toBe(200);

    expect(() =>
      repo.reserveAcrossScopes({
        reservationId: "borrow",
        purpose: "paperwork",
        currency: "usd",
        amountUnits: 50,
        scopeKind: "wave_paperwork",
        scopeId: wave3Planning.scopeId,
        activeWaveId: "w1",
        createdAt: 4,
      }),
    ).toThrow(CrossWaveBorrowError);
    expect(repo.getBudgetRemaining("wave_paperwork", wave3Planning.scopeId)[0]?.reservedUnits).toBe(0);

    const approved = repo.reserveAcrossScopes({
      reservationId: "borrow-ok",
      purpose: "paperwork",
      currency: "usd",
      amountUnits: 50,
      scopeKind: "wave_paperwork",
      scopeId: wave3Planning.scopeId,
      activeWaveId: "w1",
      crossWaveBorrowApproved: true,
      createdAt: 5,
    });
    expect(approved.ok).toBe(true);
    expect(repo.getBudgetRemaining("wave_paperwork", wave3Planning.scopeId)[0]?.reservedUnits).toBe(50);

    repo.releaseReservation("plan");
    const rolled = repo.rollForwardUnusedPaperwork({
      fromWaveId: "w1",
      toWaveId: "w3",
      currency: "usd",
    });
    const planningMove = rolled.find((row) => row.phase === "planning");
    expect(planningMove?.movedUnits).toBe(wave1Planning.limitUnits);
    expect(repo.getBudgetRemaining("wave_paperwork", wave1Planning.scopeId)[0]?.limitUnits).toBe(0);
    expect(repo.getBudgetRemaining("wave_paperwork", wave3Planning.scopeId)[0]?.limitUnits).toBe(
      wave3Planning.limitUnits + wave1Planning.limitUnits,
    );
    expect(repo.auditConservation().ok).toBe(true);
  });
});
