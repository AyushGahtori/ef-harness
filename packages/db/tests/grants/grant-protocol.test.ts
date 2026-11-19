import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AttachedDatabaseForbiddenError,
  BrokerGrantIssuer,
  ClosureConflictError,
  GrantsHeldForRecoveryError,
  GrantReconciler,
  InsufficientWindowHeadroomError,
  NonIntegerUnitsError,
  ProjectGrantReceiver,
  ProjectSafeModeError,
  UnknownReconciliationError,
  WrongDatabaseRoleError,
  installCrossDatabaseAttachGuard,
  loadQueryCatalog,
  openGrantDatabasePair,
  type GrantClosureReport,
  type GrantDatabasePair,
  type GrantMessageSink,
  type GrantProtocolMessage,
  type GrantSqlSession,
  type IssueGrantInput,
} from "../../src/grants/index.js";

class RecordingSink implements GrantMessageSink {
  readonly messages: GrantProtocolMessage[] = [];
  deliver(message: GrantProtocolMessage): void {
    this.messages.push(message);
  }
}

let directory: string | undefined;
let pair: GrantDatabasePair | undefined;

function files(): GrantDatabasePair {
  if (!pair) {
    throw new Error("grant databases were not opened");
  }
  return pair;
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef-grant-024-"));
  pair = openGrantDatabasePair(directory);
});

afterEach(() => {
  pair?.close();
  pair = undefined;
  if (directory) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  directory = undefined;
});

describe("cross-database grant protocol", () => {
  it("runs issue, deposit, ack, reserve, settle, close, and report on separate files", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    const seen = { issuedWhileStateEmpty: false, ackWhileBrokerIssued: false };
    sink.deliver = (message) => {
      sink.messages.push(message);
      if (message.type === "GrantIssued") {
        seen.issuedWhileStateEmpty = count(databases.state, "grant_receipts") === 0;
        expect(count(databases.global, "grants")).toBe(1);
      }
      if (message.type === "GrantDepositedAck") {
        seen.ackWhileBrokerIssued = grantState(databases.global, "grant-1") === "issued";
        expect(count(databases.state, "grant_receipts")).toBe(1);
      }
    };

    const issued = await issuer.issueGrant(grantInput());
    await receiver.depositGrant(issued);
    const ack = issuer.acknowledgeDeposit(issued.grantId);
    reserve(databases.state, { id: "res-1", grantId: issued.grantId, amount: 200, now: 1_500 });
    settle(databases.state, { id: "res-1", actual: 200, now: 1_600 });
    const closed = await receiver.closeGrant(issued.grantId, 1_700, "expired");
    expect(closed.status).toBe("reported");
    if (closed.status !== "reported") {
      return;
    }
    const recorded = issuer.recordClosure(closed.report, 1_800);
    const replay = issuer.recordClosure(closed.report, 1_900);
    receiver.markClosureReported(issued.grantId, recorded.recordedAt);

    expect(seen.issuedWhileStateEmpty).toBe(true);
    expect(seen.ackWhileBrokerIssued).toBe(true);
    expect(ack).toEqual({ grantId: "grant-1", state: "deposited", changed: true });
    expect(issuer.acknowledgeDeposit(issued.grantId).changed).toBe(false);
    expect(recorded.unusedUnitsReturned).toBe(800);
    expect(replay.idempotent).toBe(true);
    expect(replay.unusedUnitsReturned).toBe(0);
    expect(estimated(databases.global, "conn-a")).toBe(200);
    expect(grantState(databases.global, "grant-1")).toBe("closed");
    expect(integer(databases.global, "SELECT used_units AS n FROM grants WHERE id = 'grant-1'")).toBe(200);
    expect(integer(databases.global, "SELECT unknown_units AS n FROM grants WHERE id = 'grant-1'")).toBe(0);
    expect(integer(databases.state, "SELECT closure_reported_at AS n FROM grant_receipts WHERE grant_id = 'grant-1'")).toBe(
      1_800,
    );
    expect(count(databases.state, "grant_receipts")).toBe(1);
    expect(databases.global.filePath).not.toBe(databases.state.filePath);
    expect(fs.existsSync(databases.global.filePath)).toBe(true);
    expect(fs.existsSync(databases.state.filePath)).toBe(true);
    expect(integer(databases.global, "SELECT count(*) AS n FROM pragma_database_list")).toBe(1);
    expect(integer(databases.state, "SELECT count(*) AS n FROM pragma_database_list")).toBe(1);
    expect(sink.messages.map((message) => message.type)).toEqual([
      "GrantIssued",
      "GrantDepositedAck",
      "GrantClosureReport",
    ]);
  });

  it("keeps one receipt and the original limit when the issued message is delivered three times", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 2_000_000 });
    const issued = await issuer.issueGrant(grantInput({ units: 500_000 }));
    await receiver.depositGrant(issued);
    await receiver.depositGrant(issued);
    await receiver.depositGrant(issued);
    expect(count(databases.state, "grant_receipts")).toBe(1);
    expect(count(databases.state, "budgets")).toBe(1);
    expect(
      integer(
        databases.state,
        "SELECT limit_units AS n FROM budgets WHERE scope_kind = 'grant' AND scope_id = 'grant-1'",
      ),
    ).toBe(500_000);
  });

  it("recovers a crash before deposit by returning unused capacity and acknowledging real deposits", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    const reconciler = new GrantReconciler(issuer, receiver, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    const deposited = await issuer.issueGrant(grantInput({ grantId: "kept", units: 1_000 }));
    await issuer.issueGrant(grantInput({ grantId: "lost", units: 700 }));
    await receiver.depositGrant(deposited);
    const first = reconciler.recoverUndepositedGrants(receiver.listDepositedGrantIds(), 2_000);
    const second = reconciler.recoverUndepositedGrants(receiver.listDepositedGrantIds(), 2_100);
    expect(first.released).toEqual([{ grantId: "lost", unitsReturned: 700, state: "expired" }]);
    expect(first.acknowledged.find((item) => item.grantId === "kept")?.state).toBe("deposited");
    expect(second.released).toEqual([]);
    expect(estimated(databases.global, "conn-a")).toBe(1_000);
    expect(grantState(databases.global, "lost")).toBe("expired");
    expect(integer(databases.global, "SELECT used_units AS n FROM grants WHERE id = 'lost'")).toBe(0);
    expect(count(databases.state, "grant_receipts")).toBe(1);
  });

  it("returns capacity when a never-deposited grant was already expired conservatively", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    const reconciler = new GrantReconciler(issuer, receiver, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    await issuer.issueGrant(grantInput({ grantId: "ghost", units: 900, expiresAt: 1_200 }));
    const expired = issuer.expireUnreportedGrants(2_000, 60);
    expect(expired).toEqual([
      {
        grantId: "ghost",
        projectId: "project-a",
        connectionId: "conn-a",
        units: 900,
        usedUnits: 900,
      },
    ]);
    expect(estimated(databases.global, "conn-a")).toBe(900);
    const recovered = reconciler.recoverUndepositedGrants([], 2_100);
    expect(recovered.released).toEqual([{ grantId: "ghost", unitsReturned: 900, state: "expired" }]);
    expect(estimated(databases.global, "conn-a")).toBe(0);
    expect(reconciler.recoverUndepositedGrants([], 2_200).released).toEqual([]);
    expect(estimated(databases.global, "conn-a")).toBe(0);
  });

  it("re-sends a closure that was committed locally before the broker ack", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    const reconciler = new GrantReconciler(issuer, receiver, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    const issued = await issuer.issueGrant(grantInput({ units: 1_000 }));
    await receiver.depositGrant(issued);
    issuer.acknowledgeDeposit(issued.grantId);
    reserve(databases.state, { id: "res-1", grantId: issued.grantId, amount: 250, now: 1_400 });
    settle(databases.state, { id: "res-1", actual: 250, now: 1_450 });
    const closed = await receiver.closeGrant(issued.grantId, 1_500, "nearing_expiry");
    expect(closed.status).toBe("reported");
    expect(grantState(databases.global, issued.grantId)).toBe("deposited");
    expect(integer(databases.state, "SELECT closure_reported_at AS n FROM grant_receipts WHERE grant_id = 'grant-1'")).toBeNull();
    const first = reconciler.resendUnreportedClosures(1_600);
    const estimatedAfter = estimated(databases.global, "conn-a");
    const second = reconciler.resendUnreportedClosures(1_700);
    expect(first).toHaveLength(1);
    expect(first[0]?.usedUnits).toBe(250);
    expect(first[0]?.unknownUnits).toBe(0);
    expect(first[0]?.unusedUnitsReturned).toBe(750);
    expect(second).toEqual([]);
    expect(estimated(databases.global, "conn-a")).toBe(estimatedAfter);
    expect(estimatedAfter).toBe(250);
    expect(grantState(databases.global, issued.grantId)).toBe("closed");
    expect(
      integer(databases.state, "SELECT closure_reported_at AS n FROM grant_receipts WHERE grant_id = 'grant-1'"),
    ).toBe(1_600);
  });

  it("counts a vanished project grant as fully used and lets another project continue", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-b");
    const reconciler = new GrantReconciler(issuer, null, "project-a");
    seedProject(databases, { projectId: "project-b", limit: 2_000 });
    databases.global.runImmediate(() => {
      seedProjectRow(databases.global, "project-a");
    });
    await issuer.issueGrant(
      grantInput({ grantId: "gone", projectId: "project-a", units: 800, expiresAt: 1_500 }),
    );
    const living = await issuer.issueGrant(
      grantInput({ grantId: "live", projectId: "project-b", units: 800, expiresAt: 50_000 }),
    );
    await receiver.depositGrant(living);
    const expired = reconciler.expireVanishedProjectGrants(1_600, 60);
    expect(expired.map((grant) => grant.grantId)).toEqual(["gone"]);
    expect(integer(databases.global, "SELECT used_units AS n FROM grants WHERE id = 'gone'")).toBe(800);
    expect(estimated(databases.global, "conn-a")).toBe(1_600);
    expect(reconciler.expireVanishedProjectGrants(1_700, 60)).toEqual([]);
    const more = await issuer.issueGrant(
      grantInput({ grantId: "more", projectId: "project-b", units: 400, expiresAt: 50_000 }),
    );
    expect(more.grantId).toBe("more");
    expect(estimated(databases.global, "conn-a")).toBe(2_000);
    await expect(
      issuer.issueGrant(grantInput({ grantId: "overflow", projectId: "project-b", units: 1, expiresAt: 50_000 })),
    ).rejects.toBeInstanceOf(InsufficientWindowHeadroomError);
    expect(count(databases.global, "grants")).toBe(3);
  });

  it("holds unknown units as spent until a late reconciliation, and never below known spend", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    const reconciler = new GrantReconciler(issuer, receiver, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    const issued = await issuer.issueGrant(grantInput({ units: 1_000 }));
    await receiver.depositGrant(issued);
    issuer.acknowledgeDeposit(issued.grantId);
    reserve(databases.state, { id: "unknown-call", grantId: issued.grantId, amount: 80, now: 1_400 });
    databases.state.runImmediate(() => {
      expect(
        databases.state.run(
          "UPDATE reservations SET state = 'unknown' WHERE id = ? AND state = 'held'",
          "unknown-call",
        ),
      ).toBe(1);
    });
    const closed = await receiver.closeGrant(issued.grantId, 1_500, "expired");
    expect(closed.status).toBe("reported");
    if (closed.status !== "reported") {
      return;
    }
    expect(closed.report.unknownUnits).toBe(80);
    expect(closed.report.usedUnits).toBe(0);
    issuer.recordClosure(closed.report, 1_600);
    receiver.markClosureReported(issued.grantId, 1_600);
    expect(estimated(databases.global, "conn-a")).toBe(80);
    const reconciled = reconciler.reconcileUnknownPaidCall({
      type: "GrantUnknownReconciled",
      grantId: issued.grantId,
      usedUnits: 30,
      unknownUnits: 0,
    });
    expect(reconciled.windowDelta).toBe(-50);
    expect(estimated(databases.global, "conn-a")).toBe(30);
    expect(integer(databases.state, "SELECT used_units AS n FROM grant_receipts WHERE grant_id = 'grant-1'")).toBe(30);
    const replay = reconciler.reconcileUnknownPaidCall({
      type: "GrantUnknownReconciled",
      grantId: issued.grantId,
      usedUnits: 30,
      unknownUnits: 0,
    });
    expect(replay.idempotent).toBe(true);
    expect(estimated(databases.global, "conn-a")).toBe(30);
    expect(() =>
      reconciler.reconcileUnknownPaidCall({
        type: "GrantUnknownReconciled",
        grantId: issued.grantId,
        usedUnits: 10,
        unknownUnits: 0,
      }),
    ).toThrow(UnknownReconciliationError);
    expect(estimated(databases.global, "conn-a")).toBe(30);
  });

  it("adjusts a conservative expiry downward when the late closure reports less than the whole grant", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    const issued = await issuer.issueGrant(grantInput({ units: 1_000, expiresAt: 1_200 }));
    await receiver.depositGrant(issued);
    issuer.acknowledgeDeposit(issued.grantId);
    expect(issuer.expireUnreportedGrants(1_260, 60)).toHaveLength(0);
    expect(issuer.expireUnreportedGrants(1_261, 60)).toHaveLength(1);
    expect(estimated(databases.global, "conn-a")).toBe(1_000);
    expect(integer(databases.global, "SELECT used_units AS n FROM grants WHERE id = 'grant-1'")).toBe(1_000);
    reserve(databases.state, { id: "res-1", grantId: issued.grantId, amount: 250, now: 1_100 });
    settle(databases.state, { id: "res-1", actual: 250, now: 1_150 });
    const closed = await receiver.closeGrant(issued.grantId, 1_300, "expired");
    if (closed.status !== "reported") {
      throw new Error("expected a closure report");
    }
    const recorded = issuer.recordClosure(closed.report, 1_400);
    expect(recorded.usedUnits).toBe(250);
    expect(recorded.unusedUnitsReturned).toBe(750);
    expect(estimated(databases.global, "conn-a")).toBe(250);
    expect(grantState(databases.global, issued.grantId)).toBe("closed");
    expect(issuer.recordClosure(closed.report, 1_500).idempotent).toBe(true);
    expect(estimated(databases.global, "conn-a")).toBe(250);
    expect(() => issuer.recordClosure({ ...closed.report, usedUnits: 100 }, 1_600)).toThrow(ClosureConflictError);
    expect(estimated(databases.global, "conn-a")).toBe(250);
  });

  it("records an overrun above the granted units and leaves the shared window with no headroom", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 1_500 });
    const issued = await issuer.issueGrant(grantInput({ units: 1_000 }));
    await receiver.depositGrant(issued);
    issuer.acknowledgeDeposit(issued.grantId);
    reserve(databases.state, { id: "res-1", grantId: issued.grantId, amount: 200, now: 1_400 });
    settle(databases.state, { id: "res-1", actual: 1_800, now: 1_450 });
    const closed = await receiver.closeGrant(issued.grantId, 1_500, "recalled");
    if (closed.status !== "reported") {
      throw new Error("expected a closure report");
    }
    expect(closed.report.usedUnits).toBe(1_800);
    const recorded = issuer.recordClosure(closed.report, 1_600);
    expect(recorded.unusedUnitsReturned).toBe(0);
    expect(estimated(databases.global, "conn-a")).toBe(1_800);
    expect(Math.max(0, 1_500 - estimated(databases.global, "conn-a"))).toBe(0);
    expect(integer(databases.global, "SELECT used_units AS n FROM grants WHERE id = 'grant-1'")).toBe(1_800);
  });

  it("waits to report while a held reservation is open and includes unknown units", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    const issued = await issuer.issueGrant(grantInput({ units: 1_000 }));
    await receiver.depositGrant(issued);
    issuer.acknowledgeDeposit(issued.grantId);
    reserve(databases.state, { id: "held-call", grantId: issued.grantId, amount: 100, now: 1_400 });
    reserve(databases.state, { id: "unknown-call", grantId: issued.grantId, amount: 40, now: 1_410 });
    databases.state.runImmediate(() => {
      databases.state.run("UPDATE reservations SET state = 'unknown' WHERE id = ?", "unknown-call");
    });
    const waiting = await receiver.closeGrant(issued.grantId, 1_500, "recalled");
    expect(waiting).toEqual({ status: "waiting_for_held", grantId: issued.grantId, heldCount: 1 });
    expect(sink.messages.some((message) => message.type === "GrantClosureReport")).toBe(false);
    expect(integer(databases.state, "SELECT closed AS n FROM budgets WHERE scope_kind = 'grant' AND scope_id = 'grant-1'")).toBe(1);
    expect(integer(databases.state, "SELECT limit_units AS n FROM budgets WHERE scope_kind = 'grant' AND scope_id = 'grant-1'")).toBe(140);
    expect(integer(databases.state, "SELECT closed_at AS n FROM grant_receipts WHERE grant_id = 'grant-1'")).toBeNull();
    expect(() => reserve(databases.state, { id: "too-late", grantId: issued.grantId, amount: 1, now: 1_520 })).toThrow(
      /reserve changes 0/,
    );
    settle(databases.state, { id: "held-call", actual: 100, now: 1_530 });
    const closed = await receiver.closeGrant(issued.grantId, 1_540, "recalled");
    if (closed.status !== "reported") {
      throw new Error("expected a closure report");
    }
    expect(closed.report).toEqual({
      type: "GrantClosureReport",
      grantId: issued.grantId,
      usedUnits: 100,
      unknownUnits: 40,
    } satisfies GrantClosureReport);
    const recorded = issuer.recordClosure(closed.report, 1_550);
    expect(recorded.unusedUnitsReturned).toBe(860);
    expect(estimated(databases.global, "conn-a")).toBe(140);
  });

  it("accepts a closure that arrives before the deposit ack", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    const issued = await issuer.issueGrant(grantInput({ units: 1_000 }));
    await receiver.depositGrant(issued);
    reserve(databases.state, { id: "res-1", grantId: issued.grantId, amount: 100, now: 1_400 });
    settle(databases.state, { id: "res-1", actual: 100, now: 1_450 });
    const closed = await receiver.closeGrant(issued.grantId, 1_500, "recalled");
    if (closed.status !== "reported") {
      throw new Error("expected a closure report");
    }
    expect(grantState(databases.global, issued.grantId)).toBe("issued");
    const recorded = issuer.recordClosure(closed.report, 1_600);
    expect(recorded.usedUnits).toBe(100);
    expect(recorded.unusedUnitsReturned).toBe(900);
    expect(issuer.acknowledgeDeposit(issued.grantId)).toEqual({
      grantId: issued.grantId,
      state: "closed",
      changed: false,
    });
    expect(estimated(databases.global, "conn-a")).toBe(100);
  });

  it("inserts a missing allowance currency inside the deposit transaction", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    seedProject(databases, {
      projectId: "project-a",
      connectionId: "plan-1",
      currency: "allowance:plan-1",
      scale: 1_000_000,
      limit: 1_000_000,
    });
    expect(
      countWhere(databases.state, "currencies", "code = ?", "allowance:plan-1"),
    ).toBe(0);
    const issued = await issuer.issueGrant(
      grantInput({
        connectionId: "plan-1",
        currency: "allowance:plan-1",
        units: 25_000,
      }),
    );
    await receiver.depositGrant(issued);
    const currency = databases.state.get(
      "SELECT unit, scale FROM currencies WHERE code = ?",
      "allowance:plan-1",
    );
    expect(currency).toEqual({ unit: "ppm of window share", scale: 1_000_000 });
    expect(count(databases.state, "grant_receipts")).toBe(1);
    expect(count(databases.state, "budgets")).toBe(1);
  });

  it("holds new grants while recovery is waiting on an in-flight reservation", async () => {
    const databases = files();
    const sink = new RecordingSink();
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    const reconciler = new GrantReconciler(issuer, receiver, "project-a");
    seedProject(databases, { projectId: "project-a", limit: 5_000 });
    const issued = await issuer.issueGrant(grantInput({ units: 1_000, expiresAt: 1_500 }));
    await receiver.depositGrant(issued);
    issuer.acknowledgeDeposit(issued.grantId);
    reserve(databases.state, { id: "held-call", grantId: issued.grantId, amount: 100, now: 1_200 });
    const paused = await reconciler.recoverProjectRestart(2_000);
    expect(paused.readyForNewGrants).toBe(false);
    expect(paused.closed[0]?.status).toBe("waiting_for_held");
    await expect(issuer.issueGrant(grantInput({ grantId: "next", expiresAt: 9_000 }))).rejects.toBeInstanceOf(
      GrantsHeldForRecoveryError,
    );
    settle(databases.state, { id: "held-call", actual: 100, now: 2_100 });
    const resumed = await reconciler.continueRecovery(2_200);
    expect(resumed.readyForNewGrants).toBe(true);
    expect(resumed.recorded[0]?.usedUnits).toBe(100);
    expect(estimated(databases.global, "conn-a")).toBe(100);
    const next = await issuer.issueGrant(grantInput({ grantId: "next", expiresAt: 9_000, units: 50 }));
    expect(next.grantId).toBe("next");
  });

  it("rejects ATTACH, the wrong database role, unsafe units, and a window without headroom", async () => {
    const databases = files();
    const sink = new RecordingSink();
    expect(() => new BrokerGrantIssuer(databases.state, sink)).toThrow(WrongDatabaseRoleError);
    expect(() => new ProjectGrantReceiver(databases.global, sink, "project-a")).toThrow(WrongDatabaseRoleError);
    expect(() => databases.global.run("ATTACH DATABASE ':memory:' AS other")).toThrow(AttachedDatabaseForbiddenError);
    expect(integer(databases.global, "SELECT count(*) AS n FROM pragma_database_list")).toBe(1);
    const probe = new DatabaseSync(":memory:");
    installCrossDatabaseAttachGuard(probe);
    expect(() => probe.exec("ATTACH DATABASE ':memory:' AS other")).toThrow(/not authorized|too many attached/i);
    probe.close();
    seedProject(databases, { projectId: "project-a", limit: 100 });
    const issuer = new BrokerGrantIssuer(databases.global, sink);
    await expect(issuer.issueGrant(grantInput({ units: 1.5 }))).rejects.toBeInstanceOf(NonIntegerUnitsError);
    await expect(issuer.issueGrant(grantInput({ units: 101 }))).rejects.toBeInstanceOf(
      InsufficientWindowHeadroomError,
    );
    expect(count(databases.global, "grants")).toBe(0);
    expect(estimated(databases.global, "conn-a")).toBe(0);
    databases.state.runImmediate(() => {
      databases.state.run("INSERT INTO meta(key, value) VALUES ('safe_mode', '1')");
    });
    const receiver = new ProjectGrantReceiver(databases.state, sink, "project-a");
    const issued = await issuer.issueGrant(grantInput({ units: 40 }));
    await expect(receiver.depositGrant(issued)).rejects.toBeInstanceOf(ProjectSafeModeError);
    expect(count(databases.state, "grant_receipts")).toBe(0);
  });

  it("loads the five grant statements from schema/queries.sql", () => {
    const catalog = loadQueryCatalog();
    expect(catalog.sql("deposit_grant")).toContain("INSERT OR IGNORE INTO grant_receipts");
    expect(catalog.sql("deposit_grant_budget")).toContain("INSERT OR IGNORE INTO budgets");
    expect(catalog.sql("close_grant")).toContain("limit_units = spent_units + reserved_units");
    expect(catalog.sql("close_grant_receipt")).toContain("unknown_units");
    expect(catalog.sql("global_expire_grants")).toContain("used_units = units");
    const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/grants");
    const receiver = fs.readFileSync(path.join(sourceDir, "project-grant-receiver.ts"), "utf8");
    const broker = fs.readFileSync(path.join(sourceDir, "broker-grant-issuer.ts"), "utf8");
    expect(receiver).not.toContain("INSERT OR IGNORE INTO grant_receipts");
    expect(receiver).not.toContain("INSERT OR IGNORE INTO budgets");
    expect(receiver).not.toContain("limit_units = spent_units + reserved_units");
    expect(broker).not.toContain("SET state = 'expired', used_units = units");
    expect(receiver).toContain('runNamed("deposit_grant"');
    expect(receiver).toContain('runNamed("deposit_grant_budget"');
    expect(receiver).toContain('runNamed("close_grant"');
    expect(receiver).toContain('runNamed("close_grant_receipt"');
    expect(broker).toContain('allNamed("global_expire_grants"');
  });
});

function grantInput(overrides: Partial<IssueGrantInput> = {}): IssueGrantInput {
  return {
    grantId: "grant-1",
    projectId: "project-a",
    connectionId: "conn-a",
    currency: "usd",
    units: 1_000,
    concurrency: 2,
    priorityClass: "foreground",
    issuedAt: 1_000,
    expiresAt: 20_000,
    ...overrides,
  };
}

function seedProject(
  databases: GrantDatabasePair,
  input: {
    projectId: string;
    connectionId?: string;
    currency?: string;
    scale?: number;
    limit: number;
  },
): void {
  const connectionId = input.connectionId ?? "conn-a";
  const currency = input.currency ?? "usd";
  const scale = input.scale ?? 1_000_000;
  databases.global.runImmediate(() => {
    seedProjectRow(databases.global, input.projectId);
    const existing = databases.global.get("SELECT id FROM connections WHERE id = ?", connectionId);
    if (!existing) {
      databases.global.run(
        `INSERT INTO connections (id, provider, route, plan, vault_ref, currency, scale, enabled, created_at)
         VALUES (?, 'openai', 'api_key', 'plus', NULL, ?, ?, 1, 1)`,
        connectionId,
        currency,
        scale,
      );
      databases.global.run(
        `INSERT INTO connection_windows (
           connection, window_kind, window_start, window_end, limit_units, observed_units,
           estimated_units, source, observed_at
         ) VALUES (?, 'weekly', 0, 100000, ?, NULL, 0, 'estimated', 0)`,
        connectionId,
        input.limit,
      );
    }
  });
  databases.state.runImmediate(() => {
    databases.state.run(
      "INSERT OR IGNORE INTO meta(key, value) VALUES ('project_id', ?), ('last_rev', '4')",
      input.projectId,
    );
  });
}

function seedProjectRow(globalDb: GrantSqlSession, projectId: string): void {
  globalDb.run(
    `INSERT OR IGNORE INTO projects (id, path, display_name, schema_version, status, last_opened_at, last_seen_at)
     VALUES (?, ?, ?, 1, 'ok', 0, 0)`,
    projectId,
    `C:/projects/${projectId}`,
    projectId,
  );
}

function reserve(
  state: GrantSqlSession,
  input: { id: string; grantId: string; amount: number; now: number },
): void {
  state.runImmediate(() => {
    state.run(
      `INSERT INTO reservations (id, attempt, purpose, currency, amount_units, state, created_at)
       VALUES (?, NULL, 'model_call', 'usd', ?, 'held', ?)`,
      input.id,
      input.amount,
      input.now,
    );
    state.run(
      `INSERT INTO reservation_scopes (reservation, scope_kind, scope_id, currency)
       VALUES (?, 'grant', ?, 'usd')`,
      input.id,
      input.grantId,
    );
    const changes = state.runNamed("reserve", { reservation: input.id, amount: input.amount });
    if (changes !== 1) {
      throw new Error(`reserve changes ${changes}`);
    }
  });
}

function settle(
  state: GrantSqlSession,
  input: { id: string; actual: number; now: number },
): void {
  state.runImmediate(() => {
    const budgetChanges = state.runNamed("settle", { reservation: input.id, actual: input.actual });
    const markChanges = state.runNamed("settle_mark", {
      reservation: input.id,
      actual: input.actual,
      now: input.now,
    });
    if (budgetChanges !== 1 || markChanges !== 1) {
      throw new Error(`settle changes ${budgetChanges}/${markChanges}`);
    }
  });
}

function count(session: GrantSqlSession, table: string): number {
  return integer(session, `SELECT count(*) AS n FROM ${table}`) ?? 0;
}

function countWhere(session: GrantSqlSession, table: string, clause: string, ...params: string[]): number {
  return integer(session, `SELECT count(*) AS n FROM ${table} WHERE ${clause}`, ...params) ?? 0;
}

function estimated(session: GrantSqlSession, connectionId: string): number {
  return (
    integer(session, "SELECT estimated_units AS n FROM connection_windows WHERE connection = ?", connectionId) ?? 0
  );
}

function grantState(session: GrantSqlSession, grantId: string): string {
  const row = session.get("SELECT state FROM grants WHERE id = ?", grantId);
  return typeof row?.state === "string" ? row.state : "";
}

function integer(session: GrantSqlSession, sql: string, ...params: Array<string | number>): number | null {
  const row = session.get(sql, ...params);
  const value = row?.n;
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return null;
}
