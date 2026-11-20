import type { FileRankSignal, ScopeKind } from "./types.js";

/**
 * Local port for Task 023 `BudgetLedgerRepo.getBudgetRemaining`.
 * Sibling branch `task/023-budget-reservation-ledger` is not merged into this base.
 * `currency` is `usd` or `allowance:<connectionId>`. Units are integers.
 */
export interface BudgetRemainingView {
  readonly currency: string;
  readonly remainingUnits: number | bigint;
  readonly overrun: boolean;
}

export interface BudgetLedgerPort {
  getBudgetRemaining(
    scopeKind: ScopeKind,
    scopeId: string,
  ): readonly BudgetRemainingView[];
}

/**
 * Local port for Task 014 `GlobalBrokerDb` connections.
 * The foundation broker exposes `getConnection(id)` and not a list method.
 * Integrators adapt a connection query onto `listConnections`.
 */
export interface GlobalConnectionView {
  readonly id: string;
  readonly provider: string;
  readonly route: string;
  readonly currency: string;
  readonly enabled: boolean;
}

export interface GlobalDbRepoPort {
  listConnections(): readonly GlobalConnectionView[];
}

/**
 * Local port for Task 014 `TelemetryDb.readPage`.
 * Pass outcomes ride in `metric` rows. The calibrator does not parse other kinds.
 */
export interface TelemetryRecordView {
  readonly kind: string;
  readonly data: unknown;
}

export interface TelemetryDbRepoPort {
  readPage(options?: {
    readonly limit?: number;
    readonly afterId?: number;
  }): readonly TelemetryRecordView[];
}

/**
 * Local port for Task 167 `file_rank` (`code-index.db`: commit, path, score).
 * Task 014's `CodeIndexDb` stores the same row shape once that package is wired.
 */
export interface CodeIndexRepoPort {
  fileRanksForCommit(commitSha: string): readonly FileRankSignal[];
}

/**
 * Local port for a compiled task produced by Task 092 `DeterministicGraphCompiler`.
 * Field names follow that task's `PlanTask` so the adapter can be swapped for the
 * real compiler output without a package dependency on this base.
 */
export interface GraphCompilerTaskPort {
  readonly id: string;
  readonly title?: string;
  readonly primaryFiles?: readonly string[];
  readonly mustBandTokens?: number;
  readonly touches?: readonly string[];
  readonly implements?: readonly string[];
  readonly obeys?: readonly string[];
  readonly createsMigration?: boolean;
  readonly migrationIntentSlot?: string | null;
  readonly mutatesSharedContract?: boolean;
  readonly taskKind?: string;
  readonly roleId?: string | null;
}

export interface BudgetScopeRef {
  readonly scopeKind: ScopeKind;
  readonly scopeId: string;
}
