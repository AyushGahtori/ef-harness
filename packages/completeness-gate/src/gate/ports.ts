/**
 * Gate ports. Task 058 scanners are the default engine.
 * `bindNameRegistryService` and `bindGitSafetyScanner` call the live
 * `NameRegistryService` and `GitSafetyScanner` methods and adapt their results.
 */
import type { CoverageMode, NameKind, StaticAuditFinding } from "./types.js";

export interface AstScanFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly beforeText: string;
  readonly afterText: string;
  readonly addedLineCount: number;
}

export interface ContractSymbolRef {
  readonly name: string;
  readonly allowsConstantReturn: boolean;
}

export interface AstScanContext {
  readonly files: readonly AstScanFile[];
  readonly approvedDeferralIds: readonly string[];
  readonly contractFunctions: readonly ContractSymbolRef[];
  readonly deletionDeclared: boolean;
  readonly visibleExampleLiterals: readonly string[];
  readonly taskSizeEstimateLines: number | null;
  readonly mustBranchCount: number | null;
  readonly errorHandlingRequiresSurface: boolean;
  readonly excludedGeneratedPaths: readonly string[];
  readonly seedFixturePaths: readonly string[];
}

export interface AstScanResult {
  readonly findings: readonly StaticAuditFinding[];
  readonly softFindings: readonly StaticAuditFinding[];
  readonly coverageMode: CoverageMode;
  readonly recordedDeferrals: readonly string[];
}

export interface StaticAuditAstEngine {
  scan(context: AstScanContext): AstScanResult;
}

export interface ExtractedCodeName {
  readonly kind: NameKind | string;
  readonly value: string;
  readonly file: string;
  readonly line: number;
}

export interface NameAuditFailure {
  readonly kind: string;
  readonly value: string;
  readonly reason: "unregistered" | "foreign_owned";
  readonly file: string;
  readonly line: number;
  readonly owner: string | null;
}

export interface NameRegistryService {
  auditCodeNamesAgainstRegistry(
    names: readonly ExtractedCodeName[],
    featureId: string,
  ): readonly NameAuditFailure[];
}

export interface SecretHit {
  readonly file: string;
  readonly line: number;
  readonly ruleId: string;
  readonly maskedPreview: string;
}

export interface SafetyScanReport {
  readonly blockedSecrets: readonly SecretHit[];
  readonly largeFiles: readonly string[];
  readonly recommendedIgnores: readonly string[];
  readonly proposedGitignoreDiff: string;
  readonly safeToCommit: boolean;
}

export interface GitSafetyScanner {
  scanCommitDiffForSecrets(
    diffText: string,
    vaultSecrets?: readonly string[],
  ): SafetyScanReport;
}
