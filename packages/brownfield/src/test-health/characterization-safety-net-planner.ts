import type { CharacterizationSafetyNetPlan, CharacterizationTestSpec, ParsedTestCase } from "./types.js";
import { stableTestId } from "./test-reporter-parser.js";

export interface CharacterizationPlannerOptions {
  readonly minTests?: number;
  readonly maxTests?: number;
}

/**
 * Plans P0.B-Char characterization tests when a repo has zero coverage on targeted modules.
 */
export class CharacterizationSafetyNetPlanner {
  private readonly minTests: number;
  private readonly maxTests: number;

  constructor(options: CharacterizationPlannerOptions = {}) {
    this.minTests = options.minTests ?? 3;
    this.maxTests = options.maxTests ?? 8;
  }

  needsSafetyNet(testFileCount: number, targetedModules: readonly string[], moduleCoverage: Map<string, number>): boolean {
    if (testFileCount === 0) return targetedModules.length > 0;
    return targetedModules.some((mod) => (moduleCoverage.get(mod) ?? 0) === 0);
  }

  plan(targetModules: readonly string[], skippedByDeveloper = false): CharacterizationSafetyNetPlan {
    const capped = targetModules.slice(0, this.maxTests);
    const tests: CharacterizationTestSpec[] = [];
    let index = 0;
    for (const modulePath of capped) {
      if (tests.length >= this.maxTests) break;
      const title = `characterizes current behavior of ${basename(modulePath)}`;
      tests.push({
        testId: stableTestId(modulePath, title),
        modulePath,
        title,
        source: "generated",
      });
      index += 1;
      if (index >= this.minTests && tests.length >= this.minTests) {
        // continue until max or modules exhausted
      }
    }
    while (tests.length < this.minTests && capped.length > 0) {
      const modulePath = capped[tests.length % capped.length]!;
      const title = `characterizes edge case ${tests.length + 1} in ${basename(modulePath)}`;
      tests.push({
        testId: stableTestId(modulePath, title),
        modulePath,
        title,
        source: "generated",
      });
    }

    return {
      phaseId: "P0.B-Char",
      targetModules: capped,
      tests,
      skippedByDeveloper,
      baselineGreenVerified: false,
    };
  }

  verifyBaselineGreen(plan: CharacterizationSafetyNetPlan, baselineResults: readonly ParsedTestCase[]): CharacterizationSafetyNetPlan {
    if (plan.skippedByDeveloper) {
      return { ...plan, baselineGreenVerified: false };
    }
    const fails = baselineResults.filter((r) => r.status === "fail" || r.status === "error");
    const plannedIds = new Set(plan.tests.map((t) => t.testId));
    const inaccurate = fails.filter((f) => plannedIds.has(f.testId));
    if (inaccurate.length > 0) {
      return { ...plan, baselineGreenVerified: false };
    }
    const allGreen = plan.tests.every((spec) => baselineResults.some((r) => r.testId === spec.testId && r.status === "pass"));
    return { ...plan, baselineGreenVerified: allGreen };
  }
}

function basename(filePath: string): string {
  const parts = filePath.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] ?? filePath;
}