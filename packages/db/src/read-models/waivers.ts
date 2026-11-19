import { WaiverApprovalRequiredError } from "./errors.js";
import type { QueryCatalog } from "./query-catalog.js";
import type { ReadModelConnection } from "./sql.js";
import type { RecomputedRequirement, WaiverExposure } from "./types.js";
import { nullableText, requirementStatus, text } from "./values.js";

const RISK_RANK: Readonly<Record<string, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

interface WaiverDecision {
  readonly permitted: boolean;
  readonly detail: string;
}

export function listWaiverExposure(connection: ReadModelConnection): WaiverExposure[] {
  const rows = connection
    .prepare(
      `SELECT w.id, w.requirement_id, w.reason, w.approved_by, w.risk_max, r.risk AS requirement_risk
         FROM waivers w
         LEFT JOIN requirements r ON r.id = w.requirement_id
        ORDER BY w.requirement_id, w.id`,
    )
    .all();
  return rows.map((row) => {
    const approvedBy = nullableText(row.approved_by);
    const riskMax = nullableText(row.risk_max);
    const requirementRisk = nullableText(row.requirement_risk);
    const decision = waiverDecision({ requirementRisk, approvedBy, riskMax });
    return {
      id: text(row.id, "waiver id"),
      requirementId: text(row.requirement_id, "requirement_id"),
      reason: nullableText(row.reason),
      approvedBy,
      riskMax,
      requirementRisk,
      developerApproved: approvedBy !== null && approvedBy.trim().length > 0,
      coversRequirement: decision.permitted,
    };
  });
}

export function assertWaiversPermit(
  connection: ReadModelConnection,
  rows: readonly RecomputedRequirement[],
): void {
  const waived = rows.filter((row) => row.status === "waived");
  if (waived.length === 0) return;
  const byRequirement = new Map<string, WaiverExposure[]>();
  for (const waiver of listWaiverExposure(connection)) {
    const list = byRequirement.get(waiver.requirementId) ?? [];
    list.push(waiver);
    byRequirement.set(waiver.requirementId, list);
  }
  for (const row of waived) {
    const waivers = byRequirement.get(row.requirement) ?? [];
    if (waivers.length === 0) {
      throw new WaiverApprovalRequiredError(
        row.requirement,
        "no waiver exposes approved_by and risk_max",
      );
    }
    if (waivers.some((waiver) => waiver.coversRequirement)) continue;
    const detail = waivers
      .map((waiver) =>
        waiverDecision({
          requirementRisk: waiver.requirementRisk,
          approvedBy: waiver.approvedBy,
          riskMax: waiver.riskMax,
        }).detail,
      )
      .join("; ");
    throw new WaiverApprovalRequiredError(row.requirement, detail);
  }
}

export function loadRecomputed(catalog: QueryCatalog): RecomputedRequirement[] {
  return catalog.all("requirement_status_recompute").map((row) => ({
    requirement: text(row.requirement, "requirement"),
    feature: nullableText(row.feature),
    status: requirementStatus(row.status),
  }));
}

export function waiverDecision(input: {
  readonly requirementRisk: string | null;
  readonly approvedBy: string | null;
  readonly riskMax: string | null;
}): WaiverDecision {
  const approved = input.approvedBy !== null && input.approvedBy.trim().length > 0;
  const risk = normalizeRisk(input.requirementRisk);
  const ceiling = normalizeRisk(input.riskMax);
  const riskRank = risk === null ? undefined : RISK_RANK[risk];
  const ceilingRank = ceiling === null ? undefined : RISK_RANK[ceiling];
  if (ceiling !== null && ceilingRank === undefined) {
    return { permitted: false, detail: `risk_max ${ceiling} is not a known risk` };
  }
  if (riskRank !== undefined && ceilingRank !== undefined && riskRank > ceilingRank) {
    return {
      permitted: false,
      detail: `requirement risk ${risk ?? ""} exceeds waiver risk_max ${ceiling ?? ""}`,
    };
  }
  if (risk === "low") {
    return { permitted: true, detail: "low-risk requirement" };
  }
  if (!approved) {
    return {
      permitted: false,
      detail: `${risk ?? "unspecified"} risk requires developer approval in waivers.approved_by`,
    };
  }
  if (risk !== null && riskRank === undefined && ceiling !== null) {
    return {
      permitted: false,
      detail: `requirement risk ${risk} is unknown and cannot be checked against risk_max`,
    };
  }
  return { permitted: true, detail: "developer approval covers the requirement" };
}

function normalizeRisk(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}
