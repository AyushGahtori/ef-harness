import { ACCEPTED, OVERRIDE_ACCEPT_ANYWAY, OVERRIDE_FIX_CODE, OVERRIDE_TEST_WRONG, VERIFICATION_HUMAN_OVERRIDE } from "./constants.js";
import { VerificationFailedError } from "./errors.js";
import type { CleanVerifierHarnessPort, ProjectMergeQueuePort, VerificationHintLadderPort } from "./ports.js";
import type { HumanFixStateDb } from "./state-db.js";
import type { DeveloperIdentity, FailingCheck, OverrideChoice, OverrideResult } from "./types.js";

export interface OverridePolicyInput {
  readonly taskId: string;
  readonly commitSha: string;
  readonly author: DeveloperIdentity;
  readonly choice: OverrideChoice;
  readonly failingChecks: readonly FailingCheck[];
}

export class HumanVerificationOverridePolicy {
  constructor(
    private readonly state: HumanFixStateDb,
    private readonly verifier: CleanVerifierHarnessPort,
    private readonly hintLadder: VerificationHintLadderPort,
    private readonly mergeQueue: ProjectMergeQueuePort,
  ) {}

  async resolve(input: OverridePolicyInput): Promise<OverrideResult> {
    if (input.choice.kind === OVERRIDE_FIX_CODE) {
      return {
        landed: false,
        verificationStatus: "failed",
        overriddenCheckIds: [],
        updatedSpecIds: [],
      };
    }
    if (input.choice.kind === OVERRIDE_TEST_WRONG) {
      const check = input.failingChecks[0];
      if (!check) throw new VerificationFailedError([]);
      const repair = this.hintLadder.repairStaleCheck(check.id, input.choice.reason ?? "", input.commitSha);
      if (!repair.rereunOk) {
        throw new VerificationFailedError([check.id]);
      }
      const rerun = await this.verifier.run(input.taskId, input.commitSha);
      if (!rerun.ok) throw new VerificationFailedError([check.id]);
      this.state.setVerificationStatus(input.taskId, "pass");
      this.state.setTaskState(input.taskId, ACCEPTED);
      this.mergeQueue.enqueueHumanFix(input.taskId, input.commitSha, input.author);
      this.state.unparkDownstream(input.taskId);
      return {
        landed: true,
        verificationStatus: "pass",
        overriddenCheckIds: [],
        updatedSpecIds: repair.updatedSpecIds,
      };
    }
    if (input.choice.kind === OVERRIDE_ACCEPT_ANYWAY) {
      const ids = input.failingChecks.map((c) => c.id);
      this.state.recordOverride(input.taskId, ids, input.choice.reason ?? "developer override");
      this.state.setTaskState(input.taskId, ACCEPTED);
      this.mergeQueue.enqueueHumanFix(input.taskId, input.commitSha, input.author);
      const unblocked = this.state.unparkDownstream(input.taskId);
      const summary = `1 check overridden by developer (Accept anyway): ${ids.join(", ")}`;
      void unblocked;
      return {
        landed: true,
        verificationStatus: VERIFICATION_HUMAN_OVERRIDE,
        overriddenCheckIds: ids,
        updatedSpecIds: [],
        landingSummaryLine: summary,
      };
    }
    throw new VerificationFailedError([]);
  }

  presentOptions(failing: readonly FailingCheck[]): readonly OverrideChoice["kind"][] {
    if (failing.length === 0) return [];
    return [OVERRIDE_FIX_CODE, OVERRIDE_TEST_WRONG, OVERRIDE_ACCEPT_ANYWAY];
  }
}