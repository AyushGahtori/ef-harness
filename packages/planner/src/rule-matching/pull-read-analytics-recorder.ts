import type { SearchReadDraft, SearchReadStore } from "./ports/search-reads-store.js";
import { toSearchReadRow } from "./ports/search-reads-store.js";
import type { TelemetrySink } from "./ports/telemetry-store.js";
import type { Clock, KbToolName, KnowledgeBand, PullCallContext, WorkerLevel } from "./types.js";

export interface DiagnosticWarning {
  readonly code: "TELEMETRY_DROPPED" | "SEARCH_READS_DROPPED";
  readonly message: string;
}

export interface PulledNodeFact {
  readonly nodeId: string;
  readonly band: KnowledgeBand;
  readonly tokenCost: number;
  readonly couldIndex: boolean;
}

export interface PullReadRecord {
  readonly attemptId: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly waveId: string;
  readonly waveIndex: number;
  readonly turnId: string;
  readonly taskTags: readonly string[];
  readonly toolName: KbToolName;
  readonly queriedNodeId: string | null;
  readonly pulledNodeIds: readonly string[];
  readonly pulledNodes: readonly PulledNodeFact[];
  readonly wasInCouldIndex: boolean;
  readonly wasNegativeMiss: boolean;
  readonly latencyMs: number;
  readonly workerLevel: WorkerLevel;
  readonly securityAnomaly: boolean;
  readonly budgetExceeded: boolean;
  readonly nodeTokenCost: number;
  readonly currentMustTokens: number;
  readonly currentBand: KnowledgeBand | null;
}

export interface PullAnalyticsDraft {
  readonly record: PullReadRecord;
  readonly searchRead?: SearchReadDraft;
}

const systemClock: Clock = { now: () => Date.now() };

/**
 * Writes every `kb.*` pull to telemetry and, for searches, to `search_reads`.
 * A telemetry outage is a warning. It never fails the live read.
 */
export class PullReadAnalyticsRecorder {
  private readonly clock: Clock;
  readonly pulls: PullReadRecord[] = [];
  readonly warnings: DiagnosticWarning[] = [];
  readonly anomalies: PullReadRecord[] = [];

  constructor(
    private readonly telemetry: TelemetrySink,
    private readonly searchReads: SearchReadStore,
    clock?: Clock,
  ) {
    this.clock = clock ?? systemClock;
  }

  now(): number {
    return this.clock.now();
  }

  record(draft: PullAnalyticsDraft): void {
    this.pulls.push(draft.record);
    if (draft.record.securityAnomaly) this.anomalies.push(draft.record);
    if (draft.searchRead) {
      try {
        this.searchReads.upsert(toSearchReadRow(draft.searchRead));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.warnings.push({
          code: "SEARCH_READS_DROPPED",
          message: `search_reads write failed: ${message}`,
        });
      }
    }
    try {
      this.telemetry.insert({
        attempt: draft.record.attemptId,
        ts: this.clock.now(),
        kind: draft.record.securityAnomaly ? "metric" : "tool",
        data: JSON.stringify(telemetryPayload(draft.record)),
      });
      if (draft.record.securityAnomaly) {
        this.telemetry.insert({
          attempt: draft.record.attemptId,
          ts: this.clock.now(),
          kind: "metric",
          data: JSON.stringify({
            metric: "security_anomaly",
            toolName: draft.record.toolName,
            queriedNodeId: draft.record.queriedNodeId,
            attemptId: draft.record.attemptId,
            taskId: draft.record.taskId,
          }),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warnings.push({
        code: "TELEMETRY_DROPPED",
        message: `telemetry.db is unavailable; dropped pull analytics without failing the read (${message})`,
      });
    }
  }
}

function telemetryPayload(record: PullReadRecord): Record<string, unknown> {
  return {
    attemptId: record.attemptId,
    taskId: record.taskId,
    taskTags: [...record.taskTags],
    toolName: record.toolName,
    queriedNodeId: record.queriedNodeId,
    wasInCouldIndex: record.wasInCouldIndex,
    wasNegativeMiss: record.wasNegativeMiss,
    latencyMs: record.latencyMs,
    projectId: record.projectId,
    waveId: record.waveId,
    waveIndex: record.waveIndex,
    turnId: record.turnId,
    pulledNodeIds: [...record.pulledNodeIds],
    pulledNodes: record.pulledNodes.map((node) => ({ ...node })),
    securityAnomaly: record.securityAnomaly,
    budgetExceeded: record.budgetExceeded,
    workerLevel: record.workerLevel,
    nodeTokenCost: record.nodeTokenCost,
    currentMustTokens: record.currentMustTokens,
    currentBand: record.currentBand,
  };
}

export function recordFromContext(
  ctx: PullCallContext,
  fields: Omit<
    PullReadRecord,
    | "attemptId"
    | "taskId"
    | "projectId"
    | "waveId"
    | "waveIndex"
    | "turnId"
    | "taskTags"
    | "workerLevel"
  >,
): PullReadRecord {
  return {
    attemptId: ctx.attemptId,
    taskId: ctx.taskId,
    projectId: ctx.projectId,
    waveId: ctx.waveId,
    waveIndex: ctx.waveIndex,
    turnId: ctx.turnId,
    taskTags: [...ctx.taskTags],
    workerLevel: ctx.workerLevel,
    ...fields,
  };
}
