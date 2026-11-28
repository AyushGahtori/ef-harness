export const GIT_BISECT_SKIP_EXIT = 125 as const;
export const STABILITY_RUN_COUNT = 5 as const;
export const REVERT_VERIFY_RUN_COUNT = 3 as const;
export const MAX_BISECT_COMMITS = 256 as const;
export const MAX_BISECT_STEPS = 8 as const;
export const MAX_DDMIN_EVALUATIONS = 40 as const;

export type ReproOutcome = {
  readonly exitCode: number;
  readonly output: string;
  readonly fingerprint: string;
};

export type ReproRunner = () => Promise<ReproOutcome> | ReproOutcome;

export type BisectStabilityReport = {
  readonly badRuns: readonly ReproOutcome[];
  readonly goodRuns: readonly ReproOutcome[];
  readonly targetFingerprint: string;
};

export type BisectRunResult = {
  readonly suspectCommit: string;
  readonly stability: BisectStabilityReport;
  readonly revertVerified: boolean;
  readonly skippedCommitCount: number;
  readonly shallowLimited: boolean;
  readonly artifactRef: string;
};

export type HypothesisLedgerEntry = {
  readonly hypothesisId: string;
  readonly statement: string;
  readonly subsystem?: string;
  readonly prediction: string;
  readonly experiment: string;
  readonly result?: "confirmed" | "falsified";
};

export type HypothesisGuardDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "duplicate_falsified" | "tunnel_vision_trigger";
      readonly pivotHint: string;
    };

export type SymptomPatchKind =
  | "empty_catch"
  | "arbitrary_delay"
  | "crash_site_guard"
  | "test_weakening";

export type SymptomPatchFinding = {
  readonly kind: SymptomPatchKind;
  readonly detail: string;
  readonly lineHint?: string;
};

export type SymptomPatchAudit = {
  readonly flagged: boolean;
  readonly findings: readonly SymptomPatchFinding[];
  readonly artifactRef: string;
};

export type BrowserEngine = "chromium" | "webkit" | "firefox";

export type BrowserRunSnapshot = {
  readonly engine: BrowserEngine;
  readonly passed: boolean;
  readonly consoleErrors: readonly string[];
  readonly networkStatuses: readonly number[];
  readonly computedStyles: Readonly<Record<string, string>>;
  readonly boundingBoxes: Readonly<Record<string, { x: number; y: number; w: number; h: number }>>;
  readonly screenshotRef?: string;
  readonly errorMessage?: string;
};

export type CrossBrowserDiff = {
  readonly chromium: BrowserRunSnapshot | null;
  readonly webkit: BrowserRunSnapshot | null;
  readonly firefox: BrowserRunSnapshot | null;
  readonly divergences: readonly string[];
  readonly artifactRef: string;
  readonly webkitMissing: boolean;
  readonly toolCardHint?: string;
};

export type DdminShrinkResult<T> = {
  readonly minimalInput: readonly T[];
  readonly evaluations: number;
  readonly fingerprint: string;
  readonly artifactRef: string;
};

export type LocalizationArtifacts = {
  readonly bisectSuspectCommit?: string;
  readonly crossBrowserDiff?: CrossBrowserDiff;
  readonly ddminFixture?: unknown;
  readonly symptomPatchAudit?: SymptomPatchAudit;
};