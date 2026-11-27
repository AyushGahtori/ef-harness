import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { ledgerSqlFromDatabase, type LedgerSql, type LedgerStatement } from "./sql-port.js";
import { auditLedgerConservation, type ConservationAudit } from "./conservation.js";
import { loadCanonicalQueries } from "./canonical-queries.js";
import {
  BudgetLimitError,
  BudgetScopeExistsError,
  CrossWaveBorrowError,
  CurrencyDefinitionConflictError,
  CurrencyNotRegisteredError,
  LedgerCycleError,
  LedgerInputError,
  LedgerInvariantError,
  MissingBudgetScopeError,
  ReservationAmountError,
  ReservationExistsError,
  ScopeBindingError,
} from "./errors.js";
import { assertNonNegativeIntegerUnits, lacksHeadroom } from "./integer-units.js";
import {
  assertWaveId,
  formatWaveScopeId,
  PAPERWORK_PHASES,
  paperworkPhaseLimits,
  parseWaveScopeId,
  splitIntegerByWeights,
  type PaperworkPhase,
} from "./paperwork-allocation.js";
import { estimateP95OutputUnits } from "./percentiles.js";
import { changeCount, cell, prepareNamed, readNullableText, readNullableUnits, readText, readUnits } from "./sql-values.js";
import { assertScopeKind, thresholdsFromRemaining } from "./thresholds.js";
import type {
  BudgetRemainingRow,
  BudgetScopeRecord,
  BudgetScopeSnapshot,
  CreateBudgetScopeInput,
  MarkUnknownResult,
  ReconcileUnknownInput,
  ReconcileUnknownResult,
  RegisteredCurrency,
  ReleaseResult,
  ReservationHandle,
  ReservationPurpose,
  ReservationRecord,
  ReservationState,
  ReserveAcrossScopesInput,
  ReserveP95StreamCutoffInput,
  ReserveResult,
  ScopeKind,
  ScopeRef,
  SettleReservationInput,
  SettleResult,
  ThresholdCrossedEvent,
} from "./types.js";
import { RESERVATION_PURPOSES, SCOPE_KINDS } from "./types.js";

type SqlStatement = LedgerStatement;

export interface WaveWeightInput {
  waveId: string;
  weight: number;
}

export interface CreateWavePaperworkInput {
  projectScopeId: string;
  currency: string;
  waves: readonly WaveWeightInput[];
  upfrontWeight?: number;
}

export interface PaperworkEnvelope {
  scopeKind: "wave_paperwork";
  scopeId: string;
  phase: PaperworkPhase;
  waveId: string;
  ordinal: number;
  currency: string;
  limitUnits: number;
}

export interface RollForwardPaperworkInput {
  fromWaveId: string;
  toWaveId: string;
  currency: string;
}

export interface RollForwardResult {
  phase: PaperworkPhase;
  fromScopeId: string;
  toScopeId: string;
  movedUnits: number;
}

interface WaveEntry {
  waveId: string;
  weight: number;
  ordinal: number;
}

interface EnvelopeRow {
  scopeId: string;
  phase: PaperworkPhase;
  ordinal: number;
  limitUnits: number;
  reservedUnits: number;
  spentUnits: number;
}

const CURRENCY_CODE = /^(?:usd|slots:local|allowance:[A-Za-z0-9][A-Za-z0-9._:-]*)$/u;

export class BudgetLedgerRepo {
  private readonly insertCurrencyStmt: SqlStatement;
  private readonly readCurrencyStmt: SqlStatement;
  private readonly insertBudgetStmt: SqlStatement;
  private readonly readBudgetStmt: SqlStatement;
  private readonly raiseLimitStmt: SqlStatement;
  private readonly insertReservationStmt: SqlStatement;
  private readonly insertScopeLinkStmt: SqlStatement;
  private readonly readReservationStmt: SqlStatement;
  private readonly readReservationScopesStmt: SqlStatement;
  private readonly countScopesStmt: SqlStatement;
  private readonly markReleasedStmt: SqlStatement;
  private readonly markUnknownStmt: SqlStatement;
  private readonly markHeldStmt: SqlStatement;
  private readonly listWaveStmt: SqlStatement;
  private readonly setWaveLimitStmt: SqlStatement;
  private readonly reserveStmt: SqlStatement;
  private readonly settleStmt: SqlStatement;
  private readonly settleMarkStmt: SqlStatement;
  private readonly releaseStmt: SqlStatement;
  private readonly remainingStmt: SqlStatement;
  private readonly db: LedgerSql;

  constructor(db: DatabaseSync | LedgerSql) {
    this.db = db instanceof DatabaseSync ? ledgerSqlFromDatabase(db) : db;
    this.db.exec("PRAGMA foreign_keys = ON");
    const queries = loadCanonicalQueries();
    this.insertCurrencyStmt = this.db.prepare(
      `INSERT INTO currencies(code, unit, scale) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING`,
    );
    this.readCurrencyStmt = this.db.prepare(`SELECT code, unit, scale FROM currencies WHERE code = ?`);
    this.insertBudgetStmt = this.db.prepare(
      `INSERT INTO budgets(
         scope_kind, scope_id, currency, limit_units, reserved_units, spent_units, closed, parent_kind, parent_id
       ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
    );
    this.readBudgetStmt = this.db.prepare(
      `SELECT scope_kind, scope_id, currency, limit_units, reserved_units, spent_units, closed, parent_kind, parent_id
         FROM budgets WHERE scope_kind = ? AND scope_id = ? AND currency = ?`,
    );
    this.raiseLimitStmt = this.db.prepare(
      `UPDATE budgets SET limit_units = ? WHERE scope_kind = ? AND scope_id = ? AND currency = ?`,
    );
    this.insertReservationStmt = this.db.prepare(
      `INSERT INTO reservations(
         id, attempt, purpose, currency, amount_units, state, actual_units, overrun_units, created_at, settled_at
       ) VALUES (?, ?, ?, ?, ?, 'held', NULL, 0, ?, NULL)`,
    );
    this.insertScopeLinkStmt = this.db.prepare(
      `INSERT INTO reservation_scopes(reservation, scope_kind, scope_id, currency) VALUES (?, ?, ?, ?)`,
    );
    this.readReservationStmt = this.db.prepare(
      `SELECT id, attempt, purpose, currency, amount_units, state, actual_units, overrun_units, created_at, settled_at
         FROM reservations WHERE id = ?`,
    );
    this.readReservationScopesStmt = this.db.prepare(
      `SELECT scope_kind, scope_id, currency FROM reservation_scopes WHERE reservation = ?`,
    );
    this.countScopesStmt = this.db.prepare(
      `SELECT count(*) AS n FROM reservation_scopes WHERE reservation = ?`,
    );
    this.markReleasedStmt = this.db.prepare(
      `UPDATE reservations SET state = 'released' WHERE id = ? AND state = 'held'`,
    );
    this.markUnknownStmt = this.db.prepare(
      `UPDATE reservations SET state = 'unknown' WHERE id = ? AND state = 'held'`,
    );
    this.markHeldStmt = this.db.prepare(
      `UPDATE reservations SET state = 'held' WHERE id = ? AND state = 'unknown'`,
    );
    this.listWaveStmt = this.db.prepare(
      `SELECT scope_id, limit_units, reserved_units, spent_units
         FROM budgets WHERE scope_kind = 'wave_paperwork' AND currency = ?`,
    );
    this.setWaveLimitStmt = this.db.prepare(
      `UPDATE budgets SET limit_units = ?
        WHERE scope_kind = 'wave_paperwork' AND scope_id = ? AND currency = ?`,
    );
    this.reserveStmt = prepareNamed(this.db, queries.reserve);
    this.settleStmt = prepareNamed(this.db, queries.settle);
    this.settleMarkStmt = prepareNamed(this.db, queries.settle_mark);
    this.releaseStmt = prepareNamed(this.db, queries.release);
    this.remainingStmt = prepareNamed(this.db, queries.budget_remaining);
  }

  registerCurrency(code: string): RegisteredCurrency {
    const definition = currencyDefinition(code);
    return this.transaction(() => {
      this.insertCurrencyStmt.run(code, definition.unit, definition.scale);
      const stored = this.readRegisteredCurrency(code);
      if (stored.unit !== definition.unit || stored.scale !== definition.scale) {
        throw new CurrencyDefinitionConflictError(code);
      }
      return stored;
    });
  }

  createBudgetScope(input: CreateBudgetScopeInput): BudgetScopeRecord {
    return this.transaction(() => this.insertScope(input));
  }

  createWavePaperworkEnvelopes(input: CreateWavePaperworkInput): PaperworkEnvelope[] {
    if (!input.projectScopeId) throw new LedgerInputError("project scope id is required");
    return this.transaction(() => {
      const project = this.readScope("project", input.projectScopeId, input.currency);
      if (!project) {
        throw new MissingBudgetScopeError("project", input.projectScopeId, input.currency);
      }
      const waves = waveEntries(input.waves, input.upfrontWeight);
      const phaseLimits = paperworkPhaseLimits(project.limitUnits);
      const envelopes: PaperworkEnvelope[] = [];
      for (const phase of PAPERWORK_PHASES) {
        const phaseLimit = phaseLimits[phase];
        const shares = splitIntegerByWeights(
          phaseLimit,
          waves.map((wave) => wave.weight),
        );
        waves.forEach((wave, index) => {
          const limitUnits = shares[index];
          if (limitUnits === undefined) {
            throw new LedgerInvariantError(`missing ${phase} share for wave ${wave.waveId}`);
          }
          const scopeId = formatWaveScopeId(wave.ordinal, wave.waveId, phase);
          this.insertScope({
            scopeKind: "wave_paperwork",
            scopeId,
            currency: input.currency,
            limitUnits,
            parentKind: "project",
            parentId: input.projectScopeId,
          });
          envelopes.push({
            scopeKind: "wave_paperwork",
            scopeId,
            phase,
            waveId: wave.waveId,
            ordinal: wave.ordinal,
            currency: input.currency,
            limitUnits,
          });
        });
      }
      return envelopes;
    });
  }

  rollForwardUnusedPaperwork(input: RollForwardPaperworkInput): RollForwardResult[] {
    assertWaveId(input.fromWaveId);
    assertWaveId(input.toWaveId);
    if (input.fromWaveId === input.toWaveId) {
      throw new LedgerInputError("paperwork roll-forward needs two different waves");
    }
    return this.transaction(() => {
      const source = this.envelopesForWave(input.fromWaveId, input.currency);
      const destination = this.envelopesForWave(input.toWaveId, input.currency);
      const moved: RollForwardResult[] = [];
      for (const phase of PAPERWORK_PHASES) {
        const from = source.get(phase);
        const to = destination.get(phase);
        if (!from) {
          throw new MissingBudgetScopeError("wave_paperwork", `${input.fromWaveId}:${phase}`, input.currency);
        }
        if (!to) {
          throw new MissingBudgetScopeError("wave_paperwork", `${input.toWaveId}:${phase}`, input.currency);
        }
        const unused = Number(
          BigInt(from.limitUnits) - BigInt(from.reservedUnits) - BigInt(from.spentUnits),
        );
        if (!Number.isSafeInteger(unused) || unused < 0) {
          throw new LedgerInvariantError(`wave ${input.fromWaveId} ${phase} has a negative unused balance`);
        }
        if (unused > 0) {
          this.setWaveLimitStmt.run(from.limitUnits - unused, from.scopeId, input.currency);
          this.setWaveLimitStmt.run(to.limitUnits + unused, to.scopeId, input.currency);
        }
        moved.push({
          phase,
          fromScopeId: from.scopeId,
          toScopeId: to.scopeId,
          movedUnits: unused,
        });
      }
      return moved;
    });
  }

  reserveAcrossScopes(input: ReserveAcrossScopesInput): ReserveResult {
    this.assertReserveInput(input);
    return this.transaction(() => this.reserveInside(input));
  }

  reserveP95StreamCutoff(input: ReserveP95StreamCutoffInput): ReserveResult {
    const amountUnits = estimateP95OutputUnits(input.observedOutputUnits);
    if (amountUnits === 0) {
      throw new ReservationAmountError(0, "p95 stream cutoff was 0 units and cannot be reserved");
    }
    const taskClass = input.taskClass.trim();
    if (!taskClass) {
      throw new LedgerInputError("task class is required for a stream cutoff reservation");
    }
    const request: ReserveAcrossScopesInput = {
      reservationId: input.reservationId,
      purpose: input.purpose,
      currency: input.currency,
      amountUnits,
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      createdAt: input.createdAt,
    };
    if (input.additionalScopes !== undefined) request.additionalScopes = input.additionalScopes;
    if (input.attemptId !== undefined) request.attemptId = input.attemptId;
    if (input.activeWaveId !== undefined) request.activeWaveId = input.activeWaveId;
    if (input.crossWaveBorrowApproved !== undefined) {
      request.crossWaveBorrowApproved = input.crossWaveBorrowApproved;
    }
    const result = this.reserveAcrossScopes(request);
    if (!result.ok) return result;
    return {
      ok: true,
      reservation: {
        ...result.reservation,
        taskClass,
        estimateKind: "p95_stream_cutoff",
      },
    };
  }

  settleReservation(input: SettleReservationInput): SettleResult {
    this.assertId(input.reservationId);
    assertNonNegativeIntegerUnits(input.actualUnits);
    this.assertTimestamp(input.now);
    return this.transaction(() => this.settleInside(input.reservationId, input.actualUnits, input.now));
  }

  releaseReservation(reservationId: string): ReleaseResult {
    this.assertId(reservationId);
    return this.transaction(() => this.releaseInside(reservationId, "held"));
  }

  markReservationUnknown(reservationId: string): MarkUnknownResult {
    this.assertId(reservationId);
    return this.transaction(() => {
      const row = this.readReservationRow(reservationId);
      if (!row) return { ok: false, reason: "missing" };
      if (row.state === "unknown") return { ok: true, reservationId, idempotent: true };
      if (row.state !== "held") return { ok: false, reason: "not_held" };
      const changes = changeCount(this.markUnknownStmt.run(reservationId));
      if (changes !== 1) {
        throw new LedgerInvariantError(`did not mark reservation ${reservationId} unknown`);
      }
      return { ok: true, reservationId, idempotent: false };
    });
  }

  reconcileUnknownReservation(input: ReconcileUnknownInput): ReconcileUnknownResult {
    this.assertId(input.reservationId);
    this.assertTimestamp(input.now);
    if (input.resolution === "settle") {
      if (input.actualUnits === undefined) {
        throw new LedgerInputError("reconciling an unknown reservation by settle requires actualUnits");
      }
      assertNonNegativeIntegerUnits(input.actualUnits);
    } else if (input.resolution !== "release") {
      throw new LedgerInputError("unknown reservations reconcile by settle or release");
    }
    return this.transaction(() => {
      const row = this.readReservationRow(input.reservationId);
      if (!row) return { ok: false, reason: "missing" };
      if (row.state !== "unknown") return { ok: false, reason: "not_unknown" };
      if (input.resolution === "release") {
        const released = this.releaseInside(input.reservationId, "unknown");
        if (!released.ok) return { ok: false, reason: "not_unknown" };
        return { ok: true, resolution: "release", reservationId: input.reservationId };
      }
      const actualUnits = input.actualUnits;
      if (actualUnits === undefined) {
        throw new LedgerInputError("reconciling an unknown reservation by settle requires actualUnits");
      }
      const settle = this.settleInside(input.reservationId, actualUnits, input.now);
      if (!settle.ok) return { ok: false, reason: "not_unknown" };
      return { ok: true, resolution: "settle", settle };
    });
  }

  getScopeSnapshot(scopeKind: ScopeKind, scopeId: string): BudgetScopeSnapshot {
    this.assertScope(scopeKind, scopeId);
    const currencies = this.getBudgetRemaining(scopeKind, scopeId);
    const hardStop = currencies.some((row) => row.overrun || row.remainingUnits === 0);
    return { scopeKind, scopeId, currencies, hardStop };
  }

  getBudgetRemaining(scopeKind: ScopeKind, scopeId: string): BudgetRemainingRow[] {
    this.assertScope(scopeKind, scopeId);
    const rows = this.remainingStmt.all({ scope_kind: scopeKind, scope_id: scopeId }) as Record<
      string,
      SQLOutputValue
    >[];
    return rows.map((row) => {
      const kind = readText(cell(row, "scope_kind"), "scope_kind");
      assertScopeKind(kind);
      return {
        scopeKind: kind,
        scopeId: readText(cell(row, "scope_id"), "scope_id"),
        currency: readText(cell(row, "currency"), "currency"),
        limitUnits: readUnits(cell(row, "limit_units"), "limit_units"),
        reservedUnits: readUnits(cell(row, "reserved_units"), "reserved_units"),
        spentUnits: readUnits(cell(row, "spent_units"), "spent_units"),
        remainingUnits: readUnits(cell(row, "remaining_units"), "remaining_units"),
        overrun: readUnits(cell(row, "overrun"), "overrun") === 1,
      };
    });
  }

  evaluateSpendThresholds(scopeKind: ScopeKind, scopeId: string): ThresholdCrossedEvent[] {
    return thresholdsFromRemaining(this.getBudgetRemaining(scopeKind, scopeId));
  }

  raiseBudgetLimit(
    scopeKind: ScopeKind,
    scopeId: string,
    currency: string,
    limitUnits: number,
  ): BudgetScopeRecord {
    this.assertScope(scopeKind, scopeId);
    assertNonNegativeIntegerUnits(limitUnits);
    return this.transaction(() => {
      const row = this.readScope(scopeKind, scopeId, currency);
      if (!row) throw new MissingBudgetScopeError(scopeKind, scopeId, currency);
      if (limitUnits < row.limitUnits) {
        throw new BudgetLimitError("raiseBudgetLimit cannot lower limit_units");
      }
      const changes = changeCount(this.raiseLimitStmt.run(limitUnits, scopeKind, scopeId, currency));
      if (changes !== 1 && limitUnits !== row.limitUnits) {
        throw new LedgerInvariantError("raiseBudgetLimit did not update the budget row");
      }
      return { ...row, limitUnits };
    });
  }

  getReservation(reservationId: string): ReservationRecord | null {
    this.assertId(reservationId);
    return this.readReservationRow(reservationId);
  }

  auditConservation(): ConservationAudit {
    return auditLedgerConservation(this.db);
  }

  private reserveInside(input: ReserveAcrossScopesInput): ReserveResult {
    this.assertCurrencyRegistered(input.currency);
    const chain = this.linkedScopes(input);
    const scopes = chain.map((scope) => ({ scopeKind: scope.scopeKind, scopeId: scope.scopeId }));
    assertPurposeScopeBinding(input.purpose, scopes);
    this.assertCrossWave(scopes, input);
    const blocking = chain.filter(
      (scope) =>
        scope.closed ||
        lacksHeadroom(scope.reservedUnits, scope.spentUnits, input.amountUnits, scope.limitUnits),
    );
    const blockingScopes = blockingLabels(blocking);
    this.db.exec("SAVEPOINT ef_ledger_reserve");
    try {
      this.insertReservationStmt.run(
        input.reservationId,
        input.attemptId ?? null,
        input.purpose,
        input.currency,
        input.amountUnits,
        input.createdAt,
      );
      for (const scope of scopes) {
        this.insertScopeLinkStmt.run(
          input.reservationId,
          scope.scopeKind,
          scope.scopeId,
          input.currency,
        );
      }
      const changes = changeCount(
        this.reserveStmt.run({ reservation: input.reservationId, amount: input.amountUnits }),
      );
      if (changes !== scopes.length) {
        if (blockingScopes.length === 0) {
          throw new LedgerInvariantError(
            `reserve updated ${changes} of ${scopes.length} scopes with no blocking scope`,
          );
        }
        this.db.exec("ROLLBACK TO ef_ledger_reserve");
        this.db.exec("RELEASE ef_ledger_reserve");
        return { ok: false, blockingScopes };
      }
      if (blockingScopes.length > 0) {
        throw new LedgerInvariantError("reserve succeeded while a scope was closed or over its limit");
      }
      this.db.exec("RELEASE ef_ledger_reserve");
      const reservation: ReservationHandle = {
        reservationId: input.reservationId,
        purpose: input.purpose,
        currency: input.currency,
        amountUnits: input.amountUnits,
        scopes,
        state: "held",
      };
      return { ok: true, reservation };
    } catch (error) {
      this.rollbackSavepoint(error);
      throw reservationConstraint(error, input.reservationId);
    }
  }

  private settleInside(reservationId: string, actualUnits: number, now: number): SettleResult {
    const row = this.readReservationRow(reservationId);
    if (!row) return { ok: false, reason: "missing" };
    if (row.state === "settled") {
      if (row.actualUnits === actualUnits) {
        return {
          ok: true,
          idempotent: true,
          reservationId,
          amountUnits: row.amountUnits,
          actualUnits,
          overrunUnits: row.overrunUnits,
        };
      }
      return { ok: false, reason: "already_settled" };
    }
    if (row.state === "released") return { ok: false, reason: "already_released" };
    if (row.state !== "held" && row.state !== "unknown") return { ok: false, reason: "not_open" };
    const scopes = this.countReservationScopes(reservationId);
    const settled = changeCount(this.settleStmt.run({ reservation: reservationId, actual: actualUnits }));
    if (settled !== scopes) {
      throw new LedgerInvariantError(
        `settle updated ${settled} budget rows for ${reservationId}, expected ${scopes}`,
      );
    }
    const marked = changeCount(
      this.settleMarkStmt.run({ reservation: reservationId, actual: actualUnits, now }),
    );
    if (marked !== 1) throw new LedgerInvariantError(`settle_mark did not record ${reservationId}`);
    const stored = this.readReservationRow(reservationId);
    if (!stored || stored.state !== "settled" || stored.actualUnits === null) {
      throw new LedgerInvariantError(`settlement of ${reservationId} did not persist`);
    }
    return {
      ok: true,
      idempotent: false,
      reservationId,
      amountUnits: stored.amountUnits,
      actualUnits: stored.actualUnits,
      overrunUnits: stored.overrunUnits,
    };
  }

  private releaseInside(reservationId: string, mode: "held" | "unknown"): ReleaseResult {
    const row = this.readReservationRow(reservationId);
    if (!row) return { ok: false, reason: "missing" };
    if (mode === "held") {
      if (row.state === "unknown") return { ok: false, reason: "unknown_retained" };
      if (row.state === "released") return { ok: false, reason: "already_released" };
      if (row.state === "settled") return { ok: false, reason: "already_settled" };
      if (row.state !== "held") return { ok: false, reason: "not_held" };
    } else if (row.state !== "unknown") {
      return { ok: false, reason: "not_held" };
    } else {
      const flipped = changeCount(this.markHeldStmt.run(reservationId));
      if (flipped !== 1) {
        throw new LedgerInvariantError(`could not reopen unknown reservation ${reservationId} for release`);
      }
    }
    const scopes = this.countReservationScopes(reservationId);
    const changes = changeCount(this.releaseStmt.run({ reservation: reservationId }));
    if (changes !== scopes) {
      throw new LedgerInvariantError(
        `release updated ${changes} budget rows for ${reservationId}, expected ${scopes}`,
      );
    }
    const marked = changeCount(this.markReleasedStmt.run(reservationId));
    if (marked !== 1) {
      throw new LedgerInvariantError(`release did not mark reservation ${reservationId} released`);
    }
    return { ok: true, reservationId };
  }

  private insertScope(input: CreateBudgetScopeInput): BudgetScopeRecord {
    this.assertScope(input.scopeKind, input.scopeId);
    assertNonNegativeIntegerUnits(input.limitUnits);
    this.assertCurrencyRegistered(input.currency);
    const parentKind = input.parentKind ?? null;
    const parentId = input.parentId ?? null;
    if ((parentKind === null) !== (parentId === null)) {
      throw new LedgerInputError("parentKind and parentId must both be set or both be omitted");
    }
    if (input.scopeKind === "wave_paperwork" && !parseWaveScopeId(input.scopeId)) {
      throw new LedgerInputError("wave_paperwork scope_id must look like w:<ordinal>:<waveId>:<phase>");
    }
    if (parentKind !== null && parentId !== null) {
      if (parentKind === input.scopeKind && parentId === input.scopeId) {
        throw new LedgerCycleError(input.scopeKind, input.scopeId);
      }
      const parent = this.readScope(parentKind, parentId, input.currency);
      if (!parent) throw new MissingBudgetScopeError(parentKind, parentId, input.currency);
    }
    try {
      const changes = changeCount(
        this.insertBudgetStmt.run(
          input.scopeKind,
          input.scopeId,
          input.currency,
          input.limitUnits,
          parentKind,
          parentId,
        ),
      );
      if (changes !== 1) throw new LedgerInvariantError("budget insert did not write one row");
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: budgets/u.test(error.message)) {
        throw new BudgetScopeExistsError(input.scopeKind, input.scopeId, input.currency);
      }
      throw error;
    }
    return {
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      currency: input.currency,
      limitUnits: input.limitUnits,
      reservedUnits: 0,
      spentUnits: 0,
      closed: false,
      parentKind,
      parentId,
    };
  }

  private linkedScopes(input: ReserveAcrossScopesInput): BudgetScopeRecord[] {
    const chain: BudgetScopeRecord[] = [];
    const seen = new Set<string>();
    let kind: ScopeKind | null = input.scopeKind;
    let id: string | null = input.scopeId;
    while (kind !== null && id !== null) {
      const key = `${kind}\0${id}`;
      if (seen.has(key)) throw new LedgerCycleError(kind, id);
      seen.add(key);
      const row = this.readScope(kind, id, input.currency);
      if (!row) throw new MissingBudgetScopeError(kind, id, input.currency);
      chain.push(row);
      kind = row.parentKind;
      id = row.parentId;
    }
    for (const extra of input.additionalScopes ?? []) {
      this.assertScope(extra.scopeKind, extra.scopeId);
      const key = `${extra.scopeKind}\0${extra.scopeId}`;
      if (seen.has(key)) continue;
      const row = this.readScope(extra.scopeKind, extra.scopeId, input.currency);
      if (!row) throw new MissingBudgetScopeError(extra.scopeKind, extra.scopeId, input.currency);
      seen.add(key);
      chain.push(row);
    }
    if (chain.length === 0) throw new LedgerInputError("a reservation needs at least one scope");
    return chain;
  }

  private assertCrossWave(scopes: readonly ScopeRef[], input: ReserveAcrossScopesInput): void {
    if (input.purpose !== "paperwork" || input.activeWaveId === undefined) return;
    const wave = scopes.find((scope) => scope.scopeKind === "wave_paperwork");
    if (!wave) return;
    const target = parseWaveScopeId(wave.scopeId);
    if (!target) throw new LedgerInputError(`wave_paperwork scope ${wave.scopeId} is not an envelope id`);
    if (target.waveId === input.activeWaveId) return;
    const activeOrdinal = this.ordinalForWave(input.activeWaveId, input.currency);
    if (target.ordinal > activeOrdinal && input.crossWaveBorrowApproved !== true) {
      throw new CrossWaveBorrowError(input.activeWaveId, target.waveId);
    }
  }

  private ordinalForWave(waveId: string, currency: string): number {
    for (const envelope of this.envelopesForWave(waveId, currency).values()) {
      return envelope.ordinal;
    }
    throw new LedgerInputError(`Unknown paperwork wave ${waveId}`);
  }

  private envelopesForWave(waveId: string, currency: string): Map<PaperworkPhase, EnvelopeRow> {
    assertWaveId(waveId);
    this.assertCurrencyRegistered(currency);
    const found = new Map<PaperworkPhase, EnvelopeRow>();
    const rows = this.listWaveStmt.all(currency) as Record<string, SQLOutputValue>[];
    for (const row of rows) {
      const scopeId = readText(cell(row, "scope_id"), "scope_id");
      const parsed = parseWaveScopeId(scopeId);
      if (!parsed || parsed.waveId !== waveId) continue;
      if (found.has(parsed.phase)) {
        throw new LedgerInvariantError(`wave ${waveId} has two ${parsed.phase} envelopes`);
      }
      found.set(parsed.phase, {
        scopeId,
        phase: parsed.phase,
        ordinal: parsed.ordinal,
        limitUnits: readUnits(cell(row, "limit_units"), "limit_units"),
        reservedUnits: readUnits(cell(row, "reserved_units"), "reserved_units"),
        spentUnits: readUnits(cell(row, "spent_units"), "spent_units"),
      });
    }
    if (found.size === 0) throw new LedgerInputError(`Unknown paperwork wave ${waveId}`);
    return found;
  }

  private readScope(scopeKind: ScopeKind, scopeId: string, currency: string): BudgetScopeRecord | undefined {
    const row = this.readBudgetStmt.get(scopeKind, scopeId, currency) as
      | Record<string, SQLOutputValue>
      | undefined;
    if (!row) return undefined;
    const parentKindText = readNullableText(cell(row, "parent_kind"));
    const parentId = readNullableText(cell(row, "parent_id"));
    if ((parentKindText === null) !== (parentId === null)) {
      throw new LedgerInvariantError(`budget ${scopeKind}:${scopeId} has a partial parent link`);
    }
    if (parentKindText !== null) assertScopeKind(parentKindText);
    return {
      scopeKind,
      scopeId,
      currency,
      limitUnits: readUnits(cell(row, "limit_units"), "limit_units"),
      reservedUnits: readUnits(cell(row, "reserved_units"), "reserved_units"),
      spentUnits: readUnits(cell(row, "spent_units"), "spent_units"),
      closed: readUnits(cell(row, "closed"), "closed") === 1,
      parentKind: parentKindText,
      parentId,
    };
  }

  private readReservationRow(reservationId: string): ReservationRecord | null {
    const row = this.readReservationStmt.get(reservationId) as Record<string, SQLOutputValue> | undefined;
    if (!row) return null;
    const purpose = readText(cell(row, "purpose"), "purpose");
    if (!isPurpose(purpose)) throw new LedgerInvariantError(`reservation ${reservationId} has purpose ${purpose}`);
    const state = readText(cell(row, "state"), "state");
    if (!isReservationState(state)) {
      throw new LedgerInvariantError(`reservation ${reservationId} has state ${state}`);
    }
    const scopeRows = this.readReservationScopesStmt.all(reservationId) as Record<string, SQLOutputValue>[];
    const scopes = scopeRows.map((scope) => {
      const scopeKind = readText(cell(scope, "scope_kind"), "scope_kind");
      assertScopeKind(scopeKind);
      return { scopeKind, scopeId: readText(cell(scope, "scope_id"), "scope_id") };
    });
    return {
      reservationId,
      attemptId: readNullableText(cell(row, "attempt")),
      purpose,
      currency: readText(cell(row, "currency"), "currency"),
      amountUnits: readUnits(cell(row, "amount_units"), "amount_units"),
      state,
      actualUnits: readNullableUnits(cell(row, "actual_units"), "actual_units"),
      overrunUnits: readUnits(cell(row, "overrun_units"), "overrun_units"),
      createdAt: readSignedInteger(cell(row, "created_at"), "created_at"),
      settledAt: readNullableSignedInteger(cell(row, "settled_at"), "settled_at"),
      scopes,
    };
  }

  private countReservationScopes(reservationId: string): number {
    const row = this.countScopesStmt.get(reservationId) as Record<string, SQLOutputValue> | undefined;
    if (!row) return 0;
    return readUnits(cell(row, "n"), "scope count");
  }

  private readRegisteredCurrency(code: string): RegisteredCurrency {
    const row = this.readCurrencyStmt.get(code) as Record<string, SQLOutputValue> | undefined;
    if (!row) throw new CurrencyNotRegisteredError(code);
    return {
      code: readText(cell(row, "code"), "code"),
      unit: readText(cell(row, "unit"), "unit"),
      scale: readUnits(cell(row, "scale"), "scale"),
    };
  }

  private assertCurrencyRegistered(code: string): void {
    currencyDefinition(code);
    const row = this.readCurrencyStmt.get(code);
    if (!row) throw new CurrencyNotRegisteredError(code);
  }

  private assertReserveInput(input: ReserveAcrossScopesInput): void {
    this.assertId(input.reservationId);
    if (!isPurpose(input.purpose)) throw new LedgerInputError(`Unsupported reservation purpose ${input.purpose}`);
    assertNonNegativeIntegerUnits(input.amountUnits);
    if (input.amountUnits === 0) {
      throw new ReservationAmountError(0, "reservation amount_units must be greater than zero");
    }
    this.assertTimestamp(input.createdAt);
    this.assertScope(input.scopeKind, input.scopeId);
    if (input.attemptId !== undefined && input.attemptId.length === 0) {
      throw new LedgerInputError("attemptId cannot be empty");
    }
  }

  private assertId(reservationId: string): void {
    if (reservationId.trim().length === 0) throw new LedgerInputError("reservation id is required");
  }

  private assertScope(scopeKind: ScopeKind, scopeId: string): void {
    if (!(SCOPE_KINDS as readonly string[]).includes(scopeKind)) {
      throw new LedgerInputError(`Unsupported budget scope kind ${scopeKind}`);
    }
    if (scopeId.trim().length === 0) throw new LedgerInputError("scope id is required");
  }

  private assertTimestamp(value: number): void {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw new LedgerInputError("ledger timestamps must be safe integers");
    }
  }

  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      rollbackOuter(this.db);
      throw error;
    }
  }

  private rollbackSavepoint(original: unknown): void {
    try {
      this.db.exec("ROLLBACK TO ef_ledger_reserve");
      this.db.exec("RELEASE ef_ledger_reserve");
    } catch (rollbackError) {
      const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      if (/no such savepoint/iu.test(message)) return;
      throw new LedgerInvariantError(
        `reserve failed (${errorMessage(original)}) and savepoint rollback failed (${message})`,
      );
    }
  }
}

function currencyDefinition(code: string): { unit: string; scale: number } {
  if (code === "usd") return { unit: "micro-USD", scale: 1_000_000 };
  if (code === "slots:local") return { unit: "slot", scale: 1 };
  if (/^allowance:[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(code)) {
    return { unit: "ppm of window share", scale: 1_000_000 };
  }
  if (!CURRENCY_CODE.test(code)) {
    throw new LedgerInputError(
      "currency code must be usd, slots:local, or allowance:<connection>",
    );
  }
  throw new LedgerInputError(`Unsupported currency code ${code}`);
}

function waveEntries(waves: readonly WaveWeightInput[], upfrontWeight: number | undefined): WaveEntry[] {
  const entries: WaveEntry[] = [];
  if (upfrontWeight !== undefined) {
    if (!Number.isSafeInteger(upfrontWeight) || upfrontWeight <= 0) {
      throw new LedgerInputError("upfront paperwork weight must be a positive integer");
    }
    entries.push({ waveId: "upfront", weight: upfrontWeight, ordinal: 0 });
  }
  const seen = new Set(entries.map((entry) => entry.waveId));
  waves.forEach((wave, index) => {
    assertWaveId(wave.waveId);
    if (wave.waveId === "upfront") {
      throw new LedgerInputError("upfront is reserved as the paperwork wave id");
    }
    if (seen.has(wave.waveId)) throw new LedgerInputError(`duplicate paperwork wave ${wave.waveId}`);
    seen.add(wave.waveId);
    if (!Number.isSafeInteger(wave.weight) || wave.weight <= 0) {
      throw new LedgerInputError("paperwork wave weights must be positive integers");
    }
    entries.push({ waveId: wave.waveId, weight: wave.weight, ordinal: index + 1 });
  });
  if (entries.length === 0) {
    throw new LedgerInputError("paperwork envelopes need an upfront weight or at least one wave");
  }
  return entries;
}

function assertPurposeScopeBinding(purpose: ReservationPurpose, scopes: readonly ScopeRef[]): void {
  const waves = scopes.filter((scope) => scope.scopeKind === "wave_paperwork");
  if (purpose === "model_call" || purpose === "effect") {
    if (waves.length > 0) {
      throw new ScopeBindingError(`${purpose} reservations cannot draw from wave_paperwork scopes`);
    }
    return;
  }
  if (waves.length !== 1) {
    throw new ScopeBindingError(
      "paperwork reservations must draw from exactly one wave_paperwork envelope",
    );
  }
}

function blockingLabels(scopes: readonly BudgetScopeRecord[]): string[] {
  return scopes.map((scope) => {
    const duplicates = scopes.filter((item) => item.scopeKind === scope.scopeKind).length;
    return duplicates > 1 ? `${scope.scopeKind}:${scope.scopeId}` : scope.scopeKind;
  });
}

function isPurpose(value: string): value is ReservationPurpose {
  return (RESERVATION_PURPOSES as readonly string[]).includes(value);
}

function isReservationState(value: string): value is ReservationState {
  return value === "held" || value === "settled" || value === "released" || value === "unknown";
}

function reservationConstraint(error: unknown, reservationId: string): Error {
  if (error instanceof Error && /UNIQUE constraint failed: reservations\.id/u.test(error.message)) {
    return new ReservationExistsError(reservationId);
  }
  return error instanceof Error ? error : new LedgerInvariantError(String(error));
}

function rollbackOuter(db: LedgerSql): void {
  try {
    db.exec("ROLLBACK");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no transaction/iu.test(message)) throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readSignedInteger(value: SQLOutputValue, label: string): number {
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new LedgerInvariantError(`${label} is outside a safe integer`);
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new LedgerInvariantError(`${label} was not a safe integer`);
}

function readNullableSignedInteger(value: SQLOutputValue, label: string): number | null {
  if (value === null) return null;
  return readSignedInteger(value, label);
}
