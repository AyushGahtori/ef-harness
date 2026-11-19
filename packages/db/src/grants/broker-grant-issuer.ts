import {
  ClosureConflictError,
  CurrencyMismatchError,
  GrantsHeldForRecoveryError,
  GrantNotFoundError,
  InsufficientWindowHeadroomError,
  InvalidGrantWindowError,
  InvalidPriorityClassError,
  NoActiveConnectionWindowError,
  UnknownConnectionError,
  UnknownProjectError,
  UnknownReconciliationError,
  WindowAccountingError,
  WrongDatabaseRoleError,
} from "./errors.js";
import {
  addSafe,
  assertIdentifier,
  assertNonNegativeInteger,
  assertPositiveInteger,
  assertSafeInteger,
} from "./integers.js";
import {
  isGrantPriorityClass,
  type ClosureRecording,
  type DepositAckResult,
  type ExpiredGrant,
  type GrantClosureReport,
  type GrantIssuedMessage,
  type GrantMessageSink,
  type GrantUnknownReconciledMessage,
  type IssueGrantInput,
  type ReleasedGrant,
  type UnknownReconciliationRecording,
} from "./messages.js";
import { optionalInteger, requiredInteger, requiredText } from "./rows.js";
import { GrantSqlSession, type SqlRow } from "./session.js";

const HOLD_KEY = "grant_protocol_hold";

interface ConnectionWindow {
  readonly windowKind: string;
  readonly windowStart: number;
  readonly limitUnits: number | null;
  readonly estimatedUnits: number;
}

interface GrantRow {
  readonly id: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly units: number;
  readonly issuedAt: number;
  readonly state: "issued" | "deposited" | "closed" | "expired";
  readonly usedUnits: number | null;
  readonly unknownUnits: number | null;
  readonly closedAt: number | null;
}

export class BrokerGrantIssuer {
  private readonly global: GrantSqlSession;
  private readonly sink: GrantMessageSink;

  constructor(globalDb: GrantSqlSession, sink: GrantMessageSink) {
    if (globalDb.role !== "global") {
      throw new WrongDatabaseRoleError("global", globalDb.role);
    }
    this.global = globalDb;
    this.sink = sink;
  }

  get filePath(): string {
    return this.global.filePath;
  }

  async issueGrant(input: IssueGrantInput): Promise<GrantIssuedMessage> {
    const message = this.global.runImmediate(() => this.insertGrant(input));
    await this.deliver(message);
    return message;
  }

  acknowledgeDeposit(grantId: string): DepositAckResult {
    assertIdentifier(grantId, "grantId");
    return this.global.runImmediate(() => this.acknowledgeInside(grantId));
  }

  acknowledgeDepositedGrants(grantIds: readonly string[]): DepositAckResult[] {
    for (const grantId of grantIds) {
      assertIdentifier(grantId, "grantId");
    }
    return this.global.runImmediate(() => grantIds.map((grantId) => this.acknowledgeInside(grantId)));
  }

  recordClosure(report: GrantClosureReport, now: number): ClosureRecording {
    assertIdentifier(report.grantId, "grantId");
    assertNonNegativeInteger(report.usedUnits, "usedUnits");
    assertNonNegativeInteger(report.unknownUnits, "unknownUnits");
    assertSafeInteger(now, "now");
    return this.global.runImmediate(() => this.recordClosureInside(report, now));
  }

  reconcileUnknownSpend(message: GrantUnknownReconciledMessage): UnknownReconciliationRecording {
    assertIdentifier(message.grantId, "grantId");
    assertNonNegativeInteger(message.usedUnits, "usedUnits");
    assertNonNegativeInteger(message.unknownUnits, "unknownUnits");
    return this.global.runImmediate(() => this.reconcileUnknownInside(message));
  }

  expireUnreportedGrants(now: number, graceMs: number): ExpiredGrant[] {
    assertSafeInteger(now, "now");
    assertNonNegativeInteger(graceMs, "graceMs");
    return this.global.runImmediate(() => {
      const rows = this.global.allNamed("global_expire_grants", { now, grace_ms: graceMs });
      return rows.map((row) => {
        const units = requiredInteger(row, "units");
        return {
          grantId: requiredText(row, "id"),
          projectId: requiredText(row, "project"),
          connectionId: requiredText(row, "connection"),
          units,
          usedUnits: units,
        };
      });
    });
  }

  releaseUndepositedGrants(
    projectId: string,
    depositedGrantIds: readonly string[],
    now: number,
  ): ReleasedGrant[] {
    assertIdentifier(projectId, "projectId");
    assertSafeInteger(now, "now");
    const deposited = new Set(depositedGrantIds);
    return this.global.runImmediate(() => {
      const rows = this.global
        .all(
          `SELECT id, project, connection, units, issued_at, state, used_units, unknown_units, closed_at
             FROM grants
            WHERE project = ? AND state IN ('issued', 'expired')`,
          projectId,
        )
        .map(readGrantRow)
        .filter((grant) => !deposited.has(grant.id));
      const released: ReleasedGrant[] = [];
      for (const grant of rows) {
        const outcome = this.releaseOne(grant, now);
        if (outcome) {
          released.push(outcome);
        }
      }
      return released;
    });
  }

  holdNewGrants(): void {
    this.global.runImmediate(() => {
      this.global.run(
        `INSERT INTO meta(key, value) VALUES (?, '1')
         ON CONFLICT(key) DO UPDATE SET value = '1'`,
        HOLD_KEY,
      );
    });
  }

  releaseNewGrants(): void {
    this.global.runImmediate(() => {
      this.global.run(
        `INSERT INTO meta(key, value) VALUES (?, '0')
         ON CONFLICT(key) DO UPDATE SET value = '0'`,
        HOLD_KEY,
      );
    });
  }

  private insertGrant(input: IssueGrantInput): GrantIssuedMessage {
    this.assertIssueInput(input);
    if (this.holdActive()) {
      throw new GrantsHeldForRecoveryError();
    }
    const connection = this.global.get("SELECT currency FROM connections WHERE id = ?", input.connectionId);
    if (!connection) {
      throw new UnknownConnectionError(input.connectionId);
    }
    const connectionCurrency = requiredText(connection, "currency");
    if (connectionCurrency !== input.currency) {
      throw new CurrencyMismatchError(input.connectionId, connectionCurrency, input.currency);
    }
    const project = this.global.get("SELECT id FROM projects WHERE id = ?", input.projectId);
    if (!project) {
      throw new UnknownProjectError(input.projectId);
    }
    const windows = this.windowsCovering(input.connectionId, input.issuedAt);
    if (windows.length === 0) {
      throw new NoActiveConnectionWindowError(input.connectionId, input.issuedAt);
    }
    for (const window of windows) {
      if (window.limitUnits !== null && input.units > window.limitUnits - window.estimatedUnits) {
        throw new InsufficientWindowHeadroomError(
          input.connectionId,
          window.windowKind,
          Math.max(0, window.limitUnits - window.estimatedUnits),
          input.units,
        );
      }
    }
    this.global.run(
      `INSERT INTO grants (
         id, project, connection, currency, units, concurrency, priority_class,
         issued_at, expires_at, state
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
      input.grantId,
      input.projectId,
      input.connectionId,
      input.currency,
      input.units,
      input.concurrency,
      input.priorityClass,
      input.issuedAt,
      input.expiresAt,
    );
    for (const window of windows) {
      this.writeEstimated(input.connectionId, window, addSafe(window.estimatedUnits, input.units, "estimated_units"));
    }
    return {
      type: "GrantIssued",
      grantId: input.grantId,
      projectId: input.projectId,
      connectionId: input.connectionId,
      currency: input.currency,
      units: input.units,
      concurrency: input.concurrency,
      priorityClass: input.priorityClass,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    };
  }

  private acknowledgeInside(grantId: string): DepositAckResult {
    const existing = this.requireGrant(grantId);
    const changed = this.global.run(
      `UPDATE grants SET state = 'deposited' WHERE id = ? AND state = 'issued'`,
      grantId,
    );
    const state = changed === 1 ? "deposited" : existing.state;
    return { grantId, state, changed: changed === 1 };
  }

  private recordClosureInside(report: GrantClosureReport, now: number): ClosureRecording {
    const grant = this.requireGrant(report.grantId);
    const consumed = addSafe(report.usedUnits, report.unknownUnits, "consumed_units");
    if (grant.state === "closed") {
      const used = grant.usedUnits ?? 0;
      const unknown = grant.unknownUnits ?? 0;
      if (used === report.usedUnits && unknown === report.unknownUnits) {
        return {
          grantId: grant.id,
          idempotent: true,
          usedUnits: used,
          unknownUnits: unknown,
          unusedUnitsReturned: 0,
          state: "closed",
          recordedAt: grant.closedAt ?? now,
        };
      }
      throw new ClosureConflictError(grant.id);
    }
    if (grant.state !== "issued" && grant.state !== "deposited" && grant.state !== "expired") {
      throw new ClosureConflictError(grant.id);
    }
    const previous = chargedUnits(grant);
    const delta = consumed - previous;
    this.adjustWindows(grant.connectionId, grant.issuedAt, delta);
    const updated = this.global.run(
      `UPDATE grants
          SET state = 'closed', used_units = ?, unknown_units = ?, closed_at = ?
        WHERE id = ? AND state = ?`,
      report.usedUnits,
      report.unknownUnits,
      now,
      grant.id,
      grant.state,
    );
    if (updated !== 1) {
      throw new WindowAccountingError(`Grant ${grant.id} changed before closure could be recorded.`);
    }
    return {
      grantId: grant.id,
      idempotent: false,
      usedUnits: report.usedUnits,
      unknownUnits: report.unknownUnits,
      unusedUnitsReturned: Math.max(0, grant.units - consumed),
      state: "closed",
      recordedAt: now,
    };
  }

  private reconcileUnknownInside(message: GrantUnknownReconciledMessage): UnknownReconciliationRecording {
    const grant = this.requireGrant(message.grantId);
    if (grant.state !== "closed") {
      throw new UnknownReconciliationError(
        `Grant ${grant.id} is ${grant.state} and cannot reconcile unknown spend until it is closed.`,
      );
    }
    const oldUsed = grant.usedUnits ?? 0;
    const oldUnknown = grant.unknownUnits ?? 0;
    if (message.usedUnits === oldUsed && message.unknownUnits === oldUnknown) {
      return {
        grantId: grant.id,
        idempotent: true,
        usedUnits: oldUsed,
        unknownUnits: oldUnknown,
        windowDelta: 0,
      };
    }
    if (message.usedUnits < oldUsed) {
      throw new UnknownReconciliationError(
        `Grant ${grant.id} reconciliation cannot reduce known used_units below ${oldUsed}.`,
      );
    }
    if (message.unknownUnits > oldUnknown) {
      throw new UnknownReconciliationError(
        `Grant ${grant.id} reconciliation cannot increase unknown_units above ${oldUnknown}.`,
      );
    }
    const oldConsumed = addSafe(oldUsed, oldUnknown, "consumed_units");
    const newConsumed = addSafe(message.usedUnits, message.unknownUnits, "consumed_units");
    const delta = newConsumed - oldConsumed;
    this.adjustWindows(grant.connectionId, grant.issuedAt, delta);
    const updated = this.global.run(
      `UPDATE grants
          SET state = 'closed', used_units = ?, unknown_units = ?,
              closed_at = coalesce(closed_at, ?)
        WHERE id = ? AND state = ?`,
      message.usedUnits,
      message.unknownUnits,
      grant.closedAt ?? grant.issuedAt,
      grant.id,
      "closed",
    );
    if (updated !== 1) {
      throw new WindowAccountingError(`Grant ${grant.id} changed during unknown reconciliation.`);
    }
    return {
      grantId: grant.id,
      idempotent: false,
      usedUnits: message.usedUnits,
      unknownUnits: message.unknownUnits,
      windowDelta: delta,
    };
  }

  private releaseOne(grant: GrantRow, now: number): ReleasedGrant | null {
    if (grant.state === "issued") {
      const updated = this.global.run(
        `UPDATE grants
            SET state = 'expired', used_units = 0, unknown_units = 0, closed_at = ?
          WHERE id = ? AND state = 'issued'`,
        now,
        grant.id,
      );
      if (updated !== 1) {
        return null;
      }
      this.adjustWindows(grant.connectionId, grant.issuedAt, -grant.units);
      return { grantId: grant.id, unitsReturned: grant.units, state: "expired" };
    }
    if (grant.state === "expired" && grant.usedUnits === grant.units) {
      const updated = this.global.run(
        `UPDATE grants
            SET used_units = 0, unknown_units = 0, closed_at = coalesce(closed_at, ?)
          WHERE id = ? AND state = 'expired' AND used_units = units`,
        now,
        grant.id,
      );
      if (updated !== 1) {
        return null;
      }
      this.adjustWindows(grant.connectionId, grant.issuedAt, -grant.units);
      return { grantId: grant.id, unitsReturned: grant.units, state: "expired" };
    }
    return null;
  }

  private holdActive(): boolean {
    const row = this.global.get("SELECT value FROM meta WHERE key = ?", HOLD_KEY);
    return row?.value === "1";
  }

  private requireGrant(grantId: string): GrantRow {
    const row = this.global.get(
      `SELECT id, project, connection, units, issued_at, state, used_units, unknown_units, closed_at
         FROM grants WHERE id = ?`,
      grantId,
    );
    if (!row) {
      throw new GrantNotFoundError(grantId);
    }
    return readGrantRow(row);
  }

  private windowsCovering(connectionId: string, at: number): ConnectionWindow[] {
    return this.global
      .all(
        `SELECT window_kind, window_start, limit_units, estimated_units
           FROM connection_windows
          WHERE connection = ? AND window_start <= ? AND window_end > ?`,
        connectionId,
        at,
        at,
      )
      .map(readWindow);
  }

  private adjustWindows(connectionId: string, issuedAt: number, delta: number): void {
    if (!Number.isSafeInteger(delta)) {
      throw new WindowAccountingError("Window adjustment is not a safe integer.");
    }
    if (delta === 0) {
      return;
    }
    const windows = this.windowsCovering(connectionId, issuedAt);
    if (windows.length === 0) {
      throw new WindowAccountingError(`Connection ${connectionId} lost the window that backed the grant.`);
    }
    for (const window of windows) {
      const next = addSafe(window.estimatedUnits, delta, "estimated_units");
      if (next < 0) {
        throw new WindowAccountingError(
          `Connection ${connectionId} window ${window.windowKind} would become negative.`,
        );
      }
      this.writeEstimated(connectionId, window, next);
    }
  }

  private writeEstimated(connectionId: string, window: ConnectionWindow, estimatedUnits: number): void {
    const changes = this.global.run(
      `UPDATE connection_windows
          SET estimated_units = ?
        WHERE connection = ? AND window_kind = ? AND window_start = ?`,
      estimatedUnits,
      connectionId,
      window.windowKind,
      window.windowStart,
    );
    if (changes !== 1) {
      throw new WindowAccountingError(
        `Connection ${connectionId} window ${window.windowKind} could not be updated.`,
      );
    }
  }

  private assertIssueInput(input: IssueGrantInput): void {
    assertIdentifier(input.grantId, "grantId");
    assertIdentifier(input.projectId, "projectId");
    assertIdentifier(input.connectionId, "connectionId");
    assertIdentifier(input.currency, "currency");
    assertPositiveInteger(input.units, "units");
    assertPositiveInteger(input.concurrency, "concurrency");
    assertSafeInteger(input.issuedAt, "issuedAt");
    assertSafeInteger(input.expiresAt, "expiresAt");
    if (input.expiresAt <= input.issuedAt) {
      throw new InvalidGrantWindowError();
    }
    if (!isGrantPriorityClass(input.priorityClass)) {
      throw new InvalidPriorityClassError(String(input.priorityClass));
    }
  }

  private async deliver(message: GrantIssuedMessage): Promise<void> {
    await Promise.resolve();
    await this.sink.deliver(message);
  }
}

function chargedUnits(grant: GrantRow): number {
  if (grant.state === "issued" || grant.state === "deposited") {
    return grant.units;
  }
  if (grant.state === "expired") {
    if (grant.usedUnits === 0) {
      return 0;
    }
    return grant.units;
  }
  return addSafe(grant.usedUnits ?? 0, grant.unknownUnits ?? 0, "consumed_units");
}

function readGrantRow(row: SqlRow): GrantRow {
  const state = requiredText(row, "state");
  if (state !== "issued" && state !== "deposited" && state !== "closed" && state !== "expired") {
    throw new WindowAccountingError(`Unexpected grant state ${state}.`);
  }
  return {
    id: requiredText(row, "id"),
    projectId: requiredText(row, "project"),
    connectionId: requiredText(row, "connection"),
    units: requiredInteger(row, "units"),
    issuedAt: requiredInteger(row, "issued_at"),
    state,
    usedUnits: optionalInteger(row, "used_units"),
    unknownUnits: optionalInteger(row, "unknown_units"),
    closedAt: optionalInteger(row, "closed_at"),
  };
}

function readWindow(row: SqlRow): ConnectionWindow {
  return {
    windowKind: requiredText(row, "window_kind"),
    windowStart: requiredInteger(row, "window_start"),
    limitUnits: optionalInteger(row, "limit_units"),
    estimatedUnits: requiredInteger(row, "estimated_units"),
  };
}
