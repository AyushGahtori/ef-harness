import { DatabaseSync } from "node:sqlite";
import { ancestorScopeIds, collectForces, listFeatureIds, queryBlockers, queryCounts } from "./sql.js";
import type { ClassedCriterion } from "./sql.js";
import type { PrereqCheck, ReadinessBlocker, ReadinessPorts } from "./types.js";

function toBlocker(row: ClassedCriterion): ReadinessBlocker {
  return {
    decisionId: row.id,
    criterionId: row.criterionId,
    label: row.title,
    scopeId: row.scopeId,
    focus: {
      kind: row.bucket === "conflict" ? "conflict" : "question",
      targetId: row.id,
    },
  };
}

export class TransitivePrereqChecker {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ports: ReadinessPorts = {},
  ) {}

  check(workItemId: string, scopeId: string): PrereqCheck {
    const closure = ancestorScopeIds(this.db, scopeId);
    const cyclic = closure.includes(scopeId);
    const ancestors = closure.filter((id) => id !== scopeId);
    const blockedByPrereq: string[] = [];
    const blockers: ReadinessBlocker[] = [];
    for (const ancestor of ancestors) {
      const forces = collectForces(this.db, this.ports, workItemId, ancestor);
      const counts = queryCounts(this.db, { workItemId, scopeId: ancestor, forces });
      if (counts.blockingCount === 0) continue;
      blockedByPrereq.push(ancestor);
      const rows = queryBlockers(this.db, { workItemId, scopeId: ancestor, forces });
      for (const row of rows) {
        if (row.bucket === "partial" || row.bucket === "missing") continue;
        blockers.push(toBlocker(row));
      }
    }
    return {
      met: !cyclic && blockedByPrereq.length === 0,
      blockedByPrereq,
      blockers,
      cyclic,
    };
  }

  checkProject(workItemId: string): PrereqCheck {
    const blockedByPrereq: string[] = [];
    const blockers: ReadinessBlocker[] = [];
    let cyclic = false;
    for (const featureId of listFeatureIds(this.db, workItemId)) {
      const result = this.check(workItemId, featureId);
      if (result.cyclic) cyclic = true;
      if (result.met) continue;
      for (const scope of result.blockedByPrereq) {
        if (!blockedByPrereq.includes(scope)) blockedByPrereq.push(scope);
      }
      blockers.push(...result.blockers);
    }
    return {
      met: !cyclic && blockedByPrereq.length === 0,
      blockedByPrereq,
      blockers,
      cyclic,
    };
  }
}
