import type { BaselineTestClassification, FlakeClassification, ParsedTestCase } from "./types.js";

export interface FlakeRunFn {
  (testIds: readonly string[]): Promise<readonly ParsedTestCase[]>;
}

export interface ThreeRunFlakeDetectorOptions {
  readonly maxRuns?: number;
  readonly budgetMs?: number;
}

/**
 * Re-run failing tests up to 3× in isolation to separate deterministic failures from flakes.
 */
export class ThreeRunFlakeDetector {
  private readonly maxRuns: number;
  private readonly budgetMs: number;

  constructor(options: ThreeRunFlakeDetectorOptions = {}) {
    this.maxRuns = options.maxRuns ?? 3;
    this.budgetMs = options.budgetMs ?? 30_000;
  }

  async classifyInitialFailures(
    firstRun: readonly ParsedTestCase[],
    rerun: FlakeRunFn,
  ): Promise<readonly FlakeClassification[]> {
    const failing = firstRun.filter((t) => t.status === "fail" || t.status === "error");
    if (failing.length === 0) return [];

    const started = Date.now();
    const passCounts = new Map<string, number>();
    for (const test of failing) passCounts.set(test.testId, 0);

    let runsCompleted = 0;
    const ids = failing.map((t) => t.testId);

    while (runsCompleted < this.maxRuns && Date.now() - started < this.budgetMs) {
      const results = await rerun(ids);
      runsCompleted += 1;
      for (const row of results) {
        if (row.status === "pass") {
          passCounts.set(row.testId, (passCounts.get(row.testId) ?? 0) + 1);
        }
      }
    }

    const out: FlakeClassification[] = [];
    for (const test of failing) {
      const passCount = passCounts.get(test.testId) ?? 0;
      const classification = classifyPasses(passCount, runsCompleted);
      out.push({ testId: test.testId, passCount, runCount: runsCompleted, classification });
    }
    return out;
  }

  classifyFromPassCounts(passCount: number, runCount: number): BaselineTestClassification {
    return classifyPasses(passCount, runCount);
  }
}

function classifyPasses(passCount: number, runCount: number): BaselineTestClassification {
  if (runCount === 0) return "known_failing";
  if (passCount === 0) return "known_failing";
  if (passCount === runCount) return "passing";
  return "baseline_flaky";
}