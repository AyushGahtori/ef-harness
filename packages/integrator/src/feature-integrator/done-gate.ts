import { INTEGRATION_REF as DB_INTEGRATION_REF, type FeatureDoneEvidenceInput as DbFeatureDoneEvidenceInput } from "@ef-harness/db";
import type { DoneConditionId } from "./constants.js";
import type { FeatureDoneCheckResult, FeatureDoneEvidenceInput } from "./types.js";

const SETTLED = new Set(["MERGED_TO_FEATURE", "CANCELLED", "SUPERSEDED"]);

/**
 * Evaluates all seven DONE conditions on an in-memory evidence bundle.
 * When persisted to `ProjectStateDb`, `bindLifecycleRepo` converts this bundle to `DbFeatureDoneEvidenceInput`
 * and runs canonical `LifecycleRepo` (`evaluateFeatureDoneConditions`) against `state.db`.
 */
export function verifyFeatureDoneConditions(evidence: FeatureDoneEvidenceInput): FeatureDoneCheckResult {
  const failed: DoneConditionId[] = [];
  const tasksSettled =
    evidence.tasks.length > 0 &&
    evidence.tasks.every(
      (task) =>
        SETTLED.has(task.state) &&
        task.briefVersion === task.currentBriefVersion &&
        task.contractVersion === task.currentContractVersion,
    );
  if (!tasksSettled) failed.push("1");

  const requirementsCovered = evidence.requirements.every(
    (requirement) => requirement.checkStatus === "pass" || requirement.waiverApproved,
  );
  if (!requirementsCovered) failed.push("2");

  if (!evidence.staticAuditClean) failed.push("3");
  if (!evidence.journeyPassedInCleanEnv) failed.push("4");
  if (!evidence.mergedOntoIntegration || !evidence.earlierDoneRegressionsPassed) failed.push("5");
  if (evidence.hasScreens && (!evidence.accessibilityClean || !evidence.layoutClean)) failed.push("6");
  if (evidence.openContractChangeRequestIds.length > 0) failed.push("7");

  return { ok: failed.length === 0, failedConditions: failed };
}

/** Converts integrator DONE evidence to the canonical `@ef-harness/db` `FeatureDoneEvidenceInput`. */
export function toDbFeatureDoneEvidence(
  featureId: string,
  evidence: FeatureDoneEvidenceInput,
): DbFeatureDoneEvidenceInput {
  const seriousFindingIds = [
    ...(evidence.seriousAccessibilityFindingIds ?? []),
    ...(!evidence.accessibilityClean && (evidence.seriousAccessibilityFindingIds?.length ?? 0) === 0
      ? ["a11y-violation"]
      : []),
    ...(!evidence.layoutClean ? ["layout-violation"] : []),
  ];
  return {
    feature: featureId,
    staticAudit: {
      clean: evidence.staticAuditClean,
      integratorCommitsIncluded: evidence.staticAuditClean,
      paths: evidence.auditedPaths ?? [],
    },
    journey: {
      passed: evidence.journeyPassedInCleanEnv,
      entryPoint: evidence.journeyEntryPoint ?? "/",
      cleanEnvironment: evidence.journeyPassedInCleanEnv,
    },
    integrationMerge: {
      ref: DB_INTEGRATION_REF,
      mergeCommit: evidence.integrationMergeCommit ?? "",
      earlierDoneRegressionGreen: evidence.earlierDoneRegressionsPassed,
      regressedFeatureIds: evidence.regressedFeatureIds ?? [],
    },
    accessibility: {
      seriousFindingIds,
    },
  };
}
