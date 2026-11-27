import { scanJsxDeadControls } from "../ast-scanners/dead-controls.js";
import { prepareAuditFile } from "../ast-scanners/diff-load.js";
import { deletionExceedsLimit, scanElision, unplannedDeletionFinding } from "../ast-scanners/elision.js";
import { scanTypeScriptMarkers } from "../ast-scanners/markers.js";
import { isPlanExcluded, isTestPath, isTypeScriptFamily, languageOf } from "../ast-scanners/paths.js";
import { maxCyclomatic, scanVisibleExampleBranches, softSummaryFindings } from "../ast-scanners/soft-signals.js";
import { scanStubBodies } from "../ast-scanners/stubs.js";
import { scanSwallowedErrors } from "../ast-scanners/swallowed.js";
import { scanReducedFile } from "../ast-scanners/text-scan.js";
import { parseTypeScript } from "../ast-scanners/ts-utils.js";
import type {
  ProducedSymbol,
  StaticAuditBrief,
  StaticAuditContext,
  StaticAuditConventions,
  StaticAuditFinding as AstFinding,
} from "../ast-scanners/index.js";
import type { AstScanContext, AstScanFile, AstScanResult, StaticAuditAstEngine } from "./ports.js";
import type { StaticAuditFinding } from "./types.js";

const RULE_IDS: Readonly<Record<string, string>> = {
  "stub-body": "ast.stub",
  "unfinished-marker": "ast.marker",
  "dead-ui-control": "ast.dead-control",
  "swallowed-error": "ast.swallowed-error",
  "elision-placeholder": "ast.elision",
  "unplanned-large-deletion": "ast.large-deletion",
  "visible-example-special-case": "ast.special-case",
  "diff-smaller-than-estimate": "ast.small-diff",
  "complexity-below-must": "ast.low-complexity",
};

/**
 * Gate port over Task 058 `StaticAuditAstEngine` scanners.
 * `audit()` is async because it can load a git diff; the in-memory path is the
 * same synchronous scanner pipeline, so `scan()` can return `AstScanResult`.
 */
export function createTask058AstEngine(): StaticAuditAstEngine {
  return { scan };
}

function scan(context: AstScanContext): AstScanResult {
  const auditContext = toAuditContext(context);
  const hard: StaticAuditFinding[] = [];
  const soft: StaticAuditFinding[] = [];
  const recorded: string[] = [];
  const scanned: string[] = [];
  let reduced = false;
  let addedLines = 0;
  let maxComplexity = 0;
  let sawCode = false;

  for (const file of context.files) {
    const prepared = prepareAuditFile({
      path: file.path,
      status: auditStatus(file.status),
      content: file.afterText,
      previousContent: file.beforeText,
    });
    if (isPlanExcluded(prepared.path, auditContext.conventions)) continue;
    if (
      prepared.status !== "A" &&
      !auditContext.brief.declaresDeletion &&
      deletionExceedsLimit(prepared.deletions, prepared.originalLines)
    ) {
      accept(unplannedDeletionFinding(prepared.path, prepared.deletions, prepared.originalLines), hard, soft);
    }
    if (prepared.status === "D" || prepared.content.includes("\0")) {
      scanned.push(prepared.path);
      if (prepared.status !== "D") reduced = true;
      continue;
    }

    addedLines += prepared.additions;
    scanned.push(prepared.path);
    for (const finding of scanElision(prepared.path, prepared.content)) accept(finding, hard, soft);

    const language = languageOf(prepared.path);
    const testFile = isTestPath(prepared.path);
    if (isTypeScriptFamily(language)) {
      const sourceFile = parseTypeScript(prepared.path, prepared.content, language);
      if (!testFile) {
        const markers = scanTypeScriptMarkers(prepared.path, sourceFile, auditContext);
        for (const finding of markers.findings) accept(finding, hard, soft);
        recorded.push(...markers.recordedDeferralIds);
        for (const finding of scanSwallowedErrors(
          prepared.path,
          sourceFile,
          auditContext.conventions,
          auditContext.brief.produces,
        )) {
          accept(finding, hard, soft);
        }
      }
      for (const finding of scanStubBodies(prepared.path, sourceFile, auditContext.brief.produces)) {
        accept(finding, hard, soft);
      }
      for (const finding of scanJsxDeadControls(prepared.path, sourceFile)) accept(finding, hard, soft);
      for (const finding of scanVisibleExampleBranches(
        prepared.path,
        sourceFile,
        auditContext.brief.visibleExampleLiterals,
      )) {
        accept(finding, hard, soft);
      }
      sawCode = true;
      maxComplexity = Math.max(maxComplexity, maxCyclomatic(sourceFile));
      continue;
    }

    reduced = true;
    const reducedScan = scanReducedFile(prepared, auditContext, {
      markers: !testFile,
      swallowed: !testFile,
    });
    for (const finding of reducedScan.findings) accept(finding, hard, soft);
    recorded.push(...reducedScan.recordedDeferralIds);
    sawCode = true;
    maxComplexity = Math.max(maxComplexity, reducedScan.complexity);
  }

  const anchor = scanned[0] ?? context.files[0]?.path ?? "(diff)";
  for (const finding of softSummaryFindings({
    file: anchor,
    addedLines,
    maxComplexity: sawCode ? maxComplexity : 0,
    brief: auditContext.brief,
  })) {
    accept(finding, hard, soft);
  }

  return {
    findings: hard,
    softFindings: soft,
    coverageMode: reduced ? "reduced_text_only" : "full",
    recordedDeferrals: [...new Set(recorded)].sort((left, right) => left.localeCompare(right)),
  };
}

function toAuditContext(context: AstScanContext): StaticAuditContext {
  const produces: ProducedSymbol[] = context.contractFunctions.map((item) => ({
    name: item.name,
    kind: "function",
    ...(item.allowsConstantReturn ? { allowsConstantReturn: true } : {}),
  }));
  const brief: StaticAuditBrief = {
    must:
      context.mustBranchCount === null
        ? []
        : Array.from({ length: context.mustBranchCount }, () => "branch"),
    visibleExampleLiterals: context.visibleExampleLiterals,
    declaresDeletion: context.deletionDeclared,
    produces,
    ...(context.taskSizeEstimateLines === null
      ? {}
      : { sizeEstimateLines: context.taskSizeEstimateLines }),
  };
  const conventions: StaticAuditConventions = {
    excludedGeneratedPaths: context.excludedGeneratedPaths,
    seedFixturePaths: context.seedFixturePaths,
    ...(context.errorHandlingRequiresSurface ? { requireStructuredErrors: true } : {}),
  };
  return {
    approvedDeferralIds: context.approvedDeferralIds,
    conventions,
    brief,
  };
}

function auditStatus(status: AstScanFile["status"]): "A" | "M" | "D" | "R" {
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  return "M";
}

function accept(finding: AstFinding, hard: StaticAuditFinding[], soft: StaticAuditFinding[]): void {
  const mapped: StaticAuditFinding = {
    ruleId: RULE_IDS[finding.ruleId] ?? finding.ruleId,
    severity: finding.severity,
    file: finding.file,
    line: finding.line,
    column: finding.column,
    snippet: finding.snippet,
    message: finding.message,
    remediation: finding.remediation,
  };
  if (mapped.severity === "soft") soft.push(mapped);
  else hard.push(mapped);
}
