import { formatCost, percentLabel } from "./money.js";
import {
  type BlockReason,
  type CostCurrency,
  type RiskTag,
  type WorkerLevel,
  levelLabel,
} from "./types.js";

export interface RationaleInput {
  readonly status: "assigned" | "blocked";
  readonly level: WorkerLevel | null;
  readonly currency: CostCurrency;
  readonly expectedCost: bigint;
  readonly passProbability: number;
  readonly blockReason: BlockReason | null;
  readonly touches: readonly RiskTag[];
  readonly safetyFloor: boolean;
  readonly retryRiskLevel: WorkerLevel | null;
  readonly criticalPathBoost: boolean;
  readonly escalated: boolean;
  readonly singleModelMode: boolean;
  readonly crossFamily: boolean;
  readonly diversityRelaxed: boolean;
  readonly floorHeld: boolean;
  readonly budgetShortfall: boolean;
}

const BLOCK_LABEL: Readonly<Record<BlockReason, string>> = {
  no_eligible_model: "no eligible model",
  capability_unavailable: "capability unavailable",
  paid_fallback_not_approved: "paid fallback not approved",
  currency_pool_empty: "currency pool empty",
};

function blockLabel(reason: BlockReason | null): string {
  if (reason === null) return "no eligible model";
  switch (reason) {
    case "no_eligible_model":
      return BLOCK_LABEL.no_eligible_model;
    case "capability_unavailable":
      return BLOCK_LABEL.capability_unavailable;
    case "paid_fallback_not_approved":
      return BLOCK_LABEL.paid_fallback_not_approved;
    case "currency_pool_empty":
      return BLOCK_LABEL.currency_pool_empty;
  }
}

export function buildRationale(input: RationaleInput): string {
  const clauses: string[] = [];
  if (input.touches.length > 0) clauses.push(`touches ${input.touches.join(" + ")}`);
  if (input.safetyFloor) clauses.push("safety floor");
  if (input.retryRiskLevel !== null) {
    clauses.push(
      `${levelLabel(input.retryRiskLevel)} expected cost higher due to retry risk`,
    );
  }
  if (input.criticalPathBoost) {
    clauses.push("critical path prefers higher first-pass probability");
  }
  if (input.escalated) clauses.push("escalated after Hint 2");
  if (input.singleModelMode) clauses.push("single_model_mode");
  if (input.crossFamily) clauses.push("different model family from the build worker");
  if (input.diversityRelaxed) clauses.push("safety floor kept the build worker family");
  if (!input.floorHeld && input.status === "assigned") {
    clauses.push("safety floor has no stronger connected model");
  }
  if (input.budgetShortfall) clauses.push("expected cost exceeds remaining budget");
  const because =
    clauses.length > 0 ? clauses.join("; ") : "lowest expected cost including retries";
  if (input.status === "blocked" || input.level === null) {
    const detail = clauses.length > 0 ? because : "no authorized model in the chosen currency pool";
    return `Blocked (${blockLabel(input.blockReason)}) — ${detail}`;
  }
  const cost = formatCost(input.currency, input.expectedCost);
  const percent = percentLabel(input.passProbability);
  return `Assigned ${levelLabel(input.level)} (est. ${cost}, ${percent} 1st-pass) — ${because}`;
}
