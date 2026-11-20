import type { ReadModelConnection, ReadModelStatement } from "./sql.js";
import type { FeatureProgress, RequirementStatusName } from "./types.js";
import {
  compareText,
  emptyRequirementCounts,
  integer,
  nullableInteger,
  nullableText,
  requirementStatus,
  type SqlValue,
} from "./values.js";

const TASK_JOIN = `
SELECT f.feature AS runtime_feature,
       f.state AS feature_state,
       t.feature AS task_feature,
       t.state AS task_state,
       t.n AS task_n
  FROM feature_runtime f
  FULL OUTER JOIN rollup_feature_tasks t ON t.feature = f.feature
`;

interface MutableFeature {
  feature: string;
  featureState: string | null;
  taskCounts: Record<string, number>;
  requirementCounts: Record<RequirementStatusName, number>;
}

export class BoardReader {
  private readonly allTasks: ReadModelStatement;
  private readonly allRequirements: ReadModelStatement;
  private readonly oneTasks: ReadModelStatement;
  private readonly oneRequirements: ReadModelStatement;

  constructor(connection: ReadModelConnection) {
    this.allTasks = connection.prepare(TASK_JOIN);
    this.allRequirements = connection.prepare(
      "SELECT feature, status, n FROM rollup_feature_requirements",
    );
    this.oneTasks = connection.prepare(`${TASK_JOIN} WHERE coalesce(f.feature, t.feature) = ?`);
    this.oneRequirements = connection.prepare(
      "SELECT status, n FROM rollup_feature_requirements WHERE feature = ?",
    );
  }

  summary(): { features: FeatureProgress[]; readRows: number } {
    const buckets = new Map<string, MutableFeature>();
    let readRows = 0;
    for (const row of this.allTasks.all()) {
      readRows += 1;
      const feature = nullableText(row.runtime_feature) ?? nullableText(row.task_feature);
      if (feature === null) continue;
      const bucket = ensure(buckets, feature);
      const featureState = nullableText(row.feature_state);
      if (featureState !== null) bucket.featureState = featureState;
      const state = nullableText(row.task_state);
      const count = nullableInteger(row.task_n);
      if (state !== null && count !== null) bucket.taskCounts[state] = count;
    }
    for (const row of this.allRequirements.all()) {
      readRows += 1;
      const feature = textFeature(row.feature);
      const bucket = ensure(buckets, feature);
      bucket.requirementCounts[requirementStatus(row.status)] = integer(row.n, "n");
    }
    const features = [...buckets.values()]
      .sort((left, right) => compareFeature(left.feature, right.feature))
      .map(toProgress);
    return { features, readRows };
  }

  feature(feature: string): { progress: FeatureProgress; readRows: number } {
    const bucket = blank(feature);
    let readRows = 0;
    for (const row of this.oneTasks.all([feature])) {
      readRows += 1;
      const featureState = nullableText(row.feature_state);
      if (featureState !== null) bucket.featureState = featureState;
      const state = nullableText(row.task_state);
      const count = nullableInteger(row.task_n);
      if (state !== null && count !== null) bucket.taskCounts[state] = count;
    }
    for (const row of this.oneRequirements.all([feature])) {
      readRows += 1;
      bucket.requirementCounts[requirementStatus(row.status)] = integer(row.n, "n");
    }
    return { progress: toProgress(bucket), readRows };
  }
}

function ensure(buckets: Map<string, MutableFeature>, feature: string): MutableFeature {
  const existing = buckets.get(feature);
  if (existing) return existing;
  const created = blank(feature);
  buckets.set(feature, created);
  return created;
}

function blank(feature: string): MutableFeature {
  return {
    feature,
    featureState: null,
    taskCounts: {},
    requirementCounts: emptyRequirementCounts(),
  };
}

function toProgress(bucket: MutableFeature): FeatureProgress {
  const requirementTotal = sum(Object.values(bucket.requirementCounts));
  return {
    feature: bucket.feature,
    featureState: bucket.featureState,
    taskCounts: bucket.taskCounts,
    requirementCounts: bucket.requirementCounts,
    taskTotal: sum(Object.values(bucket.taskCounts)),
    requirementTotal,
    passing: bucket.requirementCounts.passing,
    waived: bucket.requirementCounts.waived,
    failing: bucket.requirementCounts.failing,
    pending: bucket.requirementCounts.pending,
    uncovered: bucket.requirementCounts.uncovered,
  };
}

function sum(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function textFeature(value: SqlValue | undefined): string {
  return nullableText(value) ?? "";
}

function compareFeature(left: string, right: string): number {
  if (left === right) return 0;
  if (left === "") return -1;
  if (right === "") return 1;
  return compareText(left, right);
}
