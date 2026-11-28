import type {
  CleanVerifierHarnessPort,
  CompactCodeMapQueryPort,
  SymptomCardStorePort,
  TestEnvOrchestratorPort,
  WorktreeSlotPoolPort,
} from "../../src/pipeline/ports.js";
import type {
  CodeMapHit,
  ReproRunResult,
  ReproScript,
  SymptomCard,
  TestVerificationResult,
  WorktreeSlot,
} from "../../src/pipeline/types.js";
import { SqliteInvestigationStore } from "../../src/pipeline/investigation-store.js";
import {
  MysteryBugInvestigationPipeline,
  type MysteryBugInvestigationPipelineOptions,
} from "../../src/pipeline/pipeline.js";

export function makeStore(now: () => number = () => 1_700_000_000_000): SqliteInvestigationStore {
  return new SqliteInvestigationStore({ now });
}

export class ScriptedSymptomCards implements SymptomCardStorePort {
  constructor(private readonly cards: Record<string, SymptomCard>) {}

  load(cardId: string): SymptomCard | null {
    return this.cards[cardId] ?? null;
  }
}

export class ScriptedCodeMap implements CompactCodeMapQueryPort {
  queryAroundRoutes(routes: readonly string[]): readonly CodeMapHit[] {
    return routes.map((route, index) => ({
      path: `src/feature-${index}/handler.ts`,
      symbol: `handle${index}`,
      route,
    }));
  }
}

export class ScriptedWorktrees implements WorktreeSlotPoolPort {
  private counter = 0;

  acquireReadOnlyRepro(): WorktreeSlot {
    this.counter += 1;
    return { id: `ro-${this.counter}`, rootPath: `/wt/ro-${this.counter}`, mode: "read_only" };
  }

  acquireQuarantineScratch(): WorktreeSlot {
    this.counter += 1;
    return { id: `sc-${this.counter}`, rootPath: `/wt/sc-${this.counter}`, mode: "scratch" };
  }

  acquireCleanFixBase(): WorktreeSlot {
    this.counter += 1;
    return { id: `fx-${this.counter}`, rootPath: `/wt/fx-${this.counter}`, mode: "clean_fix" };
  }

  discardScratch(slot: WorktreeSlot): void {
    void slot;
  }
}

export class ScriptedTestEnv implements TestEnvOrchestratorPort {
  constructor(
    private readonly runs: Record<string, ReproRunResult>,
    private readonly tests: Record<string, ReproRunResult> = {},
  ) {}

  async runRepro(_slot: WorktreeSlot, script: ReproScript): Promise<ReproRunResult> {
    return this.runs[script.id] ?? failRun(script.failureFingerprint);
  }

  async runNamedTest(
    slot: WorktreeSlot,
    testPath: string,
    _label: "repro" | "mechanism",
  ): Promise<ReproRunResult> {
    void slot;
    void _label;
    return this.tests[testPath] ?? passRun();
  }
}

export class ScriptedVerifier implements CleanVerifierHarnessPort {
  constructor(private readonly regressions: readonly string[] = []) {}

  async verifyScopedFix(slot: WorktreeSlot): Promise<TestVerificationResult> {
    void slot;
    return { exitCode: this.regressions.length === 0 ? 0 : 1, regressions: this.regressions };
  }
}

export function createPipeline(
  partial: Partial<MysteryBugInvestigationPipelineOptions> & {
    cards: Record<string, SymptomCard>;
    reproRuns?: Record<string, ReproRunResult>;
  },
): MysteryBugInvestigationPipeline {
  const now = partial.now ?? (() => 1_700_000_000_000);
  const store = partial.store ?? makeStore(now);
  return new MysteryBugInvestigationPipeline({
    store,
    symptomCards: partial.symptomCards ?? new ScriptedSymptomCards(partial.cards),
    codeMap: partial.codeMap ?? new ScriptedCodeMap(),
    worktrees: partial.worktrees ?? new ScriptedWorktrees(),
    testEnv: partial.testEnv ?? new ScriptedTestEnv(partial.reproRuns ?? {}),
    verifier: partial.verifier ?? new ScriptedVerifier(),
    ...(partial.bisector ? { bisector: partial.bisector } : {}),
    ...(partial.shrinker ? { shrinker: partial.shrinker } : {}),
    ...(partial.patchDetector ? { patchDetector: partial.patchDetector } : {}),
    ...(partial.localization ? { localization: partial.localization } : {}),
    gates: partial.gates,
    prover: partial.prover,
    receipts: partial.receipts,
    budget: partial.budget,
    now,
  });
}

export function failRun(fingerprint: string): ReproRunResult {
  return {
    exitCode: 1,
    output: fingerprint,
    fingerprint,
    durationMs: 12,
  };
}

export function passRun(): ReproRunResult {
  return { exitCode: 0, output: "ok", fingerprint: "PASS", durationMs: 8 };
}

export const timezoneCard: SymptomCard = {
  title: "Order cutoff off by one day",
  observedBehavior: "Orders after 23:00 UTC land on the wrong calendar day",
  expectedBehavior: "Orders should use the user's local timezone boundary",
  reproductionSteps: ["Set TZ=Pacific/Auckland", "Place order at 23:05 local"],
  affectedUrlsOrRoutes: ["/api/orders/cutoff"],
  environmentNotes: "Node 22, vitest",
};

export const cacheRaceCard: SymptomCard = {
  title: "Stale dashboard totals",
  observedBehavior: "Dashboard shows old totals for ~200ms after refresh",
  expectedBehavior: "Totals update atomically with the navigation",
  reproductionSteps: ["Open dashboard", "Refresh twice quickly"],
  affectedUrlsOrRoutes: ["/dashboard"],
  environmentNotes: "Chromium + http integration",
};

export const sortCard: SymptomCard = {
  title: "Wrong default sort",
  observedBehavior: "Orders list defaults to ascending createdAt",
  expectedBehavior: "Orders list defaults to descending createdAt",
  reproductionSteps: ["Visit /orders"],
  affectedUrlsOrRoutes: ["/orders"],
  environmentNotes: "Playwright contract",
};

export function minimalFlipFactory(
  fingerprint: string,
): import("../../src/pipeline/types.js").MinimalFlipProof {
  return {
    rootCauseFile: "src/orders/cutoff.ts",
    rootCauseSymbol: "cutoffBoundary",
    mechanism: "local timezone boundary uses UTC midnight",
    applyFlip: async () => passRun(),
    revertFlip: async () => failRun(fingerprint),
  };
}