/** Six locked investigation stages from investigations-and-sweeps.md */
export const INVESTIGATION_STAGES = [
  "INTAKE",
  "CLEAN_REPRO",
  "QUARANTINED_LOCALIZE",
  "PROVEN_MINIMAL_FLIP_ROOT_CAUSE",
  "SCOPED_FIX",
  "PERMANENT_REPRO_AND_MECHANISM_TESTS",
] as const;

export type InvestigationStage = (typeof INVESTIGATION_STAGES)[number];

export type HypothesisResult = "confirmed" | "falsified" | "pending";

export interface HypothesisLedgerEntry {
  readonly hypothesisId: string;
  readonly prediction: string;
  readonly experiment: string;
  readonly result: HypothesisResult;
  readonly recordedAt: number;
}

export interface InvestigationBudget {
  readonly stageTurns: Record<InvestigationStage, number>;
  readonly maxTurnsPerStage: number;
  readonly reproAttemptLimit: number;
  readonly reproTimeBudgetMs: number;
}

export interface SymptomCard {
  readonly title: string;
  readonly observedBehavior: string;
  readonly expectedBehavior: string;
  readonly reproductionSteps: readonly string[];
  readonly affectedUrlsOrRoutes: readonly string[];
  readonly environmentNotes?: string;
  readonly browserOsNotes?: string;
}

export interface CodeMapHit {
  readonly path: string;
  readonly symbol: string;
  readonly route?: string;
}

export type ReproSurface = "vitest" | "http" | "playwright" | "cli";

export interface ReproScript {
  readonly id: string;
  readonly surface: ReproSurface;
  readonly command: readonly string[];
  readonly cwdRelative?: string;
  readonly failureFingerprint: string;
}

export interface ReproRunResult {
  readonly exitCode: number;
  readonly output: string;
  readonly fingerprint: string;
  readonly durationMs: number;
}

export interface MinimalFlipProof {
  readonly rootCauseFile: string;
  readonly rootCauseSymbol: string;
  readonly mechanism: string;
  readonly applyFlip: () => Promise<ReproRunResult>;
  readonly revertFlip: () => Promise<ReproRunResult>;
}

export interface ProvenRootCause {
  readonly file: string;
  readonly symbol: string;
  readonly mechanism: string;
  readonly minimalFlipProof: MinimalFlipProof;
}

export interface SurgicalFix {
  readonly paths: readonly string[];
  readonly diffSummary: string;
}

export interface PermanentTestSpec {
  readonly reproTestPath: string;
  readonly mechanismTestPath: string;
}

export interface InvestigationReceipt {
  readonly investigationId: string;
  readonly symptomSummary: string;
  readonly reproCommand: string;
  readonly falsifiedHypotheses: readonly string[];
  readonly provenRootCause: ProvenRootCause;
  readonly minimalFlipProof: string;
  readonly surgicalFixDiff: string;
  readonly permanentTestsAdded: readonly string[];
  readonly gitTrailers: readonly string[];
}

export interface InvestigationRecord {
  readonly id: string;
  readonly symptomCard: SymptomCard;
  readonly stage: InvestigationStage;
  readonly hypothesisLedger: readonly HypothesisLedgerEntry[];
  readonly reproScript: ReproScript | null;
  readonly provenRootCause: ProvenRootCause | null;
  readonly surgicalFix: SurgicalFix | null;
  readonly permanentTests: PermanentTestSpec | null;
  readonly receipt: InvestigationReceipt | null;
  readonly reproAttempts: number;
  readonly reproStartedAt: number | null;
  readonly escalationMessage: string | null;
  readonly instrumentationOnlyFallback: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WriteAttempt {
  readonly path: string;
  readonly contentPreview?: string;
}

export interface WorktreeSlot {
  readonly id: string;
  readonly rootPath: string;
  readonly mode: "read_only" | "scratch" | "clean_fix";
}

export interface TestVerificationResult {
  readonly exitCode: number;
  readonly regressions: readonly string[];
}

export interface RedBeforeGreenResult {
  readonly reproFailsOnBase: boolean;
  readonly mechanismFailsOnBase: boolean;
  readonly reproPassesOnFix: boolean;
  readonly mechanismPassesOnFix: boolean;
}