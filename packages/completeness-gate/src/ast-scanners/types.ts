/**
 * Local stand-in for `StaticAuditReportSchema` (Task 008) and the read-only
 * `GitRunner.execGit` result (Task 035). Neither sibling is on this base.
 * Field names match the static-audit contract this engine has to return.
 */

export type StaticAuditSeverity = "hard" | "soft";

export type StaticAuditCoverageMode = "full_ast" | "reduced_text_only";

export type StaticAuditLanguage =
  | "typescript"
  | "javascript"
  | "tsx"
  | "jsx"
  | "python"
  | "go"
  | "rust"
  | "html"
  | "unsupported";

export type AstGrepLanguage = "python" | "go" | "rust";

export type ProducedSymbolKind = "function" | "method" | "handler" | "operation" | "constant";

export interface ProducedSymbol {
  readonly name: string;
  readonly kind: ProducedSymbolKind;
  /** Contract declares a constant literal return, so a trivial return is not a stub. */
  readonly allowsConstantReturn?: boolean;
  /** Contract declares an empty body. */
  readonly allowsEmptyReturn?: boolean;
  /** Contract explicitly allows this symbol to swallow errors. */
  readonly allowsSwallowedErrors?: boolean;
}

export interface StaticAuditConventions {
  /** Plan-owned globs. A worker cannot add to this list. */
  readonly excludedGeneratedPaths: readonly string[];
  /** Plan-owned seed and fixture globs. */
  readonly seedFixturePaths: readonly string[];
  /** Declared cleanup helpers whose empty catches are legitimate. */
  readonly cleanupHelperNames?: readonly string[];
  /** In-scope cross-cutting rules. `X-11` requires surfaced errors. */
  readonly conventionRuleIds?: readonly string[];
  /** Kernel-resolved form of the X-11 surface/rethrow/structured-error rule. */
  readonly requireStructuredErrors?: boolean;
}

export interface StaticAuditBrief {
  readonly sizeEstimateLines?: number;
  /** Rules and branches from the task `MUST` list. */
  readonly must: readonly string[];
  /** Literals copied from visible acceptance examples. */
  readonly visibleExampleLiterals: readonly string[];
  /** True only when the task brief declares a deletion or removal. */
  readonly declaresDeletion: boolean;
  readonly produces: readonly ProducedSymbol[];
}

export interface StaticAuditContext {
  /** Active kernel-approved deferral ids. Membership means the id exists and is approved. */
  readonly approvedDeferralIds: readonly string[];
  readonly conventions: StaticAuditConventions;
  readonly brief: StaticAuditBrief;
  /** Languages whose structural checks may use ast-grep. Unlisted languages stay text-only. */
  readonly astGrepLanguages?: readonly AstGrepLanguage[];
}

export interface StaticAuditFinding {
  readonly ruleId: string;
  readonly severity: StaticAuditSeverity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly message: string;
  readonly remediation: string;
}

export interface StaticAuditFileCoverage {
  readonly file: string;
  readonly language: StaticAuditLanguage;
  readonly coverageMode: StaticAuditCoverageMode;
  readonly textScanExecuted: true;
  readonly typeBuildScan: "typescript-syntax" | "ast-grep" | "unavailable";
  readonly syntaxDiagnosticCount: number;
}

export interface StaticAuditReport {
  readonly schema: "static-audit-report@1";
  readonly coverageMode: StaticAuditCoverageMode;
  readonly findings: readonly StaticAuditFinding[];
  readonly hardFindings: readonly StaticAuditFinding[];
  readonly softFindings: readonly StaticAuditFinding[];
  /** Approved deferral ids actually referenced by the diff. For the landing report. */
  readonly recordedDeferralIds: readonly string[];
  readonly fingerprint: string;
  readonly filesScanned: readonly string[];
  readonly ignoredPaths: readonly string[];
  readonly fileCoverage: readonly StaticAuditFileCoverage[];
}

export type DiffFileStatus = "A" | "M" | "D";

export interface AuditFileInput {
  readonly path: string;
  readonly status: DiffFileStatus | "R" | "C" | "T";
  readonly content?: string;
  readonly previousContent?: string;
  readonly additions?: number;
  readonly deletions?: number;
}

export interface PreparedAuditFile {
  readonly path: string;
  readonly status: DiffFileStatus;
  readonly content: string;
  readonly previousContent: string;
  readonly additions: number;
  readonly deletions: number;
  readonly originalLines: number;
}

export interface StaticAuditInput {
  readonly auditContext: StaticAuditContext;
  /** In-memory diff. Production callers omit this and pass git refs instead. */
  readonly files?: readonly AuditFileInput[];
  readonly repoRoot?: string;
  readonly baseRef?: string;
  readonly candidateRef?: string;
}

/** Read-only slice of Task 035 `GitRunner.execGit`. */
export interface GitExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface GitRunnerPort {
  execGit(
    args: readonly string[],
    options: { readonly cwd: string; readonly timeoutMs?: number },
  ): Promise<GitExecResult>;
}

export interface AstGrepMatch {
  readonly ruleId: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly message: string;
  readonly remediation: string;
}

export interface AstGrepScanResult {
  readonly available: boolean;
  readonly matches: readonly AstGrepMatch[];
}

export interface AstGrepRule {
  readonly id: string;
  readonly language: AstGrepLanguage;
  readonly pattern: string;
  readonly ruleId: string;
  readonly message: string;
  readonly remediation: string;
  /** When true, the match counts only if a produced contract symbol appears in the snippet. */
  readonly contractSymbolOnly: boolean;
}

export interface AstGrepRunner {
  scan(input: {
    readonly language: AstGrepLanguage;
    readonly path: string;
    readonly source: string;
    readonly rules: readonly AstGrepRule[];
  }): Promise<AstGrepScanResult>;
}
