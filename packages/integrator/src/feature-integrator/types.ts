import type { NameRegistryService, RegistrySnapshot } from "@ef-harness/completeness-gate";
import type {
  AcceptanceCheck,
  VerificationOutcome,
  VerifyCandidateRequest,
} from "@ef-harness/verifier";
import type { DoneConditionId, FeatureState, SeamId } from "./constants.js";

export type { SeamId };

export const SCHEMA_WIRING_KINDS = [
  "route",
  "page",
  "export",
  "migration",
  "env",
  "component",
] as const;

export const INTEGRATOR_WIRING_KINDS = [
  ...SCHEMA_WIRING_KINDS,
  "nav",
  "api",
  "seam",
  "event",
  "queue",
  "cron",
  "health",
  "di",
] as const;

export type WiringKind = (typeof INTEGRATOR_WIRING_KINDS)[number];

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface WiringEffects {
  readonly dbKey: string | null;
  readonly dbValue: string | null;
  readonly mailTo: string | null;
  readonly mailSubject: string | null;
  readonly mailBody: string | null;
}

export interface IntegratorWiringNeed {
  readonly kind: WiringKind;
  readonly path: string;
  readonly component: string | null;
  readonly taskId: string;
  readonly method: HttpMethod;
  readonly seamId: SeamId | null;
  readonly effects: WiringEffects | null;
}

export interface LeafCommitInput {
  readonly taskId: string;
  readonly sha: string;
  readonly objective: string;
  readonly requirementIds: readonly string[];
  readonly checkIds: readonly string[];
  readonly writeScope: readonly string[];
  readonly wiringNeeds: readonly IntegratorWiringNeed[];
}

export interface ConflictHunk {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly base: string;
  readonly ours: string;
  readonly theirs: string;
  readonly contextBefore: readonly string[];
  readonly contextAfter: readonly string[];
}

export interface PreflightConflict {
  readonly path: string;
  readonly hunks: readonly ConflictHunk[];
  readonly oursText: string;
  readonly theirsText: string;
}

export interface PreflightReport {
  readonly clean: boolean;
  readonly treeOid: string;
  readonly conflicts: readonly PreflightConflict[];
  readonly messages: readonly string[];
  readonly durationMs: number;
  readonly command: string;
}

export interface ScopedConflictPacket {
  readonly hunks: readonly ConflictHunk[];
  readonly objectives: readonly { readonly taskId: string; readonly objective: string }[];
}

export interface FileText {
  readonly path: string;
  readonly text: string;
}

export interface TaskEvidence {
  readonly id: string;
  readonly state: string;
  readonly briefVersion: number;
  readonly currentBriefVersion: number;
  readonly contractVersion: number;
  readonly currentContractVersion: number;
}

export interface RequirementEvidence {
  readonly id: string;
  readonly checkStatus: "pass" | "fail" | "skip" | "missing";
  readonly waiverApproved: boolean;
}

export interface FeatureDoneEvidenceInput {
  readonly tasks: readonly TaskEvidence[];
  readonly requirements: readonly RequirementEvidence[];
  readonly staticAuditClean: boolean;
  readonly journeyPassedInCleanEnv: boolean;
  readonly mergedOntoIntegration: boolean;
  readonly earlierDoneRegressionsPassed: boolean;
  readonly hasScreens: boolean;
  readonly accessibilityClean: boolean;
  readonly layoutClean: boolean;
  readonly openContractChangeRequestIds: readonly string[];
  readonly auditedPaths?: readonly string[];
  readonly journeyEntryPoint?: string;
  readonly integrationMergeCommit?: string;
  readonly regressedFeatureIds?: readonly string[];
  readonly seriousAccessibilityFindingIds?: readonly string[];
}

export interface FeatureDoneCheckResult {
  readonly ok: boolean;
  readonly failedConditions: readonly DoneConditionId[];
}

export interface SeamBinding {
  readonly templateId: SeamId;
  readonly name: string;
  readonly taskIds: readonly string[];
}

export interface PlannedMount {
  readonly method: HttpMethod;
  readonly path: string;
  readonly taskId: string;
  readonly effects: WiringEffects | null;
}

export interface AggregatedWiringTask {
  readonly id: string;
  readonly featureId: string;
  readonly leafTaskIds: readonly string[];
  readonly files: readonly FileText[];
  readonly writeScope: readonly string[];
  readonly seamBindings: readonly SeamBinding[];
  readonly mounts: readonly PlannedMount[];
  readonly touchesUi: boolean;
  readonly needs: readonly IntegratorWiringNeed[];
}

export interface CodeSnapshot {
  readonly label: "base" | "feature";
  readonly commit: string;
  readonly files: ReadonlyMap<string, string>;
}

export interface CheckObservation {
  readonly pass: boolean;
  readonly observed: string;
}

export interface SealedCheck {
  readonly id: string;
  readonly acceptanceCheck?: AcceptanceCheck;
  readonly run: (snapshot: CodeSnapshot) => CheckObservation | Promise<CheckObservation>;
}

export interface RedBeforeGreenProof {
  readonly checkId: string;
  readonly basePassed: boolean;
  readonly featurePassed: boolean;
}

export type SeamStep =
  | {
      readonly kind: "http";
      readonly method: HttpMethod;
      readonly path: string;
      readonly expectStatus: number;
      readonly expectingTask: string;
      readonly body: unknown;
      readonly expectBodyIncludes: string | null;
    }
  | {
      readonly kind: "db";
      readonly key: string;
      readonly expectValue: string;
    }
  | {
      readonly kind: "mail";
      readonly expectSubjectIncludes: string;
    };

export interface SeamJourney {
  readonly id: string;
  readonly templateId: SeamId;
  readonly steps: readonly SeamStep[];
}

export interface SeamContext {
  readonly db: Map<string, string>;
  readonly inbox: { to: string; subject: string; body: string }[];
}

export interface RouteMount {
  readonly method: HttpMethod;
  readonly path: string;
  readonly taskId: string;
  readonly handler: (ctx: SeamContext, body: unknown) => { status: number; body: unknown };
}

export interface SeamFailure {
  readonly journeyId: string;
  readonly templateId: SeamId;
  readonly detail: string;
  readonly expectedPath: string | null;
  readonly mountedPath: string | null;
  readonly expectingTask: string | null;
  readonly mountedTask: string | null;
}

export interface ViewportRender {
  readonly text: string;
  readonly overflow: boolean;
  readonly tapTargetPx: number;
}

export interface ViewportCheck {
  readonly id: string;
  readonly width: 375 | 1440;
  readonly render: (width: number) => ViewportRender | Promise<ViewportRender>;
}

export interface WiringRepair {
  readonly fromPath: string;
  readonly toPath: string;
}

export interface IntegrationFixHint {
  readonly round: number;
  readonly target: "seam" | "wiring" | "viewport" | "audit" | "sealed" | "clean_verifier";
  readonly detail: string;
  readonly repair: WiringRepair | null;
}

export interface JourneyReport {
  readonly ok: boolean;
  readonly redBeforeGreen: readonly RedBeforeGreenProof[];
  readonly seamFailures: readonly SeamFailure[];
  readonly viewportFailures: readonly string[];
  readonly auditFindings: readonly string[];
  readonly hint: IntegrationFixHint | null;
}

export interface FeatureIntegratorSuccess {
  readonly resolved_conflicts: readonly { readonly path: string; readonly summary: string }[];
  readonly wiring_done: readonly string[];
  readonly rerun_checks: readonly string[];
}

export interface FeatureIntegratorBlocked {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type FeatureIntegratorV1 = FeatureIntegratorSuccess | FeatureIntegratorBlocked;

export interface EfTrailers {
  readonly feature: string;
  readonly tasks: readonly string[];
  readonly requirements: readonly string[];
  readonly checksPassed: string;
  readonly harnessVersion: string;
}

export interface CasAdvanceInput {
  readonly repo: string;
  readonly ref: string;
  readonly newSha: string;
  readonly expectedOldSha: string;
  readonly holder: string;
  readonly epoch: number;
}

export type CasAdvanceResult =
  | { readonly ok: true; readonly sha: string }
  | { readonly ok: false; readonly reason: "cas_mismatch"; readonly actualSha: string };

/** Async port of Task 039 `RefLeaseManager.advanceRefCas`. */
export interface RefCasPort {
  advance(input: CasAdvanceInput): Promise<CasAdvanceResult>;
}

/** Async port of Task 022 `LifecycleRepo`. */
export interface FeatureLifecyclePort {
  read(featureId: string): Promise<{ readonly state: FeatureState; readonly epoch: number }>;
  transition(input: {
    readonly featureId: string;
    readonly to: FeatureState;
    readonly expectedEpoch: number;
    readonly evidence: FeatureDoneEvidenceInput | null;
  }): Promise<{ readonly state: FeatureState; readonly epoch: number }>;
}

/** Async port of the clean verifier checkout reader (`CleanVerifierRunner` / `WorktreeSlotManagerPort`). */
export interface CleanSnapshotPort {
  read(repo: string, commit: string, label: "base" | "feature"): Promise<CodeSnapshot>;
}

/** Async port of Task 056 / C23 `CleanVerifierRunner` for full sandboxed feature verification. */
export interface CleanVerifierHarnessPort {
  verifyCandidate(request: VerifyCandidateRequest): Promise<VerificationOutcome>;
}

/** Async port of Task 061 / C24 `RedBeforeGreenBlindBinder` (`RedBeforeGreenGate` + `BlindBinderOrchestrator`). */
export interface BlindBinderPort {
  bind(
    check: SealedCheck,
    context?: { readonly base?: CodeSnapshot; readonly feature?: CodeSnapshot },
  ): Promise<SealedCheck>;
}

/** Async port of Task 059 / C23 `CompletenessGateRunner`. */
export interface StaticAuditPort {
  audit(input: {
    readonly featureId: string;
    readonly taskId: string;
    readonly baseRef: string;
    readonly candidateRef: string;
    readonly files: readonly FileText[];
    readonly entryPoints?: readonly string[];
    readonly declaredSharedFiles?: readonly string[];
    readonly writeScope?: readonly string[];
    readonly conflictHunks?: readonly ConflictHunk[];
    readonly registry?: RegistrySnapshot;
    readonly nameRegistry?: NameRegistryService;
  }): Promise<readonly string[]>;
}

/** Async port for `feature-integrator@1` model invocations. */
export interface FeatureIntegratorModelPort {
  complete(packet: ScopedConflictPacket): Promise<unknown>;
}

export interface RegressionResult {
  readonly featureId: string;
  readonly passed: boolean;
}

export interface FeatureIntegrationRequest {
  readonly repoPath: string;
  readonly featureId: string;
  readonly expectedEpoch: number;
  readonly holder: string;
  readonly mode: "m2_sequential" | "m3_queue";
  readonly history: "squash" | "preserve";
  readonly harnessVersion: string;
  readonly leaves: readonly LeafCommitInput[];
  readonly sealedChecks: readonly SealedCheck[];
  readonly seamJourneys: readonly SeamJourney[];
  readonly viewportChecks: readonly ViewportCheck[];
  readonly requirements: readonly RequirementEvidence[];
  readonly tasks: readonly TaskEvidence[];
  readonly earlierRegressions: readonly RegressionResult[];
  readonly openContractChangeRequestIds: readonly string[];
  readonly accessibilityClean: boolean;
  readonly layoutClean: boolean;
  readonly lifecycle: FeatureLifecyclePort;
  readonly resolutionOverrides?: readonly FileText[];
  readonly modelOutput?: unknown;
  readonly model?: FeatureIntegratorModelPort;
  readonly cas?: RefCasPort;
  readonly cleanVerification?: VerifyCandidateRequest;
  readonly entryPoints?: readonly string[];
  readonly registry?: RegistrySnapshot;
  readonly nameRegistry?: NameRegistryService;
}

export interface QueueHandoff {
  readonly target: "Task 111";
  readonly featureRef: string;
  readonly commitSha: string;
}

export interface FeatureIntegrationResult {
  readonly phase: "INTEGRATING";
  readonly status: "done" | "queued_for_merge" | "blocked" | "merged_pending_done";
  readonly featureState: FeatureState;
  readonly commitSha: string | null;
  readonly integrationSha: string | null;
  readonly trailers: EfTrailers | null;
  readonly output: FeatureIntegratorV1;
  readonly wiringTaskId: string | null;
  readonly hints: readonly IntegrationFixHint[];
  readonly redBeforeGreen: readonly RedBeforeGreenProof[];
  readonly queueHandoff: QueueHandoff | null;
  readonly failedConditions: readonly DoneConditionId[];
}
