import {
  GrantNotClosedError,
  GrantNotFoundError,
  ProjectMismatchError,
  ProjectSafeModeError,
  UnsupportedCurrencyError,
  WrongDatabaseRoleError,
} from "./errors.js";
import {
  assertIdentifier,
  assertNonNegativeInteger,
  assertPositiveInteger,
  assertSafeInteger,
} from "./integers.js";
import type {
  CloseGrantResult,
  GrantCloseReason,
  GrantClosureReport,
  GrantDepositedAck,
  GrantIssuedMessage,
  GrantMessageSink,
  GrantUnknownReconciledMessage,
} from "./messages.js";
import { optionalInteger, requiredInteger, requiredText } from "./rows.js";
import { GrantSqlSession } from "./session.js";

interface CurrencySeed {
  readonly unit: string;
  readonly scale: number;
}

export class ProjectGrantReceiver {
  readonly projectId: string;
  private readonly state: GrantSqlSession;
  private readonly sink: GrantMessageSink;

  constructor(stateDb: GrantSqlSession, sink: GrantMessageSink, projectId: string) {
    if (stateDb.role !== "state") {
      throw new WrongDatabaseRoleError("state", stateDb.role);
    }
    assertIdentifier(projectId, "projectId");
    this.state = stateDb;
    this.sink = sink;
    this.projectId = projectId;
  }

  get filePath(): string {
    return this.state.filePath;
  }

  async depositGrant(message: GrantIssuedMessage): Promise<GrantDepositedAck> {
    this.assertIssuedMessage(message);
    this.state.runImmediate(() => {
      this.assertProjectWritable(message.projectId);
      const seed = currencySeed(message.currency);
      this.state.run(
        "INSERT OR IGNORE INTO currencies(code, unit, scale) VALUES (?, ?, ?)",
        message.currency,
        seed.unit,
        seed.scale,
      );
      const rev = this.lastRev();
      this.state.runNamed("deposit_grant", {
        grant_id: message.grantId,
        connection: message.connectionId,
        currency: message.currency,
        units: message.units,
        concurrency: message.concurrency,
        expires_at: message.expiresAt,
        rev,
      });
      this.state.runNamed("deposit_grant_budget", {
        grant_id: message.grantId,
        currency: message.currency,
        units: message.units,
      });
    });
    const ack: GrantDepositedAck = { type: "GrantDepositedAck", grantId: message.grantId };
    await this.deliver(ack);
    return ack;
  }

  async closeGrant(grantId: string, now: number, reason: GrantCloseReason): Promise<CloseGrantResult> {
    assertIdentifier(grantId, "grantId");
    assertSafeInteger(now, "now");
    if (reason !== "expired" && reason !== "nearing_expiry" && reason !== "recalled") {
      throw new GrantNotFoundError(grantId);
    }
    const outcome = this.state.runImmediate(() => this.closeInside(grantId, now));
    if (outcome.status === "reported") {
      await this.deliver(outcome.report);
    }
    return outcome;
  }

  markClosureReported(grantId: string, reportedAt: number): void {
    assertIdentifier(grantId, "grantId");
    assertSafeInteger(reportedAt, "reportedAt");
    this.state.runImmediate(() => {
      this.assertProjectWritable(this.projectId);
      const receipt = this.receipt(grantId);
      if (!receipt) {
        throw new GrantNotFoundError(grantId);
      }
      if (receipt.closedAt === null) {
        throw new GrantNotClosedError(grantId);
      }
      this.state.run(
        `UPDATE grant_receipts
            SET closure_reported_at = ?
          WHERE grant_id = ? AND closed_at IS NOT NULL AND closure_reported_at IS NULL`,
        reportedAt,
        grantId,
      );
    });
  }

  recordUnknownReconciliation(message: GrantUnknownReconciledMessage): void {
    assertIdentifier(message.grantId, "grantId");
    assertNonNegativeInteger(message.usedUnits, "usedUnits");
    assertNonNegativeInteger(message.unknownUnits, "unknownUnits");
    this.state.runImmediate(() => {
      this.assertProjectWritable(this.projectId);
      const receipt = this.receipt(message.grantId);
      if (!receipt) {
        throw new GrantNotFoundError(message.grantId);
      }
      if (receipt.closedAt === null) {
        throw new GrantNotClosedError(message.grantId);
      }
      this.state.run(
        `UPDATE grant_receipts
            SET used_units = ?, unknown_units = ?
          WHERE grant_id = ? AND closed_at IS NOT NULL`,
        message.usedUnits,
        message.unknownUnits,
        message.grantId,
      );
    });
  }

  listDepositedGrantIds(): string[] {
    return this.state
      .all("SELECT grant_id FROM grant_receipts ORDER BY grant_id")
      .map((row) => requiredText(row, "grant_id"));
  }

  grantsNeedingClosure(now: number): string[] {
    assertSafeInteger(now, "now");
    return this.state
      .all(
        `SELECT grant_id
           FROM grant_receipts
          WHERE closure_reported_at IS NULL
            AND (
              closed_at IS NOT NULL
              OR expires_at <= ?
              OR EXISTS (
                SELECT 1 FROM budgets b
                 WHERE b.scope_kind = 'grant'
                   AND b.scope_id = grant_receipts.grant_id
                   AND b.closed = 1
              )
            )
          ORDER BY grant_id`,
        now,
      )
      .map((row) => requiredText(row, "grant_id"));
  }

  unreportedClosures(): GrantClosureReport[] {
    return this.state
      .all(
        `SELECT grant_id, used_units, unknown_units
           FROM grant_receipts
          WHERE closed_at IS NOT NULL AND closure_reported_at IS NULL
          ORDER BY grant_id`,
      )
      .map((row) => ({
        type: "GrantClosureReport" as const,
        grantId: requiredText(row, "grant_id"),
        usedUnits: requiredInteger(row, "used_units"),
        unknownUnits: requiredInteger(row, "unknown_units"),
      }));
  }

  private closeInside(grantId: string, now: number): CloseGrantResult {
    this.assertProjectWritable(this.projectId);
    const existing = this.receipt(grantId);
    if (!existing) {
      throw new GrantNotFoundError(grantId);
    }
    if (existing.reportedAt !== null) {
      return { status: "already_reported", grantId };
    }
    this.state.runNamed("close_grant", { grant_id: grantId });
    const heldCount = this.heldCount(grantId);
    if (heldCount > 0) {
      return { status: "waiting_for_held", grantId, heldCount };
    }
    if (existing.closedAt === null) {
      this.state.runNamed("close_grant_receipt", { grant_id: grantId, now });
    }
    const closed = this.receipt(grantId);
    if (!closed || closed.closedAt === null || closed.usedUnits === null || closed.unknownUnits === null) {
      throw new GrantNotClosedError(grantId);
    }
    return {
      status: "reported",
      grantId,
      report: {
        type: "GrantClosureReport",
        grantId,
        usedUnits: closed.usedUnits,
        unknownUnits: closed.unknownUnits,
      },
    };
  }

  private receipt(grantId: string): {
    closedAt: number | null;
    reportedAt: number | null;
    usedUnits: number | null;
    unknownUnits: number | null;
  } | null {
    const row = this.state.get(
      `SELECT closed_at, closure_reported_at, used_units, unknown_units
         FROM grant_receipts WHERE grant_id = ?`,
      grantId,
    );
    if (!row) {
      return null;
    }
    return {
      closedAt: optionalInteger(row, "closed_at"),
      reportedAt: optionalInteger(row, "closure_reported_at"),
      usedUnits: optionalInteger(row, "used_units"),
      unknownUnits: optionalInteger(row, "unknown_units"),
    };
  }

  private heldCount(grantId: string): number {
    const row = this.state.get(
      `SELECT count(*) AS n
         FROM reservations r
         JOIN reservation_scopes s ON s.reservation = r.id
        WHERE s.scope_kind = 'grant' AND s.scope_id = ? AND r.state = 'held'`,
      grantId,
    );
    return row ? requiredInteger(row, "n") : 0;
  }

  private lastRev(): number {
    const row = this.state.get("SELECT value FROM meta WHERE key = 'last_rev'");
    if (!row) {
      return 0;
    }
    const text = requiredText(row, "value");
    if (!/^\d+$/.test(text)) {
      throw new UnsupportedCurrencyError(`last_rev:${text}`);
    }
    const rev = Number(text);
    assertNonNegativeInteger(rev, "last_rev");
    return rev;
  }

  private assertProjectWritable(messageProjectId: string): void {
    if (this.state.isSafeMode()) {
      throw new ProjectSafeModeError();
    }
    const row = this.state.get("SELECT value FROM meta WHERE key = 'project_id'");
    if (!row) {
      return;
    }
    const owner = requiredText(row, "value");
    if (owner !== messageProjectId) {
      throw new ProjectMismatchError(owner, messageProjectId);
    }
  }

  private assertIssuedMessage(message: GrantIssuedMessage): void {
    if (message.type !== "GrantIssued") {
      throw new GrantNotFoundError("GrantIssued");
    }
    assertIdentifier(message.grantId, "grantId");
    assertIdentifier(message.projectId, "projectId");
    assertIdentifier(message.connectionId, "connectionId");
    assertIdentifier(message.currency, "currency");
    assertPositiveInteger(message.units, "units");
    assertPositiveInteger(message.concurrency, "concurrency");
    assertSafeInteger(message.issuedAt, "issuedAt");
    assertSafeInteger(message.expiresAt, "expiresAt");
    currencySeed(message.currency);
  }

  private async deliver(message: GrantDepositedAck | GrantClosureReport): Promise<void> {
    await Promise.resolve();
    await this.sink.deliver(message);
  }
}

function currencySeed(code: string): CurrencySeed {
  if (code === "usd") {
    return { unit: "micro-USD", scale: 1_000_000 };
  }
  if (code.startsWith("allowance:")) {
    return { unit: "ppm of window share", scale: 1_000_000 };
  }
  if (code.startsWith("slots:")) {
    return { unit: "slot", scale: 1 };
  }
  throw new UnsupportedCurrencyError(code);
}
