import { ReadModelTransactionError } from "./errors.js";
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
  type ReadModelConnection,
} from "./sql.js";
import { assertTargetedSync, syncRequirementStatuses } from "./status-sync.js";
import type {
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
    readonly database: ReadModelConnection,
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

export function createReadModelRepo(
  database: ReadModelConnection,
  options: ReadModelOptions = {},
): ReadModelRepo {
  return new ReadModelRepo(database, options);
}

export function openReadModelRepo(options: OpenReadModelOptions = {}): ReadModelRepo {
  return createReadModelRepo(openReadModelDatabase(options), options);
}
