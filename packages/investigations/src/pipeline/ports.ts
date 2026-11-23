import type {
  CodeMapHit,
  ReproRunResult,
  ReproScript,
  SymptomCard,
  TestVerificationResult,
  WorktreeSlot,
} from "./types.js";

/** Task 100 — symptom card persistence (local port for wiring). */
export interface SymptomCardStorePort {
  load(cardId: string): SymptomCard | null;
}

/** Task 167 — L1 code map around suspected routes/symbols. */
export interface CompactCodeMapQueryPort {
  queryAroundRoutes(routes: readonly string[], symbols?: readonly string[]): readonly CodeMapHit[];
}

/** Task 038 — isolated worktree slots. */
export interface WorktreeSlotPoolPort {
  acquireReadOnlyRepro(): WorktreeSlot;
  acquireQuarantineScratch(): WorktreeSlot;
  acquireCleanFixBase(): WorktreeSlot;
  discardScratch(slot: WorktreeSlot): void;
}

/** Task 050 — test environment orchestration across surfaces. */
export interface TestEnvOrchestratorPort {
  runRepro(slot: WorktreeSlot, script: ReproScript): Promise<ReproRunResult>;
  runNamedTest(
    slot: WorktreeSlot,
    testPath: string,
    label: "repro" | "mechanism",
  ): Promise<ReproRunResult>;
}

/** Task 055 — clean verifier harness for scoped fix landing. */
export interface CleanVerifierHarnessPort {
  verifyScopedFix(slot: WorktreeSlot): Promise<TestVerificationResult>;
}