import type { AttributionInput, FailureAttributionDecision } from "./types.js";

/**
 * Classify a non-pass outcome into one of the five root owners.
 * Environment crashes and flake disagreements never count against worker quality
 * and never burn a worker retry. Contract mismatches do not burn the hidden ladder.
 */
export function attributeVerificationFailure(input: AttributionInput): FailureAttributionDecision {
  if (input.flakyDisagreement || input.status === "unstable") {
    return {
      attribution: "flaky_test",
      affectsWorkerQualityScore: false,
      burnsHiddenLadder: false,
      burnsWorkerRetry: false,
      route: "test_owner",
      requirementEffect: "unresolved",
      holdForEnvRecovery: false,
      workerMessage: `Check ${input.checkId} is unstable across a clean replay. The requirement stays unresolved.`,
    };
  }

  const environmentFailure = input.signals?.environmentFailure;
  if (environmentFailure) {
    return {
      attribution: "environment",
      affectsWorkerQualityScore: false,
      burnsHiddenLadder: false,
      burnsWorkerRetry: false,
      route: "env_owner",
      requirementEffect: "unresolved",
      holdForEnvRecovery: true,
      workerMessage: `Environment failure (${environmentFailure}). Held for environment recovery.`,
    };
  }

  if (input.signals?.bindingDefect || input.signals?.binderCrash || input.signals?.missingSetup) {
    return {
      attribution: "binding_defect",
      affectsWorkerQualityScore: false,
      burnsHiddenLadder: false,
      burnsWorkerRetry: false,
      route: "task_author",
      requirementEffect: "unresolved",
      holdForEnvRecovery: false,
      workerMessage: `Binding defect on ${input.checkId}. Returned to the task author.`,
    };
  }

  if (input.signals?.contractMismatch || input.signals?.visibleControlMissing) {
    const plain = input.signals.plainMessage ?? `Visible contract mismatch on ${input.checkId}.`;
    return {
      attribution: "contract_mismatch",
      affectsWorkerQualityScore: true,
      burnsHiddenLadder: false,
      burnsWorkerRetry: false,
      route: "plain_message",
      requirementEffect: "failing",
      holdForEnvRecovery: false,
      workerMessage: plain,
    };
  }

  if (input.status === "skip" || input.status === "missing") {
    const verb = input.status === "skip" ? "was skipped" : "was not collected";
    return {
      attribution: "implementation",
      affectsWorkerQualityScore: true,
      burnsHiddenLadder: false,
      burnsWorkerRetry: true,
      route: "plain_message",
      requirementEffect: "failing",
      holdForEnvRecovery: false,
      workerMessage: `Required check ${input.checkId} ${verb}.`,
    };
  }

  const heldBack = input.visibility === "held_back";
  const rule = input.ruleId ? ` for rule ${input.ruleId}` : "";
  return {
    attribution: "implementation",
    affectsWorkerQualityScore: true,
    burnsHiddenLadder: heldBack,
    burnsWorkerRetry: true,
    route: heldBack ? "hint_ladder" : "plain_message",
    requirementEffect: "failing",
    holdForEnvRecovery: false,
    workerMessage: heldBack
      ? `Held-back check ${input.checkId} failed${rule}.`
      : `Check ${input.checkId} did not match the locked expectation${rule}.`,
  };
}
