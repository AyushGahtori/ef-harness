import {
  StageBudgetExceededError,
  StageTransitionForbiddenError,
  UnreproducibleBugEscalation,
} from "./errors.js";
import type { SqliteInvestigationStore } from "./investigation-store.js";
import { MinimalFlipRootCauseProver } from "./minimal-flip-prover.js";
import type {
  CleanVerifierHarnessPort,
  CompactCodeMapQueryPort,
  SymptomCardStorePort,
  TestEnvOrchestratorPort,
  WorktreeSlotPoolPort,
} from "./ports.js";
import { InvestigationReceiptStore } from "./receipt-store.js";
import { StageGateEnforcer } from "./stage-gate-enforcer.js";
import type {
  HypothesisLedgerEntry,
  InvestigationBudget,
  InvestigationRecord,
  InvestigationReceipt,
  PermanentTestSpec,
  ProvenRootCause,
  RedBeforeGreenResult,
  ReproRunResult,
  ReproScript,
  SurgicalFix,
  WriteAttempt,
} from "./types.js";

export const DEFAULT_INVESTIGATION_BUDGET: InvestigationBudget = {
  stageTurns: {
    INTAKE: 0,
    CLEAN_REPRO: 0,
    QUARANTINED_LOCALIZE: 0,
    PROVEN_MINIMAL_FLIP_ROOT_CAUSE: 0,
    SCOPED_FIX: 0,
    PERMANENT_REPRO_AND_MECHANISM_TESTS: 0,
  },
  maxTurnsPerStage: 8,
  reproAttemptLimit: 4,
  reproTimeBudgetMs: 5 * 60 * 1000,
};

export interface MysteryBugInvestigationPipelineOptions {
  readonly store: SqliteInvestigationStore;
  readonly gates?: StageGateEnforcer;
  readonly prover?: MinimalFlipRootCauseProver;
  readonly receipts?: InvestigationReceiptStore;
  readonly symptomCards: SymptomCardStorePort;
  readonly codeMap: CompactCodeMapQueryPort;
  readonly worktrees: WorktreeSlotPoolPort;
  readonly testEnv: TestEnvOrchestratorPort;
  readonly verifier: CleanVerifierHarnessPort;
  readonly budget?: InvestigationBudget;
  readonly now?: () => number;
}

export interface IntakeResult {
  readonly record: InvestigationRecord;
  readonly missingFacts: readonly string[];
  readonly codeMapHits: readonly { path: string; symbol: string }[];
}

export class MysteryBugInvestigationPipeline {
  private readonly store: SqliteInvestigationStore;
  private readonly gates: StageGateEnforcer;
  private readonly prover: MinimalFlipRootCauseProver;
  private readonly receipts: InvestigationReceiptStore;
  private readonly symptomCards: SymptomCardStorePort;
  private readonly codeMap: CompactCodeMapQueryPort;
  private readonly worktrees: WorktreeSlotPoolPort;
  private readonly testEnv: TestEnvOrchestratorPort;
  private readonly verifier: CleanVerifierHarnessPort;
  private readonly budget: InvestigationBudget;
  private readonly now: () => number;
  private readonly scratchPaths: string[] = [];

  constructor(options: MysteryBugInvestigationPipelineOptions) {
    this.store = options.store;
    this.gates = options.gates ?? new StageGateEnforcer();
    this.prover = options.prover ?? new MinimalFlipRootCauseProver();
    this.receipts = options.receipts ?? new InvestigationReceiptStore(options.store);
    this.symptomCards = options.symptomCards;
    this.codeMap = options.codeMap;
    this.worktrees = options.worktrees;
    this.testEnv = options.testEnv;
    this.verifier = options.verifier;
    this.budget = options.budget ?? structuredClone(DEFAULT_INVESTIGATION_BUDGET);
    this.now = options.now ?? (() => Date.now());
  }

  private bumpTurn(stage: InvestigationRecord["stage"]): void {
    const turns = this.budget.stageTurns[stage] + 1;
    if (turns > this.budget.maxTurnsPerStage) {
      throw new StageBudgetExceededError(stage);
    }
    this.budget.stageTurns[stage] = turns;
  }

  startIntake(investigationId: string, symptomCardId: string): IntakeResult {
    const card = this.symptomCards.load(symptomCardId);
    if (!card) {
      throw new StageTransitionForbiddenError("INTAKE", "CLEAN_REPRO", "symptom card not found");
    }
    const record = this.store.create(investigationId, card);
    this.bumpTurn("INTAKE");
    const missingFacts: string[] = [];
    if (!card.environmentNotes?.trim()) {
      missingFacts.push("Which browser/OS version reproduces this?");
    }
    if (card.reproductionSteps.length === 0) {
      missingFacts.push("Exact reproduction steps are required.");
    }
    const codeMapHits = this.codeMap.queryAroundRoutes(card.affectedUrlsOrRoutes);
    return { record, missingFacts, codeMapHits };
  }

  advanceToCleanRepro(investigationId: string): InvestigationRecord {
    const record = this.require(investigationId);
    this.gates.assertStageAdvance(record.stage, "CLEAN_REPRO");
    this.bumpTurn(record.stage);
    return this.store.updateStage(investigationId, "CLEAN_REPRO");
  }

  assertReproWrite(investigationId: string, attempt: WriteAttempt): void {
    const record = this.require(investigationId);
    this.gates.assertWriteAllowed(record.stage, attempt);
  }

  async submitCleanRepro(
    investigationId: string,
    script: ReproScript,
    baselineRun: ReproRunResult,
    instrumentationOnly = false,
  ): Promise<InvestigationRecord> {
    let record = this.require(investigationId);
    if (record.stage !== "CLEAN_REPRO") {
      throw new StageTransitionForbiddenError(record.stage, "QUARANTINED_LOCALIZE", "not in CLEAN_REPRO");
    }
    this.bumpTurn("CLEAN_REPRO");
    record = this.store.incrementReproAttempts(investigationId);

    if (!instrumentationOnly) {
      try {
        this.gates.assertBaselineReproFailure(baselineRun, script.failureFingerprint);
      } catch (error) {
        if (
          record.reproAttempts >= this.budget.reproAttemptLimit ||
          this.reproBudgetExhausted(record)
        ) {
          const escalation =
            "Need Safari version / sample payload — or add targeted telemetry? Tried environments: vitest, http, playwright, cli.";
          this.store.setEscalation(investigationId, escalation);
          throw new UnreproducibleBugEscalation(escalation);
        }
        throw error;
      }
    } else {
      record = this.store.setInstrumentationFallback(investigationId, true);
    }

    const slot = this.worktrees.acquireReadOnlyRepro();
    await this.testEnv.runRepro(slot, script);
    record = this.store.saveReproScript(investigationId, script);
    this.gates.assertStageAdvance(record.stage, "QUARANTINED_LOCALIZE");
    return this.store.updateStage(investigationId, "QUARANTINED_LOCALIZE");
  }

  recordHypothesis(
    investigationId: string,
    entry: Omit<HypothesisLedgerEntry, "recordedAt">,
  ): InvestigationRecord {
    const record = this.require(investigationId);
    if (record.stage !== "QUARANTINED_LOCALIZE") {
      throw new StageTransitionForbiddenError(
        record.stage,
        "PROVEN_MINIMAL_FLIP_ROOT_CAUSE",
        "hypotheses belong in QUARANTINED_LOCALIZE",
      );
    }
    const duplicate = record.hypothesisLedger.some(
      (h) =>
        h.experiment === entry.experiment &&
        h.prediction === entry.prediction &&
        h.result !== "pending",
    );
    if (duplicate) {
      throw new StageTransitionForbiddenError(
        record.stage,
        record.stage,
        "hypothesis experiment fingerprint already recorded",
      );
    }
    this.bumpTurn("QUARANTINED_LOCALIZE");
    const scratch = this.worktrees.acquireQuarantineScratch();
    this.scratchPaths.push(`${scratch.rootPath}/debug-instrumentation.ts`);
    return this.store.appendHypothesis(investigationId, {
      ...entry,
      recordedAt: this.now(),
    });
  }

  async proveRootCause(
    investigationId: string,
    rootCause: ProvenRootCause,
    baselineRun: ReproRunResult,
    expectedFingerprint: string,
  ): Promise<InvestigationRecord> {
    const record = this.require(investigationId);
    if (record.stage !== "QUARANTINED_LOCALIZE") {
      throw new StageTransitionForbiddenError(
        record.stage,
        "PROVEN_MINIMAL_FLIP_ROOT_CAUSE",
        "not localizing",
      );
    }
    this.bumpTurn("QUARANTINED_LOCALIZE");
    await this.prover.prove(baselineRun, rootCause.minimalFlipProof, expectedFingerprint);
    let updated = this.store.saveProvenRootCause(investigationId, rootCause);
    this.gates.assertStageAdvance(updated.stage, "PROVEN_MINIMAL_FLIP_ROOT_CAUSE");
    updated = this.store.updateStage(investigationId, "PROVEN_MINIMAL_FLIP_ROOT_CAUSE");
    this.gates.assertStageAdvance(updated.stage, "SCOPED_FIX");
    return this.store.updateStage(investigationId, "SCOPED_FIX");
  }

  async applyScopedFix(
    investigationId: string,
    fix: SurgicalFix,
    scratchFileContents: readonly string[],
    fixFileContents: readonly string[],
  ): Promise<InvestigationRecord> {
    const record = this.require(investigationId);
    if (record.stage !== "SCOPED_FIX") {
      throw new StageTransitionForbiddenError(
        record.stage,
        "PERMANENT_REPRO_AND_MECHANISM_TESTS",
        "not in SCOPED_FIX",
      );
    }
    this.bumpTurn("SCOPED_FIX");
    this.gates.assertScratchDiscarded(scratchFileContents, fixFileContents);
    for (const summary of [fix.diffSummary]) {
      this.gates.assertFixContentNotBandAid(summary);
    }
    const fixSlot = this.worktrees.acquireCleanFixBase();
    const verification = await this.verifier.verifyScopedFix(fixSlot);
    if (verification.regressions.length > 0) {
      throw new StageTransitionForbiddenError(
        "SCOPED_FIX",
        "PERMANENT_REPRO_AND_MECHANISM_TESTS",
        `regressions: ${verification.regressions.join(", ")}`,
      );
    }
  this.worktrees.discardScratch({ id: "scratch", rootPath: "", mode: "scratch" });
    this.scratchPaths.length = 0;
    const withFix = this.store.saveSurgicalFix(investigationId, fix);
    this.gates.assertStageAdvance(withFix.stage, "PERMANENT_REPRO_AND_MECHANISM_TESTS");
    return this.store.updateStage(investigationId, "PERMANENT_REPRO_AND_MECHANISM_TESTS");
  }

  async finalizePermanentTests(
    investigationId: string,
    tests: PermanentTestSpec,
    redGreen: RedBeforeGreenResult,
  ): Promise<InvestigationReceipt> {
    const record = this.require(investigationId);
    if (record.stage !== "PERMANENT_REPRO_AND_MECHANISM_TESTS") {
      throw new StageTransitionForbiddenError(
        record.stage,
        "PERMANENT_REPRO_AND_MECHANISM_TESTS",
        "not in final stage",
      );
    }
    this.bumpTurn("PERMANENT_REPRO_AND_MECHANISM_TESTS");
    const fixSlot = this.worktrees.acquireCleanFixBase();
    const verification = await this.verifier.verifyScopedFix(fixSlot);
    this.gates.assertPermanentTestsComplete(tests, redGreen, verification.regressions);
    this.store.savePermanentTests(investigationId, tests);
    const falsified = record.hypothesisLedger
      .filter((h) => h.result === "falsified")
      .map((h) => h.hypothesisId);
    const receipt = this.receipts.build(
      investigationId,
      record.symptomCard,
      record.reproScript!,
      record.provenRootCause!,
      record.provenRootCause!.minimalFlipProof.mechanism,
      record.surgicalFix?.diffSummary ?? "",
      [tests.reproTestPath, tests.mechanismTestPath],
      falsified,
    );
    return this.receipts.persist(investigationId, receipt);
  }

  get(investigationId: string): InvestigationRecord | null {
    return this.store.get(investigationId);
  }

  private require(investigationId: string): InvestigationRecord {
    const record = this.store.get(investigationId);
    if (!record) {
      throw new StageTransitionForbiddenError("INTAKE", "INTAKE", `unknown investigation ${investigationId}`);
    }
    return record;
  }

  private reproBudgetExhausted(record: InvestigationRecord): boolean {
    if (record.reproStartedAt === null) return false;
    return this.now() - record.reproStartedAt >= this.budget.reproTimeBudgetMs;
  }
}