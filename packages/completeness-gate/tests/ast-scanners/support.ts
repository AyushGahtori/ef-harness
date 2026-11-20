import { StaticAuditAstEngine } from "../../src/ast-scanners/index.js";
import type {
  AstGrepLanguage,
  AuditFileInput,
  ProducedSymbol,
  StaticAuditContext,
  StaticAuditReport,
} from "../../src/ast-scanners/index.js";

export const MARKER_TODO = ["TO", "DO"].join("");
export const MARKER_FIXME = ["FIX", "ME"].join("");

export function createContext(input: {
  readonly approvedDeferralIds?: readonly string[];
  readonly excludedGeneratedPaths?: readonly string[];
  readonly seedFixturePaths?: readonly string[];
  readonly cleanupHelperNames?: readonly string[];
  readonly conventionRuleIds?: readonly string[];
  readonly requireStructuredErrors?: boolean;
  readonly must?: readonly string[];
  readonly visibleExampleLiterals?: readonly string[];
  readonly declaresDeletion?: boolean;
  readonly produces?: readonly ProducedSymbol[];
  readonly sizeEstimateLines?: number;
  readonly astGrepLanguages?: readonly AstGrepLanguage[];
} = {}): StaticAuditContext {
  return {
    approvedDeferralIds: input.approvedDeferralIds ?? [],
    ...(input.astGrepLanguages ? { astGrepLanguages: input.astGrepLanguages } : {}),
    conventions: {
      excludedGeneratedPaths: input.excludedGeneratedPaths ?? [],
      seedFixturePaths: input.seedFixturePaths ?? [],
      ...(input.cleanupHelperNames ? { cleanupHelperNames: input.cleanupHelperNames } : {}),
      ...(input.conventionRuleIds ? { conventionRuleIds: input.conventionRuleIds } : {}),
      ...(input.requireStructuredErrors ? { requireStructuredErrors: true as const } : {}),
    },
    brief: {
      must: input.must ?? [],
      visibleExampleLiterals: input.visibleExampleLiterals ?? [],
      declaresDeletion: input.declaresDeletion ?? false,
      produces: input.produces ?? [],
      ...(input.sizeEstimateLines !== undefined ? { sizeEstimateLines: input.sizeEstimateLines } : {}),
    },
  };
}

export function audit(
  files: readonly AuditFileInput[],
  input: Parameters<typeof createContext>[0] = {},
): Promise<StaticAuditReport> {
  return new StaticAuditAstEngine().audit({ files, auditContext: createContext(input) });
}

export function ruleIds(report: StaticAuditReport, severity: "hard" | "soft" = "hard"): string[] {
  const findings = severity === "hard" ? report.hardFindings : report.softFindings;
  return findings.map((finding) => finding.ruleId);
}
