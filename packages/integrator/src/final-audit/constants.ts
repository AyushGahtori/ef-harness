export const MAX_FIX_ROUNDS = 2;
export const FIX_BUDGET_PERCENT = 10n;
export const AUDIT_BUDGET_PERCENT = 2n;
export const PAPERWORK_CAP_PERCENT = 20n;
export const MAX_SHARD_TOKENS = 6_000;
export const DEFAULT_SHARD_CONCURRENCY = 4;
export const INTEGRATION_REF = "harness/integration" as const;
export const VIEWPORTS = [375, 1440] as const;
export const OPTIONAL_FOLLOW_UPS = "Optional Follow-Ups";
export const GREEN_VERDICT = "Green — Ready to Land";
export const RESIDUAL_CHOICES = ["Land as-is", "Fix manually", "Allocate extra fix budget"] as const;

export const CROSS_CUTTING_RULE_IDS = [
  "X-01",
  "X-02",
  "X-03",
  "X-04",
  "X-05",
  "X-06",
  "X-07",
  "X-08",
  "X-09",
  "X-10",
  "X-11",
  "X-12",
  "X-13",
  "X-14",
] as const;

export type CrossCuttingRuleId = (typeof CROSS_CUTTING_RULE_IDS)[number];
export type ViewportWidth = (typeof VIEWPORTS)[number];
export type ResidualChoice = (typeof RESIDUAL_CHOICES)[number];

const RULE_SET = new Set<string>(CROSS_CUTTING_RULE_IDS);

export function isCrossCuttingRuleId(value: string): value is CrossCuttingRuleId {
  return RULE_SET.has(value);
}

export function needsReviewVerdict(count: number): string {
  return `Needs Your Review (${count} unresolved findings)`;
}

export function percentOf(total: bigint, percent: bigint): bigint {
  if (total < 0n || percent < 0n) {
    throw new Error("budget percent inputs must be non-negative");
  }
  return (total * percent) / 100n;
}

export function auditScopeId(projectId: string): string {
  return `${projectId}:final-audit`;
}

export function fixScopeId(projectId: string): string {
  return `${projectId}:audit-fix`;
}
