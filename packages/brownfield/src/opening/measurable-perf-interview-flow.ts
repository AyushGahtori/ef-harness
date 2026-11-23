import type { SqlExplainPort, TimingBenchmarkPort } from "./contracts.js";
import type {
  PerfBaselineCapture,
  PerfInterviewState,
  PerfSurfaceSpec,
  PerfTargetThreshold,
  SqlExplainFinding,
} from "./types.js";

export interface PerfInterviewDeps {
  readonly explain: SqlExplainPort;
  readonly benchmark: TimingBenchmarkPort;
}

export interface PerfInterviewCaptureInput {
  readonly workItemId: string;
  readonly query: string;
  readonly queryParams?: readonly unknown[];
  readonly engine?: "sqlite" | "postgres";
}

function parseSqliteExplain(lines: readonly string[]): readonly SqlExplainFinding[] {
  const findings: SqlExplainFinding[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const seq = /SCAN\s+TABLE/i.test(trimmed);
    const indexMatch = /USING\s+(?:COVERING\s+)?INDEX\s+(\S+)/i.exec(trimmed);
    findings.push({
      planLine: trimmed,
      usesSequentialScan: seq,
      indexName: indexMatch?.[1] ?? null,
    });
  }
  return findings;
}

export class SqliteExplainAnalyzeRunner implements SqlExplainPort {
  constructor(
    private readonly db: {
      prepare(sql: string): { all(): readonly { readonly [key: string]: unknown }[] };
    },
  ) {}

  explainAnalyze(query: string): PerfBaselineCapture {
    const rows = this.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all();
    const lines = rows.map((r) => String(r.detail ?? r.plan ?? JSON.stringify(r)));
    return {
      timingMsP95: 0,
      explain: parseSqliteExplain(lines),
      capturedAtMs: Date.now(),
      engine: "sqlite",
    };
  }
}

export class MeasurablePerfInterviewFlow {
  private readonly states = new Map<string, PerfInterviewState>();

  constructor(private readonly deps: PerfInterviewDeps) {}

  getState(workItemId: string): PerfInterviewState | undefined {
    return this.states.get(workItemId);
  }

  start(workItemId: string): PerfInterviewState {
    const state: PerfInterviewState = {
      workItemId,
      surface: null,
      baseline: null,
      target: null,
      phase: "needs_surface",
      readyForPlanning: false,
    };
    this.states.set(workItemId, state);
    return state;
  }

  setSurface(workItemId: string, surface: PerfSurfaceSpec): PerfInterviewState {
    const current = this.require(workItemId);
    const next: PerfInterviewState = {
      ...current,
      surface,
      phase: "needs_baseline",
    };
    this.states.set(workItemId, next);
    return next;
  }

  captureBaseline(input: PerfInterviewCaptureInput): PerfInterviewState {
    const current = this.require(input.workItemId);
    if (!current.surface) {
      throw new Error("perf interview needs surface before baseline");
    }
    const explain = this.deps.explain.explainAnalyze(input.query, input.queryParams);
    const p95 = this.deps.benchmark.measureP95(current.surface);
    const baseline: PerfBaselineCapture = {
      ...explain,
      timingMsP95: p95,
    };
    const next: PerfInterviewState = {
      ...current,
      baseline,
      phase: "needs_target",
    };
    this.states.set(input.workItemId, next);
    return next;
  }

  setTarget(workItemId: string, target: PerfTargetThreshold): PerfInterviewState {
    const current = this.require(workItemId);
    if (!current.baseline) {
      throw new Error("perf interview needs baseline before target");
    }
    this.assertMeasurableTarget(current.baseline, target);
    const next: PerfInterviewState = {
      ...current,
      target,
      phase: "complete",
      readyForPlanning: true,
    };
    this.states.set(workItemId, next);
    return next;
  }

  assertMeasurableTarget(baseline: PerfBaselineCapture, target: PerfTargetThreshold): void {
    if (!Number.isFinite(target.maxP95Ms) || target.maxP95Ms <= 0) {
      throw new Error("perf target requires a positive numeric p95 threshold");
    }
    if (baseline.timingMsP95 > 0 && target.maxP95Ms >= baseline.timingMsP95) {
      throw new Error("perf target must improve on measured baseline p95");
    }
    const seqOnOrders = baseline.explain.some(
      (e) => e.usesSequentialScan && /orders/i.test(e.planLine),
    );
    if (seqOnOrders && target.forbidSequentialScanOn && !target.requiredIndexScan) {
      throw new Error("perf target must require an index scan when baseline uses sequential scan");
    }
  }

  rejectVaguePerfRequest(userText: string): boolean {
    return /\b(faster|snappier|feel)\b/i.test(userText) && !/\b(\d+\s*ms|p\d+|explain|query|endpoint|\/api\/)/i.test(userText);
  }

  private require(workItemId: string): PerfInterviewState {
    const state = this.states.get(workItemId);
    if (!state) {
      throw new Error(`unknown perf interview work item ${workItemId}`);
    }
    return state;
  }
}