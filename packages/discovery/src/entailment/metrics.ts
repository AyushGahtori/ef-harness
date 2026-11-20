import type { MetricVerdict } from "./types.js";

/** One row Meta-Lab (Task 191) can use to spot correlated false confirmations. */
export interface EntailmentCorrelationMetric {
  readonly resolverModel: string;
  readonly entailmentModel: string;
  readonly verdict: MetricVerdict;
  readonly criterionKind: string;
}

export interface EntailmentMetricSink {
  record(metric: EntailmentCorrelationMetric): void;
}

export class MemoryEntailmentMetrics implements EntailmentMetricSink {
  readonly records: EntailmentCorrelationMetric[] = [];

  record(metric: EntailmentCorrelationMetric): void {
    this.records.push(metric);
  }
}
