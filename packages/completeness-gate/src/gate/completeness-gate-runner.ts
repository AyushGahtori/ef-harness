import { scanHardcodedData } from "./check-hardcoded-data.js";
import { scanNamesAndAssets } from "./check-names-assets.js";
import { scanReachability } from "./check-reachability.js";
import { scanOutOfScope } from "./check-scope.js";
import { scanTestTampering } from "./check-test-tampering.js";
import { scanTypeEscapes } from "./check-type-escapes.js";
import { diffAddedLines, unifiedAdditions, type AddedLine } from "./diff-lines.js";
import { makeFinding } from "./findings.js";
import { computeStaticAuditFingerprint } from "./fingerprint.js";
import { createLocalStaticAuditAstEngine } from "./local-ast-engine.js";
import { createLocalNameRegistry } from "./local-name-registry.js";
import { createLocalGitSafetyScanner } from "./local-safety-scanner.js";
import { normalizePath } from "./path-match.js";
import type { AstScanFile, GitSafetyScanner, NameRegistryService, StaticAuditAstEngine } from "./ports.js";
import type {
  AuditActor,
  AuditLevel,
  ChangedFile,
  FeatureAuditInput,
  LeafAuditInput,
  StaticAuditFinding,
  StaticAuditReport,
  WorkspaceFile,
} from "./types.js";

export interface CompletenessGateDependencies {
  readonly astEngine: StaticAuditAstEngine;
  readonly safetyScanner: GitSafetyScanner;
  readonly nameRegistry?: NameRegistryService;
}

interface PreparedFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: ChangedFile["status"];
  readonly before: string;
  readonly after: string;
  readonly added: readonly AddedLine[];
  readonly lines: readonly string[];
}

/**
 * Unified STATIC_AUDIT gate for leaf tasks, feature completion, integrator
 * commits, and developer "I fixed it myself" candidates.
 */
export class CompletenessGateRunner {
  constructor(private readonly deps: CompletenessGateDependencies) {}

  runLeafStaticAudit(input: LeafAuditInput): StaticAuditReport {
    const corpus = input.workspaceFiles ?? synthesize(input.files);
    return this.execute("leaf", input, corpus, false);
  }

  runFeatureStaticAudit(input: FeatureAuditInput): StaticAuditReport {
    const corpus =
      input.featureFiles.length > 0
        ? input.featureFiles
        : (input.workspaceFiles ?? synthesize(input.files));
    const featureClosed =
      input.allFeatureTaskIds.length === 0 ||
      input.allFeatureTaskIds.every((id) => input.mergedTaskIds.includes(id));
    return this.execute("feature", input, corpus, featureClosed);
  }

  private execute(
    level: AuditLevel,
    input: LeafAuditInput,
    corpus: readonly WorkspaceFile[],
    featureClosed: boolean,
  ): StaticAuditReport {
    const diffFiles = input.files.map(prepareFile);
    const textFiles = level === "feature" ? corpus.map(asText) : diffFiles
      .filter((file) => file.status !== "deleted")
      .map((file) => ({ path: file.path, content: file.after }));
    const ast = this.deps.astEngine.scan({
      files: astFiles(level, diffFiles, corpus),
      approvedDeferralIds: input.approvedDeferralIds,
      contractFunctions: input.produces
        .filter((item) => item.kind === "function")
        .map((item) => ({
          name: item.name,
          allowsConstantReturn: item.allowsConstantReturn === true,
        })),
      deletionDeclared: input.deletionDeclared,
      visibleExampleLiterals: input.visibleExampleLiterals,
      taskSizeEstimateLines: input.taskSizeEstimateLines ?? null,
      mustBranchCount: input.mustBranchCount ?? null,
      errorHandlingRequiresSurface: input.errorHandlingRequiresSurface,
      excludedGeneratedPaths: input.excludedGeneratedPaths,
      seedFixturePaths: input.seedFixturePaths,
    });
    const escapes = scanTypeEscapes(
      diffFiles.map((file) => ({ path: file.path, lines: file.lines, added: file.added })),
      input.justifiedTaskNotes,
      input.excludedGeneratedPaths,
      input.seedFixturePaths,
    );
    const registry = this.deps.nameRegistry ?? createLocalNameRegistry(input.registry);
    const secretReport = this.deps.safetyScanner.scanCommitDiffForSecrets(
      diffFiles.map((file) => unifiedAdditions(file.path, file.added)).join("\n"),
      input.vaultSecrets,
    );
    const secretFindings = secretReport.blockedSecrets.map((hit) =>
      makeFinding({
        ruleId: "check11.secret",
        file: hit.file,
        line: hit.line,
        column: 1,
        snippet: hit.maskedPreview,
        message: `Secret pattern ${hit.ruleId} at ${hit.file}:${hit.line}.`,
        remediation: "Remove the secret from the diff. The preview is redacted.",
      }),
    );
    const exportRoots = (level === "feature" ? corpus.map((file) => file.path) : diffFiles.map((file) => file.path));
    const hard = [
      ...ast.findings,
      ...scanHardcodedData(textFiles, input.staticData, input.excludedGeneratedPaths, input.seedFixturePaths),
      ...scanTestTampering(
        diffFiles.map((file) => ({ path: file.path, content: file.after, added: file.added })),
        input.protectedTestPaths,
        input.protectedTestConfigPaths,
        input.lockedSnapshotPaths,
        input.verificationScopeGrant,
      ),
      ...escapes.findings,
      ...scanReachability(corpus, {
        level,
        featureClosed,
        produces: input.produces,
        schemaFields: input.schemaFields,
        entryPoints: input.entryPoints,
        generated: input.excludedGeneratedPaths,
        seeds: input.seedFixturePaths,
        exportRoots,
      }),
      ...scanNamesAndAssets(
        textFiles,
        input.featureId,
        registry,
        input.registeredAssets,
        input.publicFiles,
        input.assetModuleSources,
        input.excludedGeneratedPaths,
        input.seedFixturePaths,
      ),
      ...scanOutOfScope(
        diffFiles.map((file) => ({
          path: file.path,
          ...(file.previousPath ? { previousPath: file.previousPath } : {}),
          added: file.added,
        })),
        input.actor,
        input.writeScope,
        input.integratorConflictHunks,
        input.declaredSharedFiles,
      ),
      ...secretFindings,
    ];
    const override = resolveOverride(input.actor, input.humanOverride, hard.length);
    const findings = sortFindings(override.extra ? [...hard, override.extra] : hard);
    const softFindings = sortFindings(ast.softFindings);
    const fingerprint = computeStaticAuditFingerprint(findings);
    const passed = override.applied || findings.length === 0;
    const receipt = {
      lintEscapesCount: escapes.allowed.length,
      allowedEscapes: escapes.allowed,
      recordedDeferrals: ast.recordedDeferrals,
      softFindingCount: softFindings.length,
      fingerprint,
      humanOverride: override.applied
        ? {
            signedBy: "developer" as const,
            reason: input.humanOverride?.reason.trim() ?? "",
            findingCount: hard.length,
          }
        : null,
      secretHitCount: secretFindings.length,
    };
    const landingSummary = renderSummary({
      level,
      taskId: input.taskId,
      passed,
      overrideApplied: override.applied,
      overrideReason: override.applied ? (input.humanOverride?.reason.trim() ?? "") : "",
      findings,
      softCount: softFindings.length,
      escapeCount: escapes.allowed.length,
    });
    return {
      level,
      taskId: input.taskId,
      featureId: input.featureId,
      actor: input.actor,
      passed,
      coverageMode: ast.coverageMode,
      findings,
      softFindings,
      receipt,
      fingerprint,
      overrideApplied: override.applied,
      landingSummary,
    };
  }
}

export function createCompletenessGateRunner(
  overrides: Partial<CompletenessGateDependencies> = {},
): CompletenessGateRunner {
  return new CompletenessGateRunner({
    astEngine: overrides.astEngine ?? createLocalStaticAuditAstEngine(),
    safetyScanner: overrides.safetyScanner ?? createLocalGitSafetyScanner(),
    ...(overrides.nameRegistry ? { nameRegistry: overrides.nameRegistry } : {}),
  });
}

function resolveOverride(
  actor: AuditActor,
  request: LeafAuditInput["humanOverride"],
  findingCount: number,
): { applied: boolean; extra: StaticAuditFinding | null } {
  if (!request) return { applied: false, extra: null };
  if (actor !== "human") {
    return {
      applied: false,
      extra: makeFinding({
        ruleId: "check.override-forbidden",
        file: "(audit)",
        line: 1,
        column: 1,
        snippet: "developer override",
        message: "Only a developer can record a static-audit override. AI workers cannot exempt findings.",
        remediation: "Fix the findings. Do not attach a human override.",
      }),
    };
  }
  if (request.signedBy !== "developer" || request.reason.trim().length === 0) {
    return {
      applied: false,
      extra: makeFinding({
        ruleId: "check.override-invalid",
        file: "(audit)",
        line: 1,
        column: 1,
        snippet: "override",
        message: "Developer override requires a non-empty reason.",
        remediation: "Record the reason for accepting the findings.",
      }),
    };
  }
  void findingCount;
  return { applied: true, extra: null };
}

function prepareFile(file: ChangedFile): PreparedFile {
  const before = file.beforeText ?? "";
  const after = file.afterText ?? "";
  const added = file.status === "deleted" ? [] : diffAddedLines(before, after);
  return {
    path: normalizePath(file.path),
    ...(file.previousPath ? { previousPath: normalizePath(file.previousPath) } : {}),
    status: file.status,
    before,
    after,
    added,
    lines: after.split(/\r?\n/),
  };
}

function synthesize(files: readonly ChangedFile[]): WorkspaceFile[] {
  return files
    .filter((file) => file.status !== "deleted")
    .map((file) => ({ path: normalizePath(file.path), content: file.afterText ?? "" }));
}

function asText(file: WorkspaceFile): { path: string; content: string } {
  return { path: normalizePath(file.path), content: file.content };
}

function astFiles(
  level: AuditLevel,
  diffFiles: readonly PreparedFile[],
  corpus: readonly WorkspaceFile[],
): AstScanFile[] {
  const map = new Map<string, AstScanFile>();
  if (level === "feature") {
    for (const file of corpus) {
      const path = normalizePath(file.path);
      map.set(path, {
        path,
        status: "added",
        beforeText: "",
        afterText: file.content,
        addedLineCount: file.content.length === 0 ? 0 : file.content.split(/\r?\n/).length,
      });
    }
  }
  for (const file of diffFiles) {
    map.set(file.path, {
      path: file.path,
      status: file.status,
      beforeText: file.before,
      afterText: file.after,
      addedLineCount: file.added.length,
    });
  }
  return [...map.values()];
}

function sortFindings(findings: readonly StaticAuditFinding[]): StaticAuditFinding[] {
  return [...findings].sort((left, right) => {
    return (
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.message.localeCompare(right.message)
    );
  });
}

function renderSummary(input: {
  readonly level: AuditLevel;
  readonly taskId: string;
  readonly passed: boolean;
  readonly overrideApplied: boolean;
  readonly overrideReason: string;
  readonly findings: readonly StaticAuditFinding[];
  readonly softCount: number;
  readonly escapeCount: number;
}): string {
  const status = input.overrideApplied
    ? `PASS (developer override: ${input.overrideReason})`
    : input.passed
      ? "PASS"
      : "FAIL";
  const lines = [
    `STATIC_AUDIT ${input.level} ${input.taskId}: ${status}`,
    ...input.findings.map((finding) => `- ${finding.file}:${finding.line} [${finding.ruleId}] ${finding.message}`),
  ];
  if (input.softCount > 0) lines.push(`Soft findings: ${input.softCount}`);
  lines.push(`Lint escapes: ${input.escapeCount}`);
  return lines.join("\n");
}
