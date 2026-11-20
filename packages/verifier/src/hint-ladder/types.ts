export const MODEL_LEVELS = ["Junior", "Mid", "Senior", "Manager"] as const;
export type ModelLevel = (typeof MODEL_LEVELS)[number];

export const FAILURE_TYPES = [
  "wrong_value",
  "missing_item",
  "extra_item",
  "wrong_order",
  "exception",
  "timeout",
] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

export const EXHAUSTED_DECISION_OPTIONS = ["revise brief", "fix by hand", "waive"] as const;
export type ExhaustedDecisionOption = (typeof EXHAUSTED_DECISION_OPTIONS)[number];

export interface DecisionCard {
  readonly options: readonly ["revise brief", "fix by hand", "waive"];
}

export type FailureAttribution =
  | "implementation"
  | "contract_mismatch"
  | "binding_defect"
  | "environment"
  | "flaky_test";

export type NonLadderAttribution = Exclude<FailureAttribution, "implementation" | "contract_mismatch">;

export type BriefDefectEvidence = "unclear_brief" | "defective_expectation";

export interface HiddenExample {
  readonly checkId: string;
  readonly input: unknown;
  readonly expectedOutput: unknown;
}

export interface FailureFingerprintInput {
  readonly failureClass: string;
  readonly ruleOrCheckId: string;
  readonly filePath: string;
  readonly detail: string;
}

export type FailureFingerprintPort = (input: FailureFingerprintInput) => string;

export interface PropertyExampleRequest {
  readonly ruleId: string;
  readonly ruleText: string;
  readonly failedCheckId: string;
  readonly sealedCheckIds: readonly string[];
  readonly seed: string;
}

export interface PropertyExampleGenerator {
  synthesize(request: PropertyExampleRequest): HiddenExample;
}

export interface CandidateProbeRequest {
  readonly taskId: string;
  readonly attemptId: string;
  readonly ruleId: string;
  readonly checkId: string;
  readonly freshInput: unknown;
  readonly expectedOutput: unknown;
}

export interface CandidateExampleRunner {
  run(request: CandidateProbeRequest): unknown;
}

export interface LadderHistoryEntry {
  readonly taskId: string;
  readonly attemptId: string;
  readonly model: string;
  readonly level: ModelLevel;
  readonly ruleId: string;
  readonly checkId: string;
  readonly failureType: FailureType;
  readonly fingerprint: string;
  readonly ladderStep: number;
  readonly briefVersion: number;
  readonly at: number;
}

export interface EscalationDecision {
  readonly route: "model_level" | "task_author" | "exhausted";
  readonly state: "ESCALATED" | "EXHAUSTED";
  readonly fromLevel: ModelLevel;
  readonly toLevel: ModelLevel | null;
  readonly reason: string;
  readonly authorMessage: string | null;
  readonly decisionCard: DecisionCard | null;
  readonly routedTo: "ask-owner-responder@1" | null;
  readonly source: "hidden_check" | "static_audit";
}

export interface StepOneHint {
  readonly ruleId: string;
  readonly ruleText: string;
  readonly failureType: FailureType;
}

export interface StepTwoHint extends StepOneHint {
  readonly freshInput: unknown;
  readonly expectedOutput: unknown;
  readonly candidateActualOutput: unknown;
}

export interface StepOneFeedback {
  readonly kind: "step_1";
  readonly ladderStep: 1;
  readonly recordedHiddenFailure: true;
  readonly taskState: string;
  readonly hint: StepOneHint;
}

export interface StepTwoFeedback {
  readonly kind: "step_2";
  readonly ladderStep: 2;
  readonly recordedHiddenFailure: true;
  readonly taskState: string;
  readonly disclosedCheckId: string;
  readonly synthesized: boolean;
  readonly hint: StepTwoHint;
}

export interface StepThreeFeedback {
  readonly kind: "step_3";
  readonly ladderStep: 3;
  readonly recordedHiddenFailure: true;
  readonly taskState: "ESCALATED" | "EXHAUSTED";
  readonly hint: StepOneHint;
  readonly escalation: EscalationDecision;
  readonly history: readonly LadderHistoryEntry[];
}

export interface ContractMismatchFeedback {
  readonly kind: "contract_mismatch";
  readonly recordedHiddenFailure: false;
  readonly taskState: string;
  readonly hint: { readonly message: string };
}

export interface NonLadderFeedback {
  readonly kind: "non_ladder";
  readonly attribution: NonLadderAttribution;
  readonly recordedHiddenFailure: false;
  readonly taskState: string;
  readonly hint: { readonly message: string };
}

export type HintFeedbackPayload =
  | StepOneFeedback
  | StepTwoFeedback
  | StepThreeFeedback
  | ContractMismatchFeedback
  | NonLadderFeedback;

export interface HiddenCheckFailure {
  readonly taskId: string;
  readonly attemptId: string;
  readonly model: string;
  readonly workerLevel: string;
  readonly briefVersion: number;
  readonly ruleId: string;
  readonly ruleText: string;
  readonly checkId: string;
  readonly failureType: string;
  readonly fingerprint?: string;
  readonly filePath?: string;
  readonly detail?: string;
  readonly attribution?: FailureAttribution;
  readonly visibleMessage?: string;
  readonly evidence?: BriefDefectEvidence;
  readonly pool?: readonly HiddenExample[];
}

export interface StaticAuditOutcome {
  readonly taskId: string;
  readonly briefVersion: number;
  readonly fingerprint: string;
  readonly outcome: "fail" | "pass";
}

export interface StaticAuditLadderResult {
  readonly recordedHiddenFailure: false;
  readonly ladderStep: number;
  readonly staticFailures: number;
  readonly taskState: string;
  readonly escalated: boolean;
  readonly escalation: EscalationDecision | null;
}

export interface TestDisputeRecord {
  readonly disputeId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly citedRuleId: string;
  readonly citedCheckId: string | null;
  readonly counterexample: unknown;
  readonly ruleText: string;
  readonly status: "open" | "upheld" | "rejected";
  readonly authorQuote: string | null;
  readonly pausedAttemptState: string;
  readonly penalized: false;
  readonly routedTo: "ask-owner-responder@1";
  readonly createdAt: number;
  readonly resolvedAt: number | null;
}

export interface TestDisputeInput {
  readonly taskId: string;
  readonly attemptId: string;
  readonly referenceId: string;
  readonly counterexample: unknown;
}

export type DisputeVerdictInput =
  | {
      readonly disputeId: string;
      readonly verdict: "dispute_upheld";
      readonly correctedExpectation: unknown;
      readonly authorQuote?: string;
    }
  | {
      readonly disputeId: string;
      readonly verdict: "dispute_rejected";
      readonly authorQuote: string;
    };

export interface DisputeVerdictResult {
  readonly record: TestDisputeRecord;
  readonly checkId: string | null;
  readonly checkVersion: number | null;
  readonly taskState: string;
  readonly authorQuote: string | null;
}

export interface CrossWorkerMatch {
  readonly matched: true;
  readonly ruleId: string;
  readonly fingerprint: string;
  readonly checkId: string;
  readonly message: string;
  readonly workers: readonly {
    readonly attemptId: string;
    readonly model: string;
    readonly level: ModelLevel;
  }[];
}

export interface TaskRuntimeRow {
  readonly taskId: string;
  readonly state: string;
  readonly level: ModelLevel;
  readonly epoch: number;
  readonly holderAttempt: string | null;
  readonly submissionPending: number;
  readonly updatedRev: number;
}

export interface VerificationRow {
  readonly taskId: string;
  readonly briefVersion: number;
  readonly ladderStep: number;
  readonly lastFingerprint: string | null;
  readonly sameFingerprint: number;
  readonly disclosedChecks: readonly string[];
  readonly staticFailures: number;
  readonly updatedAt: number;
}

export interface AttemptRow {
  readonly id: string;
  readonly taskId: string;
  readonly state: string;
}

export interface NodeRow {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fields: string;
  readonly contentHash: string;
}
