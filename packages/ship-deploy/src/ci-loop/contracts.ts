import type { PrePushSafetyInput, PrePushSafetyResult, ShipRunRecord } from "./types.js";

export type GitleaksFinding = {
  readonly ruleId: string;
  readonly file: string;
  readonly line: number;
};

export type SafetyScanner = {
  scanCommitRange(baseRef: string, headRef: string): Promise<readonly GitleaksFinding[]>;
};

export type ExternalEffectLedger = {
  recordGitPush(effectId: string, meta: Record<string, string | number>): void;
};

export type GitHubFailedLogSource = {
  fetchFailedStepLogs(runId: string): Promise<string>;
};

export type LogRedactor = {
  redactSecrets(text: string): string;
};

export type ConditionalEtagPoller = {
  pollCheckStatus(prNumber: number): Promise<{ readonly status: "queued" | "in_progress" | "completed"; readonly conclusion?: "success" | "failure" }>;
};

export type LocalVerifier = {
  runFullSuite(): Promise<{ readonly ok: boolean; readonly detail?: string }>;
};

export type ShipRunStore = {
  get(id: string): ShipRunRecord | undefined;
  upsert(record: ShipRunRecord): void;
  listOpen(): readonly ShipRunRecord[];
};

export type PrePushDependencies = {
  readonly scanner: SafetyScanner;
};

export type FailedLogFetcherDeps = {
  readonly source: GitHubFailedLogSource;
  readonly redactor: LogRedactor;
};

export type LandingSummaryGenerator = {
  summarizeForPr(featureId: string): Promise<string>;
};

export type BaseBranchCiSnapshot = {
  readonly failingCheckNames: readonly string[];
  readonly checkUrl?: string;
};

export type CiRepairDependencies = {
  readonly store: ShipRunStore;
  readonly verifier: LocalVerifier;
  readonly scanner: SafetyScanner;
  readonly ledger: ExternalEffectLedger;
};

export type PrePushGate = (input: PrePushSafetyInput) => Promise<PrePushSafetyResult>;

export type TrackGitTrackedFiles = () => readonly string[];