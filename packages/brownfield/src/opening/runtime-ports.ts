import type { BrownfieldL0RepoScanner } from "../l0-scan/brownfield-l0-repo-scanner.js";
import type { CompactCodeMapQueryService } from "../l1-codemap/compact-code-map-query-service.js";
import type { ModuleCardStorePort } from "../l2-cards/ports.js";
import { MODULE_CARD_PROMPT_VERSION } from "../l2-cards/types.js";
import type { StaleDocsDetector, StaleDocsDetectorOptions } from "../l2-cards/stale-docs-detector.js";
import type {
  BrownfieldL0RepoScannerPort,
  CompactCodeMapQueryServicePort,
  DiscoverySessionCoordinatorPort,
  ModuleCardCacheEnginePort,
  StaleDocsDetectorPort,
} from "./contracts.js";

export interface ObservedPreSettleCoordinator {
  preSettleObservedCriteria(input: {
    readonly workItemId: string;
    readonly settlements: readonly { readonly criterionId: string; readonly value: string }[];
  }): {
    readonly settledCriterionIds: readonly string[];
  };
}

export function adaptL0Scanner(scanner: BrownfieldL0RepoScanner): BrownfieldL0RepoScannerPort {
  return {
    scanSummary(repoRoot) {
      const result = scanner.scan({ repoRoot });
      const primary = result.stack.languages[0]?.language ?? null;
      return {
        languagePrimary: primary,
        frameworks: result.stack.frameworks.frameworks,
        orms: result.stack.frameworks.orm,
        uiKits: result.stack.frameworks.uiKits,
        testRunners: result.stack.frameworks.testRunners,
        testFileCount: result.files.filter((file) => /\.(test|spec)\./.test(file.path)).length,
        authLibraries: [],
        stackSummaryLine: result.stack.frameworks.frameworks.join(", ") || primary || "unknown",
        configFiles: result.files
          .map((file) => file.path)
          .filter((path) => /(package\.json|tsconfig|eslint|prettier)/i.test(path)),
        contributorDocPaths: result.docs
          .map((doc) => doc.path)
          .filter((path) => /(agents|contributing|readme)/i.test(path)),
      };
    },
  };
}

export function adaptCodeMap(service: CompactCodeMapQueryService): CompactCodeMapQueryServicePort {
  return {
    listModulesForPaths(paths) {
      return service
        .topRankedFiles(80)
        .filter((row) => paths.some((path) => row.path === path || row.path.startsWith(`${path}/`)))
        .map((row) => ({
          id: row.path,
          label: row.path,
          paths: [row.path],
          hubScore: row.score,
        }));
    },
    entryRoutes() {
      return service
        .topRankedFiles(80)
        .map((row) => row.path)
        .filter((path) => path.includes("/app/") || path.includes("/pages/"));
    },
  };
}

export function adaptModuleCards(
  store: ModuleCardStorePort,
  hashes: ReadonlyMap<string, string>,
): ModuleCardCacheEnginePort {
  return {
    cardsForModuleIds(moduleIds) {
      return moduleIds.flatMap((moduleId) => {
        const fileContentSha256 = hashes.get(moduleId);
        if (!fileContentSha256) return [];
        const stored = store.get({
          filePath: moduleId,
          fileContentSha256,
          promptVersion: MODULE_CARD_PROMPT_VERSION,
        });
        if (!stored) return [];
        return [
          {
            moduleId,
            purpose: stored.card.purpose,
            keyExports: stored.card.key_exports.map((entry) => entry.name),
          },
        ];
      });
    },
  };
}

export function adaptStaleDocs(
  detector: StaleDocsDetector,
  options: StaleDocsDetectorOptions,
): StaleDocsDetectorPort {
  return {
    detectStaleDocs() {
      return detector
        .analyze(options)
        .filter((finding) => finding.status === "likely_stale")
        .map((finding) => ({
          path: finding.docPath,
          reason: finding.evidence[0] ?? "likely stale",
        }));
    },
  };
}

export function adaptDiscovery(coordinator: ObservedPreSettleCoordinator): DiscoverySessionCoordinatorPort {
  return {
    preSettleObservedCriteria(input) {
      const result = coordinator.preSettleObservedCriteria({
        workItemId: input.workItemId,
        settlements: input.settlements.map((settlement) => ({
          criterionId: settlement.criterionId,
          value: settlement.value,
        })),
      });
      return {
        applied: result.settledCriterionIds.length,
        skippedGreenfieldStackQuestions: true,
      };
    },
  };
}
