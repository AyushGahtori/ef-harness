import {
  INTEGRATION_REF,
  REQUIREMENT_KINDS_FOR_DONE,
  TASK_SETTLED_STATES,
  type DoneConditionId,
} from "./constants.js";
import type { DoneSnapshot, FeatureDoneCheckResult, FeatureDoneEvidenceInput } from "./types.js";

const SETTLED = new Set<string>(TASK_SETTLED_STATES);
const REQUIREMENT_KINDS = new Set<string>(REQUIREMENT_KINDS_FOR_DONE);

function coversScope(scopePrefix: string, auditedPaths: readonly string[]): boolean {
  return auditedPaths.some(
    (audited) => audited === scopePrefix || audited.startsWith(scopePrefix) || scopePrefix.startsWith(audited),
  );
}

/**
 * Local port of Task 022 `verifyFeatureDoneConditions`.
 * All seven conditions must hold together. Failed ids are `"1"` through `"7"`.
 */
export function verifyFeatureDoneConditions(
  evidence: FeatureDoneEvidenceInput,
  snapshot: DoneSnapshot,
): FeatureDoneCheckResult {
  const failed = new Set<DoneConditionId>();
  const failingRequirements: string[] = [];
  const blockingCcrIds = [...snapshot.openCcrIds];

  if (!conditionTasks(snapshot)) failed.add("1");
  for (const requirement of snapshot.requirements) {
    if (!REQUIREMENT_KINDS.has(requirement.kind)) continue;
    if (requirement.status === "passing" || requirement.status === "waived") continue;
    failingRequirements.push(requirement.id);
  }
  if (failingRequirements.length > 0) failed.add("2");
  if (!conditionStaticAudit(evidence, snapshot)) failed.add("3");
  if (!conditionJourney(evidence, snapshot)) failed.add("4");
  if (!conditionIntegration(evidence, snapshot)) failed.add("5");
  if (!conditionAccessibility(evidence, snapshot)) failed.add("6");
  if (blockingCcrIds.length > 0) failed.add("7");

  const failedConditions = [...failed].sort() as DoneConditionId[];
  return {
    ok: failedConditions.length === 0,
    failedConditions,
    blockingCcrIds,
    failingRequirements,
  };
}

function conditionTasks(snapshot: DoneSnapshot): boolean {
  if (snapshot.tasks.length === 0) return false;
  for (const task of snapshot.tasks) {
    if (!SETTLED.has(task.state)) return false;
    if (task.state !== "MERGED_TO_FEATURE") continue;
    if (task.briefVersion !== task.acceptedBriefVersion) return false;
    for (const contract of task.contracts) {
      if (contract.pin !== contract.currentVersion) return false;
    }
  }
  return true;
}

function conditionStaticAudit(evidence: FeatureDoneEvidenceInput, snapshot: DoneSnapshot): boolean {
  const audit = evidence.staticAudit;
  if (!audit.clean || !audit.integratorCommitsIncluded || audit.paths.length === 0) return false;
  for (const scope of snapshot.scopes) {
    if (!coversScope(scope, audit.paths)) return false;
  }
  for (const check of snapshot.checks) {
    if (check.gate !== "static_audit") continue;
    if (check.status !== "pass") return false;
  }
  return true;
}

function conditionJourney(evidence: FeatureDoneEvidenceInput, snapshot: DoneSnapshot): boolean {
  const journey = evidence.journey;
  if (!journey.passed || !journey.cleanEnvironment || journey.entryPoint.trim().length === 0) return false;
  const journeys = snapshot.checks.filter((check) => check.gate === "feature_journey");
  if (journeys.length === 0) return false;
  return journeys.every((check) => check.status === "pass");
}

function conditionIntegration(evidence: FeatureDoneEvidenceInput, snapshot: DoneSnapshot): boolean {
  const merge = evidence.integrationMerge;
  if (merge.ref !== INTEGRATION_REF) return false;
  if (merge.mergeCommit.trim().length === 0) return false;
  if (merge.earlierDoneRegressionGreen !== true) return false;
  const covered = new Set(merge.regressedFeatureIds);
  for (const featureId of snapshot.earlierDoneFeatureIds) {
    if (!covered.has(featureId)) return false;
  }
  return true;
}

function conditionAccessibility(evidence: FeatureDoneEvidenceInput, snapshot: DoneSnapshot): boolean {
  if (!snapshot.screenBearing) return true;
  return evidence.accessibility.seriousFindingIds.length === 0;
}
