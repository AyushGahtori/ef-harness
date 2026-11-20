import type {
  AstGrepMatch,
  AstGrepRunner,
  GitRunnerPort,
  PreparedAuditFile,
  StaticAuditContext,
  StaticAuditFileCoverage,
  StaticAuditFinding,
  StaticAuditInput,
  StaticAuditReport,
} from "./types.js";
import { STATIC_AUDIT_AST_GREP_RULES, createProcessAstGrepRunner } from "./ast-grep.js";
import { scanJsxDeadControls } from "./dead-controls.js";
import { loadDiffFromGit, prepareAuditFile } from "./diff-load.js";
import { deletionExceedsLimit, scanElision, unplannedDeletionFinding } from "./elision.js";
import { computeStaticAuditFingerprint } from "./fingerprint.js";
import { createProcessGitRunner } from "./git-port.js";
import { dedupeFindings, makeFinding, sortFindings } from "./locate.js";
import { scanTypeScriptMarkers } from "./markers.js";
import { astGrepLanguageOf, isPlanExcluded, isTestPath, isTypeScriptFamily, languageOf } from "./paths.js";
import { maxCyclomatic, scanVisibleExampleBranches, softSummaryFindings } from "./soft-signals.js";
import { scanStubBodies } from "./stubs.js";
import { scanSwallowedErrors } from "./swallowed.js";
import { scanReducedFile } from "./text-scan.js";
import { parseTypeScript, syntaxDiagnosticCount } from "./ts-utils.js";

export interface StaticAuditEngineOptions {
  readonly gitRunner?: GitRunnerPort;
  readonly astGrep?: AstGrepRunner;
}

/**
 * Diff-scoped static audit. Deterministic, no model calls.
 * Exemptions come only from the kernel-supplied audit context.
 */
export class StaticAuditAstEngine {
  private readonly gitRunner: GitRunnerPort;
  private readonly astGrep: AstGrepRunner;

  constructor(options: StaticAuditEngineOptions = {}) {
    this.gitRunner = options.gitRunner ?? createProcessGitRunner();
    this.astGrep = options.astGrep ?? createProcessAstGrepRunner();
  }

  async audit(input: StaticAuditInput): Promise<StaticAuditReport> {
    const files = input.files
      ? input.files.map((file) => prepareAuditFile(file))
      : await loadDiffFromGit({
          gitRunner: this.gitRunner,
          repoRoot: required(input.repoRoot, "repoRoot"),
          baseRef: required(input.baseRef, "baseRef"),
          candidateRef: required(input.candidateRef, "candidateRef"),
        });
    return this.auditPrepared(files, input.auditContext);
  }

  private async auditPrepared(
    files: readonly PreparedAuditFile[],
    auditContext: StaticAuditContext,
  ): Promise<StaticAuditReport> {
    const findings: StaticAuditFinding[] = [];
    const recorded: string[] = [];
    const ignored: string[] = [];
    const coverage: StaticAuditFileCoverage[] = [];
    const scanned: string[] = [];
    let maxComplexity = 0;
    let sawCode = false;

    for (const file of files) {
      if (isPlanExcluded(file.path, auditContext.conventions)) {
        ignored.push(file.path);
        continue;
      }
      if (
        file.status !== "A" &&
        !auditContext.brief.declaresDeletion &&
        deletionExceedsLimit(file.deletions, file.originalLines)
      ) {
        findings.push(unplannedDeletionFinding(file.path, file.deletions, file.originalLines));
      }
      if (file.status === "D" || file.content.includes("\0")) {
        scanned.push(file.path);
        if (file.status !== "D") {
          const language = languageOf(file.path);
          coverage.push(coverageRow(file.path, language, isTypeScriptFamily(language), false, 0));
        }
        continue;
      }

      const language = languageOf(file.path);
      const testFile = isTestPath(file.path);
      scanned.push(file.path);
      findings.push(...scanElision(file.path, file.content));

      if (isTypeScriptFamily(language)) {
        const sourceFile = parseTypeScript(file.path, file.content, language);
        if (!testFile) {
          const markers = scanTypeScriptMarkers(file.path, sourceFile, auditContext);
          findings.push(...markers.findings);
          recorded.push(...markers.recordedDeferralIds);
          findings.push(
            ...scanSwallowedErrors(file.path, sourceFile, auditContext.conventions, auditContext.brief.produces),
          );
        }
        findings.push(...scanStubBodies(file.path, sourceFile, auditContext.brief.produces));
        findings.push(...scanJsxDeadControls(file.path, sourceFile));
        findings.push(
          ...scanVisibleExampleBranches(file.path, sourceFile, auditContext.brief.visibleExampleLiterals),
        );
        sawCode = true;
        maxComplexity = Math.max(maxComplexity, maxCyclomatic(sourceFile));
        coverage.push(coverageRow(file.path, language, true, false, syntaxDiagnosticCount(sourceFile)));
        continue;
      }

      const reduced = scanReducedFile(file, auditContext, {
        markers: !testFile,
        swallowed: !testFile,
      });
      findings.push(...reduced.findings);
      recorded.push(...reduced.recordedDeferralIds);
      sawCode = true;
      maxComplexity = Math.max(maxComplexity, reduced.complexity);
      const astLanguage = astGrepLanguageOf(language);
      let usedGrammar = false;
      if (astLanguage && (auditContext.astGrepLanguages ?? []).includes(astLanguage)) {
        const result = await this.astGrep.scan({
          language: astLanguage,
          path: file.path,
          source: file.content,
          rules: STATIC_AUDIT_AST_GREP_RULES.filter((rule) => rule.language === astLanguage),
        });
        usedGrammar = result.available;
        if (result.available) findings.push(...adaptAstGrep(file, result.matches, auditContext, testFile));
      }
      coverage.push(coverageRow(file.path, language, usedGrammar, usedGrammar, 0));
    }

    const anchor = scanned[0] ?? ignored[0] ?? files[0]?.path ?? "(candidate-diff)";
    findings.push(
      ...softSummaryFindings({
        file: anchor,
        addedLines: files.reduce((sum, file) => sum + file.additions, 0),
        maxComplexity: sawCode ? maxComplexity : 0,
        brief: auditContext.brief,
      }),
    );

    const unique = sortFindings(dedupeFindings(findings));
    const hardFindings = unique.filter((item) => item.severity === "hard");
    const softFindings = unique.filter((item) => item.severity === "soft");
    return {
      schema: "static-audit-report@1",
      coverageMode: coverage.some((item) => item.coverageMode === "reduced_text_only")
        ? "reduced_text_only"
        : "full_ast",
      findings: unique,
      hardFindings,
      softFindings,
      recordedDeferralIds: [...new Set(recorded)].sort((left, right) => left.localeCompare(right)),
      fingerprint: computeStaticAuditFingerprint(hardFindings),
      filesScanned: [...new Set(scanned)].sort((left, right) => left.localeCompare(right)),
      ignoredPaths: [...new Set(ignored)].sort((left, right) => left.localeCompare(right)),
      fileCoverage: [...coverage].sort((left, right) => left.file.localeCompare(right.file)),
    };
  }
}

export function runStaticAudit(input: StaticAuditInput, options: StaticAuditEngineOptions = {}): Promise<StaticAuditReport> {
  return new StaticAuditAstEngine(options).audit(input);
}

function coverageRow(
  file: string,
  language: StaticAuditFileCoverage["language"],
  fullAst: boolean,
  astGrep: boolean,
  syntaxDiagnosticCount: number,
): StaticAuditFileCoverage {
  let typeBuildScan: StaticAuditFileCoverage["typeBuildScan"] = "unavailable";
  if (fullAst && isTypeScriptFamily(language)) typeBuildScan = "typescript-syntax";
  else if (astGrep) typeBuildScan = "ast-grep";
  return {
    file,
    language,
    coverageMode: fullAst ? "full_ast" : "reduced_text_only",
    textScanExecuted: true,
    typeBuildScan,
    syntaxDiagnosticCount,
  };
}

function adaptAstGrep(
  file: PreparedAuditFile,
  matches: readonly AstGrepMatch[],
  auditContext: StaticAuditContext,
  testFile: boolean,
): StaticAuditFinding[] {
  const findings: StaticAuditFinding[] = [];
  for (const match of matches) {
    if (match.ruleId === "swallowed-error" && (testFile || cleanupOwnsLine(file.content, match.line, auditContext))) {
      continue;
    }
    if (match.ruleId === "stub-body" && !stubMatchCounts(file.content, match, auditContext)) continue;
    findings.push(
      makeFinding({
        ruleId: match.ruleId,
        severity: "hard",
        file: file.path,
        line: match.line,
        column: match.column,
        snippet: match.snippet,
        message: match.message,
        remediation: match.remediation,
      }),
    );
  }
  return findings;
}

function stubMatchCounts(content: string, match: AstGrepMatch, auditContext: StaticAuditContext): boolean {
  const lines = content.split(/\r?\n/);
  const window = lines.slice(Math.max(0, match.line - 4), match.line).join("\n");
  const around = `${window}\n${match.snippet}`;
  return auditContext.brief.produces.some((symbol) => {
    if (symbol.kind === "constant") return false;
    if (symbol.allowsConstantReturn || symbol.allowsEmptyReturn) return false;
    return new RegExp(`\\b${symbol.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(around);
  });
}

function cleanupOwnsLine(content: string, line: number, auditContext: StaticAuditContext): boolean {
  const names = auditContext.conventions.cleanupHelperNames ?? [];
  if (names.length === 0) return false;
  const prefix = content.split(/\r?\n/).slice(0, line).join("\n");
  const matches = [...prefix.matchAll(/\b(?:function|def|fn|func)\s+([A-Za-z_]\w*)/g)];
  const name = matches.length > 0 ? matches[matches.length - 1]?.[1] : undefined;
  return name !== undefined && names.includes(name);
}

function required(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`StaticAuditAstEngine requires ${label} when files are not provided`);
  }
  return value;
}
