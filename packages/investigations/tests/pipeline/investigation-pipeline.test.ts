import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openProjectStateDb } from "@ef-harness/db";
import { describe, expect, it } from "vitest";
import { symptomCardFromIntake } from "../../src/pipeline/adapters.js";
import {
  ProductionEditsForbiddenBeforeReproError,
  ReproMustFailOnBaseError,
  StageTransitionForbiddenError,
  UnreproducibleBugEscalation,
} from "../../src/pipeline/errors.js";
import { SqliteInvestigationStore } from "../../src/pipeline/investigation-store.js";
import type { ProvenRootCause, ReproScript } from "../../src/pipeline/types.js";
import {
  cacheRaceCard,
  createPipeline,
  failRun,
  minimalFlipFactory,
  sortCard,
  timezoneCard,
} from "./helpers.js";

function reproScript(id: string, fingerprint: string, surface: ReproScript["surface"]): ReproScript {
  return {
    id,
    surface,
    command: ["pnpm", "vitest", "run", `tests/repro/${id}.test.ts`],
    failureFingerprint: fingerprint,
  };
}

async function driveFullPipeline(
  investigationId: string,
  cardId: string,
  fingerprint: string,
  surface: ReproScript["surface"],
  rootCause: ProvenRootCause,
): Promise<void> {
  const pipeline = createPipeline({
    cards: {
      [cardId]: timezoneCard,
      "cache-race": cacheRaceCard,
      "sort-default": sortCard,
    },
    reproRuns: {
      [investigationId]: failRun(fingerprint),
    },
  });

  const intake = pipeline.startIntake(investigationId, cardId);
  expect(intake.missingFacts).toEqual([]);
  expect(intake.codeMapHits.length).toBeGreaterThan(0);

  pipeline.advanceToCleanRepro(investigationId);
  expect(() =>
    pipeline.assertReproWrite(investigationId, { path: "src/orders/cutoff.ts" }),
  ).toThrow(ProductionEditsForbiddenBeforeReproError);

  const script = reproScript(investigationId, fingerprint, surface);
  await pipeline.submitCleanRepro(
    investigationId,
    script,
    failRun(fingerprint),
  );

  pipeline.recordHypothesis(investigationId, {
    hypothesisId: "h1",
    prediction: "UTC midnight boundary",
    experiment: "toggle local TZ normalization",
    result: "falsified",
  });
  pipeline.recordHypothesis(investigationId, {
    hypothesisId: "h2",
    prediction: rootCause.mechanism,
    experiment: "minimal flip on cutoffBoundary",
    result: "confirmed",
  });

  await pipeline.proveRootCause(
    investigationId,
    rootCause,
    failRun(fingerprint),
    fingerprint,
  );

  await pipeline.applyScopedFix(
    investigationId,
    { paths: [rootCause.file], diffSummary: rootCause.mechanism },
    ["console.log('[DEBUG-99]', cutoffBoundary)"],
    ["export function cutoffBoundary() { return 'local'; }"],
  );

  const receipt = await pipeline.finalizePermanentTests(
    investigationId,
    {
      reproTestPath: `tests/repro/${investigationId}.test.ts`,
      mechanismTestPath: `tests/unit/${investigationId}-mechanism.test.ts`,
    },
    {
      reproFailsOnBase: true,
      mechanismFailsOnBase: true,
      reproPassesOnFix: true,
      mechanismPassesOnFix: true,
    },
  );

  expect(receipt.gitTrailers).toContain(`EF-Investigation: ${investigationId}`);
  expect(receipt.gitTrailers).toContain("EF-Root-Cause-Verified: true");
  expect(receipt.falsifiedHypotheses).toContain("h1");
  expect(pipeline.get(investigationId)?.stage).toBe("PERMANENT_REPRO_AND_MECHANISM_TESTS");
}

describe("MysteryBugInvestigationPipeline", () => {
  it("drives timezone off-by-one through all six stages", async () => {
    const fp = "ERR-TZ-OFF-BY-ONE";
    await driveFullPipeline("bug-tz", "tz", fp, "vitest", {
      file: "src/orders/cutoff.ts",
      symbol: "cutoffBoundary",
      mechanism: "cutoff used UTC instead of local TZ",
      minimalFlipProof: minimalFlipFactory(fp),
    });
  });

  it("drives cache staleness race through all six stages", async () => {
    const fp = "ERR-CACHE-RACE";
    const pipeline = createPipeline({
      cards: { "cache-race": cacheRaceCard },
      reproRuns: { "bug-cache": failRun(fp) },
    });
    pipeline.startIntake("bug-cache", "cache-race");
    pipeline.advanceToCleanRepro("bug-cache");
    await pipeline.submitCleanRepro(
      "bug-cache",
      reproScript("bug-cache", fp, "http"),
      failRun(fp),
    );
    await pipeline.proveRootCause(
      "bug-cache",
      {
        file: "src/dashboard/cache.ts",
        symbol: "invalidateOnNav",
        mechanism: "cache invalidation raced navigation commit",
        minimalFlipProof: minimalFlipFactory(fp),
      },
      failRun(fp),
      fp,
    );
    await pipeline.applyScopedFix(
      "bug-cache",
      { paths: ["src/dashboard/cache.ts"], diffSummary: "await invalidate before paint" },
      [],
      ["export async function invalidateOnNav() { await flush(); }"],
    );
    const receipt = await pipeline.finalizePermanentTests(
      "bug-cache",
      {
        reproTestPath: "tests/repro/bug-cache.test.ts",
        mechanismTestPath: "tests/unit/cache-invalidate.test.ts",
      },
      {
        reproFailsOnBase: true,
        mechanismFailsOnBase: true,
        reproPassesOnFix: true,
        mechanismPassesOnFix: true,
      },
    );
    expect(receipt.symptomSummary).toContain("Stale dashboard totals");
  });

  it("drives wrong default sort through all six stages", async () => {
    const fp = "ERR-SORT-ASC";
    const pipeline = createPipeline({
      cards: { "sort-default": sortCard },
      reproRuns: { "bug-sort": failRun(fp) },
    });
    pipeline.startIntake("bug-sort", "sort-default");
    pipeline.advanceToCleanRepro("bug-sort");
    await pipeline.submitCleanRepro(
      "bug-sort",
      reproScript("bug-sort", fp, "playwright"),
      failRun(fp),
    );
    await pipeline.proveRootCause(
      "bug-sort",
      {
        file: "src/orders/list-query.ts",
        symbol: "defaultSort",
        mechanism: "default sort direction inverted",
        minimalFlipProof: minimalFlipFactory(fp),
      },
      failRun(fp),
      fp,
    );
    await pipeline.applyScopedFix(
      "bug-sort",
      { paths: ["src/orders/list-query.ts"], diffSummary: "defaultSort = desc" },
      [],
      ["export const defaultSort = 'desc';"],
    );
    const receipt = await pipeline.finalizePermanentTests(
      "bug-sort",
      {
        reproTestPath: "tests/repro/bug-sort.test.ts",
        mechanismTestPath: "tests/unit/default-sort.test.ts",
      },
      {
        reproFailsOnBase: true,
        mechanismFailsOnBase: true,
        reproPassesOnFix: true,
        mechanismPassesOnFix: true,
      },
    );
    expect(receipt.permanentTestsAdded).toHaveLength(2);
  });

  it("escalates unreproducible bugs without blind fixes", async () => {
    const pipeline = createPipeline({
      cards: { tz: timezoneCard },
      budget: {
        stageTurns: {
          INTAKE: 0,
          CLEAN_REPRO: 0,
          QUARANTINED_LOCALIZE: 0,
          PROVEN_MINIMAL_FLIP_ROOT_CAUSE: 0,
          SCOPED_FIX: 0,
          PERMANENT_REPRO_AND_MECHANISM_TESTS: 0,
        },
        maxTurnsPerStage: 8,
        reproAttemptLimit: 2,
        reproTimeBudgetMs: 60_000,
      },
    });
    pipeline.startIntake("bug-miss", "tz");
    pipeline.advanceToCleanRepro("bug-miss");
    const script = reproScript("bug-miss", "ERR-TZ", "cli");
    const bogus = { exitCode: 0, output: "ok", fingerprint: "PASS", durationMs: 1 };
    await expect(pipeline.submitCleanRepro("bug-miss", script, bogus)).rejects.toThrow(
      ReproMustFailOnBaseError,
    );
    await expect(pipeline.submitCleanRepro("bug-miss", script, bogus)).rejects.toThrow(
      UnreproducibleBugEscalation,
    );
    const record = pipeline.get("bug-miss");
    expect(record?.escalationMessage).toMatch(/telemetry/i);
    expect(record?.stage).toBe("CLEAN_REPRO");
  });

  it("persists investigations across ProjectStateDb reopen", () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "ef-inv-reopen-"));
    const projectId = `inv-reopen-${process.pid}`;
    const first = openProjectStateDb({ projectId, rootDir, appVersion: "0.0.0" });
    const store = new SqliteInvestigationStore({ state: first, now: () => 50 });
    store.create("bug-persist", timezoneCard);
    store.updateStage("bug-persist", "CLEAN_REPRO");
    first.close();
    const second = openProjectStateDb({ projectId, rootDir, appVersion: "0.0.0" });
    try {
      const reopened = new SqliteInvestigationStore({ state: second, now: () => 60 });
      const record = reopened.get("bug-persist");
      expect(record?.stage).toBe("CLEAN_REPRO");
      expect(record?.symptomCard.title).toBe(timezoneCard.title);
    } finally {
      second.close();
    }
  });

  it("runs the bisector and shrinker while localizing and rejects symptom patches", async () => {
    let bisectCalls = 0;
    let shrinkCalls = 0;
    const pipeline = createPipeline({
      cards: { tz: timezoneCard },
      bisector: {
        async run() {
          bisectCalls += 1;
          return {
            suspectCommit: "abc",
            stability: { badRuns: [], goodRuns: [], targetFingerprint: "ERR-TZ" },
            revertVerified: true,
            skippedCommitCount: 1,
            shallowLimited: false,
            artifactRef: "artifact",
          };
        },
      },
      shrinker: {
        async shrink() {
          shrinkCalls += 1;
          return {
            minimalInput: ["42"],
            evaluations: 1,
            fingerprint: "ERR-TZ",
            artifactRef: "shrink",
          };
        },
      },
      localization: {
        bisect: {
          repoPath: "/tmp/unused",
          badRef: "bad",
          goodRef: "good",
          runRepro: async () => ({ exitCode: 1, output: "ERR-TZ", fingerprint: "ERR-TZ" }),
        },
        shrinkInput: ["42", "189"],
        runWithSubset: async () => ({ exitCode: 1, output: "ERR-TZ", fingerprint: "ERR-TZ" }),
      },
    });
    const fp = "ERR-TZ-OFF-BY-ONE";
    pipeline.startIntake("bug-loc", "tz");
    pipeline.advanceToCleanRepro("bug-loc");
    await pipeline.submitCleanRepro("bug-loc", reproScript("bug-loc", fp, "vitest"), failRun(fp));
    pipeline.recordHypothesis("bug-loc", {
      hypothesisId: "h1",
      prediction: "boundary",
      experiment: "flip",
      result: "falsified",
    });
    await pipeline.proveRootCause(
      "bug-loc",
      {
        file: "src/orders/cutoff.ts",
        symbol: "cutoffBoundary",
        mechanism: "cutoff used UTC instead of local TZ",
        minimalFlipProof: minimalFlipFactory(fp),
      },
      failRun(fp),
      fp,
    );
    expect(bisectCalls).toBe(1);
    expect(shrinkCalls).toBe(1);
    await expect(
      pipeline.applyScopedFix(
        "bug-loc",
        { paths: ["src/orders/cutoff.ts"], diffSummary: "+ catch (error) { }" },
        [],
        ["export function cutoffBoundary() { return 'local'; }"],
      ),
    ).rejects.toBeInstanceOf(StageTransitionForbiddenError);
  });

  it("maps intake symptom cards onto the investigation card", () => {
    const mapped = symptomCardFromIntake({
      id: "card-1",
      title: "Blank total",
      observedBehavior: "Total stays at zero",
      expectedBehavior: "Total matches the line items",
      reproductionSteps: ["Open the cart"],
      affectedUrlsOrRoutes: ["/cart"],
      mappedStackFrames: [],
      failingHttpRequests: [],
      suspectedDomainTags: [],
      missingReproInfo: ["Which browser"],
      severity: "high",
    });
    expect(mapped.environmentNotes).toBe("Which browser");
    expect(mapped.affectedUrlsOrRoutes).toEqual(["/cart"]);
  });
});