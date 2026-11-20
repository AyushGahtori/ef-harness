import { DatabaseSync } from "node:sqlite";
import { formatReadinessHeadline } from "./headline.js";
import { collectForces, queryBlockers, queryCanonical, queryCounts } from "./sql.js";
import type { ClassedCriterion } from "./sql.js";
import { TransitivePrereqChecker } from "./transitive-prereq-checker.js";
import {
  dispositionOf,
  isReadyToPlan,
  type ReadinessAction,
  type ReadinessBlocker,
  type ReadinessDrilldown,
  type ReadinessPorts,
  type ReadinessReport,
} from "./types.js";

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

function drilldownFrom(rows: readonly ClassedCriterion[], prereqBlockers: readonly ReadinessBlocker[]): ReadinessDrilldown {
  const conflicts: ReadinessBlocker[] = [];
  const mustAsk: ReadinessBlocker[] = [];
  const openStandard: ReadinessBlocker[] = [];
  const pendingVerification: ReadinessBlocker[] = [];
  for (const row of rows) {
    const blocker = toBlocker(row);
    if (row.bucket === "conflict") conflicts.push(blocker);
    else if (row.bucket === "pending_verification") pendingVerification.push(blocker);
    else if (row.bucket === "open" && row.mustAsk) mustAsk.push(blocker);
    else if (row.bucket === "open") openStandard.push(blocker);
  }
  return {
    conflicts,
    mustAsk,
    openStandard,
    pendingVerification,
    blockedByPrereqScope: prereqBlockers,
  };
}

export class ReadinessCalculator {
  private readonly prereqs: TransitivePrereqChecker;

  constructor(
    private readonly db: DatabaseSync,
    private readonly ports: ReadinessPorts = {},
  ) {
    this.prereqs = new TransitivePrereqChecker(db, ports);
  }

  project(workItemId: string): ReadinessReport {
    return this.evaluate(workItemId, null);
  }

  scope(workItemId: string, scopeId: string): ReadinessReport {
    return this.evaluate(workItemId, scopeId);
  }

  private evaluate(workItemId: string, scopeId: string | null): ReadinessReport {
    const forces = collectForces(this.db, this.ports, workItemId, scopeId);
    const args = { workItemId, scopeId, forces };
    const counts = queryCounts(this.db, args);
    const canonical = queryCanonical(this.db, workItemId);
    const rows = queryBlockers(this.db, args);
    const prereq = scopeId
      ? this.prereqs.check(workItemId, scopeId)
      : this.prereqs.checkProject(workItemId);
    const ready = isReadyToPlan(counts, prereq.met);
    const disposition = dispositionOf(counts);
    const drilldown = drilldownFrom(rows, prereq.blockers);
    const actions: ReadinessAction[] = [];
    if (counts.pendingVerification > 0) {
      actions.push({
        kind: "retry_verification",
        label: "Retry verification",
        decisionIds: drilldown.pendingVerification.map((blocker) => blocker.decisionId),
      });
    }
    return {
      workItemId,
      scopeId,
      counts,
      canonical,
      transitivePrereqsMet: prereq.met,
      blockedByPrereq: prereq.blockedByPrereq,
      isReadyToPlan: ready,
      disposition,
      headline: formatReadinessHeadline({
        counts,
        disposition,
        transitivePrereqsMet: prereq.met,
        blockedByPrereq: prereq.blockedByPrereq,
      }),
      actions,
      drilldown,
    };
  }
}
