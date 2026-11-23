import type { SampleSummary } from "./stats.ts";

export const SCALE_BENCHMARK_SCORECARD_SCHEMA = "scale-benchmark-scorecard@1" as const;

export type SloId =
  | "slo-1-50-workers-db"
  | "slo-2-board-500-tasks"
  | "slo-3-300-entity-export"
  | "slo-4-200mb-migration"
  | "slo-5-16gb-laptop-ui"
  | "slo-6-startup-ipc";

export interface SloMetric {
  readonly sloId: SloId;
  readonly label: string;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly peakRamMb: number | null;
  readonly threshold: string;
  readonly passFail: "pass" | "fail";
  readonly detail: readonly string[];
  readonly extras?: Record<string, number | string | boolean>;
}

export interface ScaleBenchmarkScorecard {
  readonly schema: typeof SCALE_BENCHMARK_SCORECARD_SCHEMA;
  readonly generatedAt: string;
  readonly branch: string;
  readonly hardware: Record<string, string | number>;
  readonly metrics: readonly SloMetric[];
  readonly allPass: boolean;
}

export interface CertificationResult {
  readonly scorecard: ScaleBenchmarkScorecard;
  readonly markdown: string;
  readonly exitCode: number;
}

export type { SampleSummary };