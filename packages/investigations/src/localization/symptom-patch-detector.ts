import { LocalizationArtifactStore } from "./artifacts.js";
import type { SymptomPatchAudit, SymptomPatchFinding } from "./types.js";

const EMPTY_CATCH = /\+.*catch\s*\([^)]*\)\s*\{\s*\}/m;
const SWALLOW_CATCH_RETURN =
  /\+.*catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:null|undefined|true|false|\[\]|{})\s*;?\s*\}/m;
const ARBITRARY_DELAY =
  /\+.*(?:setTimeout|sleep|delay)\s*\([^)]*(?:300|400|500|1000)/m;
const CRASH_SITE_GUARD =
  /\+.*(?:\?\.[a-zA-Z0-9_.[\]?]+(?:\s*\?\?|\s*\|\|)|if\s*\(\s*!\s*[a-zA-Z_$][\w$]*\s*\)\s*return)/m;
const TEST_WEAKENING =
  /\+.*(?:test\.retries\(\d+\)|expect\([^)]+\)\.toBeCloseTo\(|\.skip\(|\.todo\(|delete\s+[^\n;]+assert)/m;

export type SymptomPatchDetectorOptions = {
  readonly unifiedDiff: string;
  readonly artifactStore?: LocalizationArtifactStore;
};

export class SymptomPatchDetector {
  analyze(options: SymptomPatchDetectorOptions): SymptomPatchAudit {
    const store = options.artifactStore ?? new LocalizationArtifactStore();
    const findings: SymptomPatchFinding[] = [];
    const diff = options.unifiedDiff;

    if (EMPTY_CATCH.test(diff)) {
      findings.push({
        kind: "empty_catch",
        detail: "Newly added empty catch block swallows errors at the failing call site.",
      });
    }
    if (SWALLOW_CATCH_RETURN.test(diff)) {
      findings.push({
        kind: "empty_catch",
        detail: "Catch block returns a sentinel value instead of surfacing the failure.",
      });
    }
    if (ARBITRARY_DELAY.test(diff)) {
      findings.push({
        kind: "arbitrary_delay",
        detail: "Arbitrary setTimeout/sleep delay masks a race or missing await.",
      });
    }
    if (CRASH_SITE_GUARD.test(diff)) {
      findings.push({
        kind: "crash_site_guard",
        detail: "Optional chaining or early return paper-over at crash site without upstream fix.",
      });
    }
    if (TEST_WEAKENING.test(diff)) {
      findings.push({
        kind: "test_weakening",
        detail: "Test retries, looser tolerances, or deleted assertions weaken verification.",
      });
    }

    const auditBase: SymptomPatchAudit = {
      flagged: findings.length > 0,
      findings,
      artifactRef: "",
    };
    const artifactRef = store.put({ symptomPatchAudit: auditBase });
  return { ...auditBase, artifactRef };
  }
}