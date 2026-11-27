import { ReadModelHealError, ReadModelQueryError, ReadModelTransactionError } from "./errors.js";
import { BoardReader } from "./board.js";
import {
  alertDrift,
  confirmHealed,
  detectDrift,
  driftReport,
  healDrift,
  storedRevision,
} from "./drift.js";
import { readTraceabilityGaps } from "./gaps.js";
import { createReadModelLogger, type ReadModelLogger } from "./logger.js";
import { loadQueryCatalog, type QueryCatalog } from "./query-catalog.js";
import {
  openReadModelDatabase,
  readQueriesSql,
  type OpenReadModelDatabaseOptions,
  type ReadModelDatabase,
} from "./sql.js";
import { assertTargetedSync, syncRequirementStatuses } from "./status-sync.js";
import type {
  BoardSnapshotPage,
  BoardSummary,
  CanonicalReadModelQuery,
  DriftReport,
  FeatureProgress,
  RequirementStatusRow,
  RequirementStatusSyncRequest,
  RequirementStatusSyncResult,
  TraceabilityGaps,
  WaiverExposure,
} from "./types.js";
import { integer, nullableText, requirementStatus, text } from "./values.js";
import { listWaiverExposure } from "./waivers.js";

export interface ReadModelOptions {
  readonly logger?: ReadModelLogger;
  readonly queriesSql?: string;
}

export interface OpenReadModelOptions extends OpenReadModelDatabaseOptions, ReadModelOptions {}

export class ReadModelRepo {
  private readonly board: BoardReader;
  private readonly catalog: QueryCatalog;
  private readonly logger: ReadModelLogger;
  private closed = false;

  constructor(
    readonly database: ReadModelDatabase,
    options: ReadModelOptions = {},
  ) {
    this.logger = options.logger ?? createReadModelLogger();
    this.catalog = loadQueryCatalog(this.database, options.queriesSql ?? readQueriesSql());
    this.board = new BoardReader(this.database);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  transaction<T>(work: () => T): T {
    if (this.database.isTransaction) return work();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  getBoardSummary(): BoardSummary {
    return this.board.summary();
  }

  /**
   * Cursor page over the trigger-maintained board rollup.
   * `cursor` is the last feature id already returned. Rollup rows are the source; this does not `COUNT(*)` task facts.
   */
  getBoardSnapshot(cursor?: string, limit?: number): BoardSnapshotPage {
    const pageLimit = boardPageLimit(limit);
    const features = this.board.summary().features;
    const start = cursor === undefined ? 0 : indexAfterCursor(features, cursor);
    const page = features.slice(start, start + pageLimit);
    const last = page[page.length - 1];
    const more = start + page.length < features.length;
    if (!more || last === undefined) return { features: page, nextCursor: null };
    return { features: page, nextCursor: last.feature };
  }

  getFeatureRollups(): readonly FeatureProgress[] {
    return this.board.summary().features;
  }

  recomputeRollupsAndVerifyZeroDrift(): DriftReport {
    const report = this.runDriftCheckAndHeal();
    if (report.drifted && !report.healed) {
      throw new ReadModelHealError("rollup recompute left drift in place");
    }
    return report;
  }

  getFeatureProgress(feature: string): FeatureProgress {
    return this.board.feature(feature).progress;
  }

  syncRequirementStatusInTx(request: RequirementStatusSyncRequest): RequirementStatusSyncResult {
    this.assertInTransaction("syncRequirementStatusInTx");
    assertTargetedSync(request);
    return syncRequirementStatuses(this.database, this.catalog, request, this.resolveRev(request.updatedRev));
  }

  syncRequirementStatusForChecks(
    request: RequirementStatusSyncRequest,
  ): RequirementStatusSyncResult {
    assertTargetedSync(request);
    return this.transaction(() => this.syncRequirementStatusInTx(request));
  }

  recomputeAllRequirementStatuses(updatedRev?: number): RequirementStatusSyncResult {
    return this.transaction(() => {
      this.assertInTransaction("recomputeAllRequirementStatuses");
      return syncRequirementStatuses(
        this.database,
        this.catalog,
        { all: true },
        this.resolveRev(updatedRev),
      );
    });
  }

  runDriftCheckAndHeal(): DriftReport {
    return this.transaction(() => {
      const snapshot = detectDrift(this.database, this.catalog);
      const report = driftReport(snapshot, false);
      if (!report.drifted) return report;
      alertDrift(this.logger, snapshot);
      healDrift(this.database, this.catalog, snapshot, this.resolveRev(undefined));
      confirmHealed(this.database, this.catalog);
      return driftReport(snapshot, true);
    });
  }

  getTraceabilityGaps(): TraceabilityGaps {
    return readTraceabilityGaps(this.catalog);
  }

  getRequirementStatus(requirement: string): RequirementStatusRow | null {
    const row = this.database
      .prepare(
        "SELECT requirement, feature, status, updated_rev FROM requirement_status WHERE requirement = ?",
      )
      .get([requirement]);
    if (!row) return null;
    return {
      requirement: text(row.requirement, "requirement"),
      feature: nullableText(row.feature),
      status: requirementStatus(row.status),
      updatedRev: integer(row.updated_rev, "updated_rev"),
    };
  }

  listWaivers(): readonly WaiverExposure[] {
    return listWaiverExposure(this.database);
  }

  canonicalQuery(name: CanonicalReadModelQuery): string {
    return this.catalog.sql(name);
  }

  private resolveRev(updatedRev: number | undefined): number {
    return updatedRev === undefined ? storedRevision(this.database) : updatedRev;
  }

  private assertInTransaction(method: string): void {
    if (!this.database.isTransaction) {
      throw new ReadModelTransactionError(`${method} must run inside BEGIN IMMEDIATE`);
    }
  }

  private rollback(): void {
    if (!this.database.isTransaction) return;
    this.database.exec("ROLLBACK");
  }
}

function boardPageLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new ReadModelQueryError("board snapshot limit must be an integer from 1 to 1000");
  }
  return limit;
}

function indexAfterCursor(features: readonly FeatureProgress[], cursor: string): number {
  const index = features.findIndex((row) => row.feature === cursor);
  if (index < 0) return features.length;
  return index + 1;
}

export function createReadModelRepo(
  database: ReadModelDatabase,
  options: ReadModelOptions = {},
): ReadModelRepo {
  return new ReadModelRepo(database, options);
}

export function openReadModelRepo(options: OpenReadModelOptions = {}): ReadModelRepo {
  return createReadModelRepo(openReadModelDatabase(options), options);
}
