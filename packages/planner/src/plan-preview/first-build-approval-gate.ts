export interface FirstBuildInput {
  readonly isFirstBuild: boolean;
  readonly explicitStartBuildClick: boolean;
  readonly estimatedCostMicroUsd: bigint;
  readonly taskCount: number;
}

export interface FirstBuildDecision {
  readonly applies: boolean;
  readonly isFirstBuild: boolean;
  readonly autoStart: false;
  readonly waitingForExplicitStart: boolean;
  readonly mayProceed: boolean;
  readonly reason: "explicit_start_build" | "first_build_waits_for_start" | "not_first_build";
  readonly message: string;
}

/**
 * A project's first build always stops at Plan Preview.
 * Cost and task count are accepted so callers cannot route around the gate by claiming the plan is tiny.
 */
export class FirstBuildApprovalGate {
  assess(input: FirstBuildInput): FirstBuildDecision {
    if (!input.isFirstBuild) {
      return {
        applies: false,
        isFirstBuild: false,
        autoStart: false,
        waitingForExplicitStart: false,
        mayProceed: false,
        reason: "not_first_build",
        message: "Later revisions are decided by the revision auto-start policy",
      };
    }
    if (!input.explicitStartBuildClick) {
      return {
        applies: true,
        isFirstBuild: true,
        autoStart: false,
        waitingForExplicitStart: true,
        mayProceed: false,
        reason: "first_build_waits_for_start",
        message: "Needs approval: first build waits for Start build",
      };
    }
    return {
      applies: true,
      isFirstBuild: true,
      autoStart: false,
      waitingForExplicitStart: false,
      mayProceed: true,
      reason: "explicit_start_build",
      message: "Start build",
    };
  }
}
