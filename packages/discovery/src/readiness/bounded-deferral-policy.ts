import { DatabaseSync } from "node:sqlite";
import { withImmediateTransaction, writeNodeFields } from "./graph.js";
import { dependentScopeTitles, queryCounts, queryDeferred, queryOneCriterion, sqlNumber } from "./sql.js";
import type { ClassedCriterion } from "./sql.js";
import {
  DEFERRAL_BUDGET_PERCENT,
  deferralWithinBudget,
  emptyForces,
  formatRequiredBy,
  type DeferredCriterion,
  type DeferralResult,
  type ProjectStage,
  type ReadinessPorts,
} from "./types.js";

function toDeferred(row: ClassedCriterion): DeferredCriterion {
  return {
    decisionId: row.id,
    criterionId: row.criterionId,
    label: row.title,
    scopeId: row.scopeId,
    deferredReason: row.deferredReason,
    revisitWave: row.revisitWave,
  };
}

export class BoundedDeferralPolicy {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ports: ReadinessPorts = {},
  ) {}

  defer(input: {
    workItemId: string;
    decisionId: string;
    deferredReason: string;
    revisitWave: string;
    stage?: ProjectStage;
  }): DeferralResult {
    return withImmediateTransaction(this.db, () => {
      const forces = emptyForces();
      const args = { workItemId: input.workItemId, scopeId: null, forces };
      const row = queryOneCriterion(this.db, args, input.decisionId);
      if (!row) {
        return { ok: false as const, reason: `Criterion is not in the active scope (${input.decisionId})` };
      }
      if (row.bucket === "deferred") {
        return { ok: true as const, alreadyDeferred: true, deferred: toDeferred(row) };
      }
      if (row.mustAsk) {
        return {
          ok: false as const,
          reason: `Cannot defer a must-ask criterion (${row.criterionId})`,
        };
      }
      if (row.bucket === "conflict") {
        return { ok: false as const, reason: `Cannot defer an active conflict (${row.criterionId})` };
      }
      const requiredBy = dependentScopeTitles(this.db, input.decisionId);
      if (requiredBy.length > 0) {
        return { ok: false as const, reason: formatRequiredBy(requiredBy) };
      }
      if (row.bucket !== "open") {
        return {
          ok: false as const,
          reason: `Only optional open criteria can be deferred (${row.criterionId})`,
        };
      }
      const stage = this.resolveStage(input.workItemId, input.stage);
      const percent = DEFERRAL_BUDGET_PERCENT[stage];
      const counts = queryCounts(this.db, args);
      const deferredAfter = sqlNumber(
        this.db,
        "SELECT :deferred + 1 AS deferred_after",
        { deferred: counts.deferred },
        "deferred_after",
      );
      if (!deferralWithinBudget(deferredAfter, counts.nonMustAskPool, percent)) {
        return {
          ok: false as const,
          reason: `Deferral exceeds the ${stage} safe budget (${percent}% of non-must-ask criteria)`,
        };
      }
      writeNodeFields(this.db, this.ports, {
        nodeId: input.decisionId,
        summary: `defer ${row.criterionId}`,
        patch: {
          status: "deferred",
          deferred_reason: input.deferredReason,
          revisit_wave: input.revisitWave,
        },
      });
      const updated = queryOneCriterion(this.db, args, input.decisionId);
      if (!updated) {
        return { ok: false as const, reason: `Criterion disappeared during deferral (${input.decisionId})` };
      }
      return { ok: true as const, alreadyDeferred: false, deferred: toDeferred(updated) };
    });
  }

  /** Plan Preview reads this list. Deferred items stay visible and out of the settled counters. */
  listDeferred(workItemId: string): DeferredCriterion[] {
    return queryDeferred(this.db, {
      workItemId,
      scopeId: null,
      forces: emptyForces(),
    }).map((row) => toDeferred(row));
  }

  private resolveStage(workItemId: string, explicit: ProjectStage | undefined): ProjectStage {
    if (explicit) return explicit;
    const stagePort = this.ports.stage;
    if (stagePort) return stagePort.getStage(workItemId);
    const value = this.db
      .prepare(
        `SELECT fields ->> '$.stage' AS stage
           FROM nodes
          WHERE fields ->> '$.workItem' = ?
            AND fields ->> '$.stage' IN ('prototype', 'mvp', 'production')
          LIMIT 1`,
      )
      .get(workItemId);
    if (value && typeof value === "object") {
      const stage = (value as Record<string, unknown>).stage;
      if (stage === "prototype" || stage === "mvp" || stage === "production") return stage;
    }
    return "mvp";
  }
}
