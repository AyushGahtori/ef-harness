import {
  PermanentTestsIncompleteError,
  ProductionEditsForbiddenBeforeReproError,
  ReproMustFailOnBaseError,
  ScratchInstrumentationLeakError,
  StageTransitionForbiddenError,
} from "./errors.js";
import type {
  InvestigationStage,
  PermanentTestSpec,
  RedBeforeGreenResult,
  ReproRunResult,
  WriteAttempt,
} from "./types.js";

const STAGE_ORDER: readonly InvestigationStage[] = [
  "INTAKE",
  "CLEAN_REPRO",
  "QUARANTINED_LOCALIZE",
  "PROVEN_MINIMAL_FLIP_ROOT_CAUSE",
  "SCOPED_FIX",
  "PERMANENT_REPRO_AND_MECHANISM_TESTS",
];

const TEST_WRITE_PREFIXES = ["tests/", "tests\\", "packages/", "packages\\"];
const REPRO_WRITE_PREFIXES = ["tests/repro/", "tests\\repro\\"];

function normalize(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isProductionSrc(path: string): boolean {
  const rel = normalize(path);
  if (!rel.includes("/src/") && !rel.startsWith("src/")) return false;
  return !TEST_WRITE_PREFIXES.some((prefix) => rel.startsWith(prefix) || rel.includes(`/tests/`));
}

function isReproTestWrite(path: string): boolean {
  const rel = normalize(path);
  return REPRO_WRITE_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

function stageIndex(stage: InvestigationStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export class StageGateEnforcer {
  assertStageAdvance(current: InvestigationStage, next: InvestigationStage): void {
    const cur = stageIndex(current);
    const nxt = stageIndex(next);
    if (nxt !== cur + 1) {
      throw new StageTransitionForbiddenError(
        current,
        next,
        "stages must advance sequentially",
      );
    }
  }

  assertWriteAllowed(stage: InvestigationStage, attempt: WriteAttempt): void {
    if (stage === "INTAKE" && isProductionSrc(attempt.path)) {
      throw new ProductionEditsForbiddenBeforeReproError(attempt.path);
    }
    if (stage === "CLEAN_REPRO") {
      if (isProductionSrc(attempt.path)) {
        throw new ProductionEditsForbiddenBeforeReproError(attempt.path);
      }
      if (!isReproTestWrite(attempt.path)) {
        throw new ProductionEditsForbiddenBeforeReproError(
          `${attempt.path} (only tests/repro/** allowed)`,
        );
      }
    }
  }

  assertBaselineReproFailure(
    result: ReproRunResult,
    expectedFingerprint: string,
  ): void {
    if (result.exitCode === 0) {
      throw new ReproMustFailOnBaseError();
    }
    if (result.fingerprint !== expectedFingerprint) {
      throw new ReproMustFailOnBaseError();
    }
  }

  assertScratchDiscarded(
    scratchFileContents: readonly string[],
    fixFileContents: readonly string[],
  ): void {
    const leaks: string[] = [];
    for (const fixContent of fixFileContents) {
      if (/console\.log\s*\(\s*['"]\[DEBUG-/i.test(fixContent)) {
        leaks.push("fix file contains Stage-3 debug console.log");
      }
    }
    for (const scratch of scratchFileContents) {
      for (const fixContent of fixFileContents) {
        if (fixContent.includes(scratch.trim())) {
          leaks.push("scratch instrumentation copied into fix");
        }
      }
    }
    if (leaks.length > 0) {
      throw new ScratchInstrumentationLeakError(leaks);
    }
  }

  assertFixContentNotBandAid(content: string): void {
    const trimmed = content.trim();
    if (/catch\s*\{\s*\}/.test(trimmed)) {
      throw new StageTransitionForbiddenError(
        "SCOPED_FIX",
        "PERMANENT_REPRO_AND_MECHANISM_TESTS",
        "symptom-patch band-aid (empty catch) detected",
      );
    }
    if (/setTimeout\s*\(\s*\(\)\s*=>\s*\{\s*\}\s*,/.test(trimmed)) {
      throw new StageTransitionForbiddenError(
        "SCOPED_FIX",
        "PERMANENT_REPRO_AND_MECHANISM_TESTS",
        "symptom-patch band-aid (noop setTimeout) detected",
      );
    }
  }

  assertPermanentTestsComplete(
    tests: PermanentTestSpec | null,
    redGreen: RedBeforeGreenResult | null,
    verifierRegressions: readonly string[],
  ): void {
    if (!tests?.reproTestPath || !tests.mechanismTestPath) {
      throw new PermanentTestsIncompleteError(
        "both permanent repro and mechanism tests are required",
      );
    }
    if (!redGreen) {
      throw new PermanentTestsIncompleteError("red-before-green proof is missing");
    }
    if (
      !redGreen.reproFailsOnBase ||
      !redGreen.mechanismFailsOnBase ||
      !redGreen.reproPassesOnFix ||
      !redGreen.mechanismPassesOnFix
    ) {
      throw new PermanentTestsIncompleteError(
        "repro and mechanism tests must fail on base and pass on fix",
      );
    }
    if (verifierRegressions.length > 0) {
      throw new PermanentTestsIncompleteError(
        `baseline regressions: ${verifierRegressions.join(", ")}`,
      );
    }
  }
}