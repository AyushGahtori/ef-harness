import type {
  BudgetLedgerRepo,
  CodeIndexDb,
  GlobalBrokerDb,
  TelemetryDb,
} from "@ef-harness/db";
import type { PlanTask } from "../graph-compiler/index.js";
import type { FileRankSignal, ScopeKind } from "./types.js";

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

export interface CodeIndexRepoPort {
  fileRanksForCommit(commitSha: string): readonly FileRankSignal[];
}

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

export function bindGlobalDbRepo(broker: GlobalBrokerDb): GlobalDbRepoPort {
  return {
    listConnections(): readonly GlobalConnectionView[] {
      return broker.listConnections().map((record) => ({
        id: record.id,
        provider: record.provider,
        route: record.route,
        currency: record.currency,
        enabled: record.enabled,
      }));
    },
  };
}

export function bindTelemetryDbRepo(telemetry: TelemetryDb): TelemetryDbRepoPort {
  return {
    readPage(options): readonly TelemetryRecordView[] {
      return telemetry.readPage(options ?? {});
    },
  };
}

export function bindCodeIndexRepo(codeIndex: CodeIndexDb): CodeIndexRepoPort {
  return {
    fileRanksForCommit(commitSha: string): readonly FileRankSignal[] {
      return codeIndex.rankingForCommit(commitSha).map((row) => ({
        path: row.path,
        score: row.score,
      }));
    },
  };
}

export function bindBudgetLedgerRepo(ledger: BudgetLedgerRepo): BudgetLedgerPort {
  return {
    getBudgetRemaining(
      scopeKind: ScopeKind,
      scopeId: string,
    ): readonly BudgetRemainingView[] {
      return ledger.getBudgetRemaining(scopeKind, scopeId).map((row) => ({
        currency: row.currency,
        remainingUnits: row.remainingUnits,
        overrun: row.overrun,
      }));
    },
  };
}

export function graphTaskFromPlanTask(task: PlanTask): GraphCompilerTaskPort {
  return {
    id: task.id,
    title: task.title,
    primaryFiles: task.primaryFiles,
    mustBandTokens: task.mustBandTokens,
    touches: task.touches,
    implements: task.implements,
    obeys: task.obeys,
    createsMigration: task.createsMigration,
    migrationIntentSlot: task.migrationIntentSlot,
    mutatesSharedContract: task.mutatesSharedContract,
    taskKind: task.taskKind,
  };
}
