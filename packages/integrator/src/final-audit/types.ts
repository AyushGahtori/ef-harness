import type { ProjectKind as CanonicalProjectKind } from "@ef-harness/shared-contracts";
import type { ResidualChoice, ViewportWidth } from "./constants.js";

export type FeatureState = "DONE" | "MERGED" | "WIRED" | "IN_PROGRESS" | "QUEUED";
export type ProjectKind = CanonicalProjectKind;
export type LegacyProjectKindAlias = "web" | "cli" | "openapi";
export type ProjectKindInput = CanonicalProjectKind | LegacyProjectKindAlias;
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type SuiteCaseKind = "leaf" | "feature_journey" | "sealed_hidden";
export type ShardKind = "feature" | "seam" | "rule";

export interface PlannedFeature {
  readonly id: string;
  readonly state: FeatureState;
  readonly mergedTo: string;
  readonly journeys: readonly string[];
}

export interface PlannedWave {
  readonly id: string;
  readonly features: readonly PlannedFeature[];
}

export interface RepoFile {
  readonly path: string;
  readonly content: string;
}

export interface RepoSnapshot {
  readonly files: readonly RepoFile[];
  readonly entryFile: string;
}

export interface CanonicalCatalog {
  readonly requirementIds: readonly string[];
  readonly ruleIds: readonly string[];
  readonly checkIds: readonly string[];
}

export interface WebRoute {
  readonly path: string;
}

export interface CliCommandSpec {
  readonly argv: readonly string[];
  readonly json: boolean;
}

export interface OpenApiOperation {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
}

export interface SuiteCase {
  readonly id: string;
  readonly kind: SuiteCaseKind;
  readonly passed: boolean;
  readonly featureId: string;
}

export interface LedgerNote {
  readonly id: string;
  readonly summary: string;
}

export interface LedgerRecap {
  readonly chosenForYou: readonly LedgerNote[];
  readonly deferred: readonly LedgerNote[];
}

export interface ConnectionSpend {
  readonly connectionId: string;
  readonly costUnits: bigint;
  readonly windowUnits: bigint;
  readonly usedUnits: bigint;
}

export interface SpendSnapshot {
  readonly codingUnits: bigint;
  readonly paperworkUnits: bigint;
  readonly connections: readonly ConnectionSpend[];
}

export interface RequirementRef {
  readonly id: string;
  readonly text: string;
}

export interface ShardSlice {
  readonly id: string;
  readonly requirements: readonly RequirementRef[];
  readonly files: readonly RepoFile[];
  readonly diff: string;
  readonly active?: boolean;
}

export interface ShardInputs {
  readonly features: readonly ShardSlice[];
  readonly seams: readonly ShardSlice[];
  readonly rules: readonly ShardSlice[];
}

export interface ConfirmedFinding {
  readonly id: string;
  readonly fingerprint: string;
  readonly code: string;
  readonly shardId: string | null;
  readonly kind:
    | "missing"
    | "stubbed"
    | "unhandled_edge_case"
    | "weak_check"
    | "layer_a"
    | "layer_b"
    | "regression"
    | "invalid_output"
    | "blocked";
  readonly severity: FindingSeverity;
  readonly advisory: boolean;
  readonly filePath: string | null;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly requirementId: string | null;
  readonly ruleId: string | null;
  readonly detail: string;
  readonly fixCostUnits: bigint;
}

export interface AuditCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly llmTokens: 0;
  readonly findings: readonly ConfirmedFinding[];
  readonly suiteCases?: readonly SuiteCase[];
}

export interface LayerAReport {
  readonly llmTokens: 0;
  readonly passed: boolean;
  readonly checks: readonly AuditCheck[];
  readonly findings: readonly ConfirmedFinding[];
  readonly suiteCases: readonly SuiteCase[];
}

export interface PageInspection {
  readonly url: string;
  readonly status: number;
  readonly viewport: ViewportWidth;
  readonly httpErrors: readonly { readonly url: string; readonly status: number }[];
  readonly consoleErrors: readonly string[];
  readonly unhandledRejections: readonly string[];
  readonly brokenImages: readonly string[];
  readonly horizontalOverflow: boolean;
  readonly axeViolations: readonly { readonly id: string; readonly impact: "serious" | "critical" | "moderate" | "minor" }[];
}

export interface RouteObservation extends PageInspection {
  readonly route: string;
}

export interface CommandObservation {
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly stdoutPure: boolean;
  readonly passed: boolean;
  readonly detail: string;
}

export interface LayerBReport {
  readonly llmTokens: 0;
  readonly passed: boolean;
  readonly kind: ProjectKindInput;
  readonly checks: readonly AuditCheck[];
  readonly findings: readonly ConfirmedFinding[];
  readonly routes: readonly RouteObservation[];
  readonly commands: readonly CommandObservation[];
  readonly leakedPids: readonly number[];
}

export interface AuditFixTask {
  readonly id: string;
  readonly round: number;
  readonly fingerprint: string;
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly requirementId: string | null;
  readonly ruleId: string | null;
  readonly severity: "critical" | "high";
  readonly detail: string;
  readonly branch: typeof import("./constants.js").INTEGRATION_REF;
  readonly costUnits: bigint;
}

export interface Regression {
  readonly caseId: string;
  readonly featureId: string;
  readonly detail: string;
}

export interface CountTrio {
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
}

export interface LandingSummary {
  readonly title: "Project Delivery & Landing Summary";
  readonly presentation: "ship-build";
  readonly verdict: string;
  readonly readyToLand: boolean;
  readonly whatWasBuilt: {
    readonly features: readonly {
      readonly id: string;
      readonly journeys: readonly string[];
      readonly routes: readonly string[];
      readonly commands: readonly string[];
    }[];
  };
  readonly receipts: {
    readonly leafTests: CountTrio;
    readonly featureJourneys: CountTrio;
    readonly sealedHiddenChecks: CountTrio;
    readonly routeCrawler: CountTrio & { readonly routes: number };
    readonly staticAudit: { readonly passed: boolean; readonly findingCount: number };
    readonly secretScan: { readonly passed: boolean; readonly hitCount: number };
  };
  readonly chosenForYou: readonly LedgerNote[];
  readonly deferred: readonly LedgerNote[];
  readonly spend: {
    readonly codingUnits: bigint;
    readonly paperworkUnits: bigint;
    readonly paperworkShare: string;
    readonly paperworkWithinCap: boolean;
    readonly perConnection: readonly ConnectionSpend[];
    readonly auditFixUnits: bigint;
    readonly auditFixCapUnits: bigint;
    readonly finalAuditUnits: bigint;
    readonly finalAuditCapUnits: bigint;
  };
  readonly unresolvedFindings: readonly ConfirmedFinding[];
  readonly optionalFollowUps: readonly string[];
  readonly optionalFollowUpsLabel: "Optional Follow-Ups";
  readonly choices: readonly ResidualChoice[] | null;
  readonly fixRounds: number;
  readonly regressions: readonly Regression[];
  readonly plainEnglish: string;
}

export interface PlannedShard {
  readonly id: string;
  readonly kind: ShardKind;
  readonly subjectId: string;
  readonly requirements: readonly RequirementRef[];
  readonly files: readonly RepoFile[];
  readonly diff: string;
}

export interface ShardRun {
  readonly shard: PlannedShard;
  readonly prompt: string;
  readonly tokenEstimate: number;
  readonly status: "complete" | "skipped_budget" | "invalid_output" | "blocked";
  readonly findings: readonly ConfirmedFinding[];
  readonly discarded: number;
  readonly llmTokens: number;
}

export interface BootedApp {
  readonly baseUrl: string | null;
  readonly pid: number;
  readonly stop: () => Promise<void>;
  readonly alive: () => boolean;
}

export interface AppBootPort {
  boot(): Promise<BootedApp>;
}

export interface PageMetrics {
  readonly consoleErrors: readonly string[];
  readonly unhandledRejections: readonly string[];
  readonly brokenImages: readonly string[];
  readonly horizontalOverflow: boolean;
  readonly axeViolations: readonly { readonly id: string; readonly impact: "serious" | "critical" | "moderate" | "minor" }[];
  readonly httpErrors: readonly { readonly url: string; readonly status: number }[];
}

export interface PlaywrightSession {
  setViewportSize(size: { readonly width: number; readonly height: number }): Promise<void>;
  goto(url: string): Promise<{ readonly status: number; readonly body: string; readonly contentType: string; readonly url: string }>;
  evaluate(): Promise<PageMetrics>;
  close(): Promise<void>;
}

export interface PlaywrightSessionFactory {
  open(): Promise<PlaywrightSession>;
}

/** Async port for Task 057 / sibling Task 062 `UiInteractionContractVerifier`. */
export interface UiPlaywrightContractVerifierPort {
  inspect(input: { readonly url: string; readonly viewport: { readonly width: ViewportWidth; readonly height: number } }): Promise<PageInspection>;
}

export interface CheckRunResult {
  readonly passed: boolean;
  readonly detail: string;
}

/** Async port for production build, typecheck, and lint commands. */
export interface CheckRunnerPort {
  run(check: "production_build" | "typecheck" | "lint", ref: typeof import("./constants.js").INTEGRATION_REF): Promise<CheckRunResult>;
}

/** Async port for Task 055 / sibling Task 060 `CleanVerifierRunner`. */
export interface CleanVerifierHarnessPort {
  runCombined(input: { readonly ref: typeof import("./constants.js").INTEGRATION_REF; readonly label: string }): Promise<{
    readonly passed: boolean;
    readonly cases: readonly SuiteCase[];
  }>;
}

export interface FinalProjectAuditorModel {
  audit(input: { readonly shardId: string; readonly prompt: string; readonly tokenEstimate: number }): Promise<unknown>;
}

export interface FixExecutor {
  apply(tasks: readonly AuditFixTask[]): Promise<{ readonly changedFiles: readonly string[] }>;
  revert?(tasks: readonly AuditFixTask[]): Promise<void>;
}

export interface CommandExecutor {
  exec(argv: readonly string[]): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
}

export interface StaticAuditGatePort {
  auditFeature(snapshot: RepoSnapshot):
    | {
        readonly passed: boolean;
        readonly findings: readonly ConfirmedFinding[];
      }
    | Promise<{
        readonly passed: boolean;
        readonly findings: readonly ConfirmedFinding[];
      }>;
}

export interface SecretScannerPort {
  scan(files: readonly RepoFile[]): readonly ConfirmedFinding[] | Promise<readonly ConfirmedFinding[]>;
}
