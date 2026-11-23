/** Local ports for Task 189 / 190 integrations (sibling branches may differ on this base). */

export interface GradeResult {
  readonly passed: boolean;
  readonly checksPassed: number;
  readonly checksTotal: number;
  readonly failedCheckIds: readonly string[];
  readonly durationMs: number;
  readonly paperworkPct: number;
  readonly securityViolations: readonly string[];
}

export interface BenchmarkCase {
  readonly caseId: string;
  readonly split: "held_out" | "dev";
}

export interface MetaLabBenchmarkRegistryPort {
  readonly suiteDigest: string;
  listCases(split: "held_out" | "dev"): readonly BenchmarkCase[];
  grade(caseId: string, candidateId: string): GradeResult;
}

export interface PromptContaminationScannerPort {
  scan(candidateId: string): { readonly clean: boolean; readonly matches: readonly string[] };
}

export interface ExactInputModelResponseCachePort {
  readonly mode: "use" | "bypass";
  get(inputHash: string): string | undefined;
  put(inputHash: string, response: string): void;
}

export interface SimDevDriverPort {
  readonly mode: "scripted" | "persona" | "replayer";
  runPipeline(caseId: string, candidateId: string): { readonly ok: boolean; readonly tokenCost: number; readonly wallClockMs: number };
}

export interface MockEvalDependencies {
  readonly registry: MetaLabBenchmarkRegistryPort;
  readonly contamination: PromptContaminationScannerPort;
  readonly cache: ExactInputModelResponseCachePort;
  readonly simDev: SimDevDriverPort;
}

export function createMockEvalDependencies(candidateId: string): MockEvalDependencies {
  const cacheStore = new Map<string, string>();
  return {
    registry: {
      suiteDigest: "suite_v1.0_sha_mock",
      listCases(split) {
        const base = [
          { caseId: "batch-resolve-unit-1", split: "dev" as const },
          { caseId: "component-discovery-1", split: "dev" as const },
          { caseId: "held-out-kitchen-1", split: "held_out" as const },
        ];
        return base.filter((row) => row.split === split);
      },
      grade(caseId, id) {
        const isCandidate = id === candidateId;
        return {
          passed: isCandidate ? caseId !== "held-out-kitchen-1" : true,
          checksPassed: isCandidate ? 24 : 25,
          checksTotal: 25,
          failedCheckIds: isCandidate ? ["CHK-CUTOFF-11AM"] : [],
          durationMs: isCandidate ? 780 : 1000,
          paperworkPct: isCandidate ? 0.12 : 0.11,
          securityViolations: [],
        };
      },
    },
    contamination: {
      scan(id) {
        return { clean: !id.includes("contaminated"), matches: id.includes("contaminated") ? ["kitchen cutoff"] : [] };
      },
    },
    cache: {
      mode: "use",
      get(key) {
        return cacheStore.get(key);
      },
      put(key, value) {
        cacheStore.set(key, value);
      },
    },
    simDev: {
      mode: "scripted",
      runPipeline(caseId, id) {
        return {
          ok: id !== `${candidateId}-broken`,
          tokenCost: id === candidateId ? 780 : 1000,
          wallClockMs: id === candidateId ? 120_000 : 150_000,
        };
      },
    },
  };
}