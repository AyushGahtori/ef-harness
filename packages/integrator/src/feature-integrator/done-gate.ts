import type { DoneConditionId } from "./constants.js";
import type { FeatureDoneCheckResult, FeatureDoneEvidenceInput } from "./types.js";

const SETTLED = new Set(["MERGED_TO_FEATURE", "CANCELLED", "SUPERSEDED"]);

/**
 * Local port of Task 022 `verifyFeatureDoneConditions`.
 * All seven conditions from the feature state machine must hold together.
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
