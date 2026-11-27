import type { CompletenessGateRunner, WorkspaceFile } from "@ef-harness/completeness-gate";
import type { GitSafetyScanner } from "@ef-harness/git-engine";
import type { CleanVerifierRunner, VerifyCandidateRequest } from "@ef-harness/verifier";
import { INTEGRATION_REF } from "./constants.js";
import { createLocalSecretScanner, createLocalStaticAuditGate, scanEnvExample, scanMigrations } from "./repo-scan.js";
import { makeFinding } from "./text.js";
import type {
  AuditCheck,
  CheckRunnerPort,
  CleanVerifierHarnessPort,
  ConfirmedFinding,
  LayerAReport,
  RepoFile,
  RepoSnapshot,
  SecretScannerPort,
  StaticAuditGatePort,
  SuiteCase,
} from "./types.js";

export interface RepoAuditorDeps {
  readonly fixCostUnits: bigint;
  readonly staticAudit?: StaticAuditGatePort;
  readonly secrets?: SecretScannerPort;
}

function check(id: string, findings: readonly ConfirmedFinding[], suiteCases?: readonly SuiteCase[]): AuditCheck {
  const base = {
    id,
    passed: findings.length === 0 && (suiteCases ? suiteCases.every((item) => item.passed) : true),
    llmTokens: 0 as const,
    findings,
  };
  if (suiteCases) return { ...base, suiteCases };
  return base;
}

/** Binds `@ef-harness/completeness-gate` `CompletenessGateRunner` (`C23`) into `StaticAuditGatePort`. */
export function bindCompletenessGateStaticAudit(
  runner: CompletenessGateRunner,
  options: {
    readonly fixCostUnits?: bigint;
    readonly featureId?: string;
    readonly taskId?: string;
    readonly baseRef?: string;
    readonly candidateRef?: string;
    readonly entryPoints?: readonly string[];
  } = {},
): StaticAuditGatePort {
  const fixCostUnits = options.fixCostUnits ?? 1n;
  return {
    auditFeature(snapshot) {
      const workspaceFiles: WorkspaceFile[] = snapshot.files.map((file) => ({
        path: file.path,
        content: file.content,
      }));
      const report = runner.runFeatureStaticAudit({
        taskId: options.taskId ?? "final-audit",
        featureId: options.featureId ?? "project",
        actor: "integrator",
        baseRef: options.baseRef ?? INTEGRATION_REF,
        candidateRef: options.candidateRef ?? INTEGRATION_REF,
        files: snapshot.files.map((file) => ({
          path: file.path,
          status: "modified" as const,
          afterText: file.content,
        })),
        workspaceFiles,
        featureFiles: workspaceFiles,
        mergedTaskIds: [options.taskId ?? "final-audit"],
        allFeatureTaskIds: [options.taskId ?? "final-audit"],
        produces: [],
        schemaFields: [],
        staticData: [],
        approvedDeferralIds: [],
        excludedGeneratedPaths: [],
        seedFixturePaths: [],
        protectedTestPaths: [],
        protectedTestConfigPaths: [],
        lockedSnapshotPaths: [],
        verificationScopeGrant: false,
        writeScope: snapshot.files.map((file) => file.path),
        integratorConflictHunks: [],
        declaredSharedFiles: snapshot.files.map((file) => file.path),
        errorHandlingRequiresSurface: false,
        entryPoints: options.entryPoints ?? [snapshot.entryFile],
        registeredAssets: [],
        publicFiles: [],
        assetModuleSources: [],
        visibleExampleLiterals: [],
        deletionDeclared: false,
        justifiedTaskNotes: [],
        registry: { names: [] },
        vaultSecrets: [],
      });
      const findings = report.findings.map((finding) =>
        makeFinding({
          code: finding.ruleId,
          kind: "layer_a",
          severity: finding.severity === "hard" ? "high" : "low",
          advisory: finding.severity !== "hard",
          filePath: finding.file,
          lineStart: finding.line,
          detail: finding.message,
          fixCostUnits,
        }),
      );
      return { passed: report.passed, findings };
    },
  };
}

/** Binds `@ef-harness/git-engine` `GitSafetyScanner` into `SecretScannerPort`. */
export function bindGitSafetySecretScanner(
  scanner: GitSafetyScanner,
  options: {
    readonly baseRef?: string;
    readonly candidateRef?: string;
    readonly fixCostUnits?: bigint;
  } = {},
): SecretScannerPort {
  const fixCostUnits = options.fixCostUnits ?? 1n;
  return {
    async scan(files: readonly RepoFile[]) {
      const result = await scanner.scanCommitDiffForSecrets(
        options.baseRef ?? "HEAD~1",
        options.candidateRef ?? "HEAD",
      );
      void files;
      return result.findings.map((hit) =>
        makeFinding({
          code: "secret",
          kind: "layer_a",
          severity: "critical",
          filePath: hit.file,
          lineStart: hit.line,
          detail: `Secret rule ${hit.ruleId} matched ${hit.file}:${hit.line}`,
          fixCostUnits,
        }),
      );
    },
  };
}

/** Binds `@ef-harness/verifier` `CleanVerifierRunner` (`C23`) into `CleanVerifierHarnessPort`. */
export function bindCleanVerifierCombinedHarness(
  runner: CleanVerifierRunner,
  buildRequest: (input: {
    readonly ref: typeof INTEGRATION_REF;
    readonly label: string;
  }) => VerifyCandidateRequest,
): CleanVerifierHarnessPort {
  return {
    async runCombined(input) {
      const outcome = await runner.verifyCandidate(buildRequest(input));
      const cases: SuiteCase[] = outcome.checks.map((item) => ({
        id: item.checkId,
        kind: item.visibility === "held_back" ? "sealed_hidden" : "leaf",
        passed: item.status === "pass",
        featureId: input.label,
      }));
      return { passed: outcome.accepted, cases };
    },
  };
}

export class DeterministicRepoAuditor {
  private readonly fixCostUnits: bigint;
  private readonly staticAudit: StaticAuditGatePort;
  private readonly secrets: SecretScannerPort;

  constructor(deps: RepoAuditorDeps) {
    this.fixCostUnits = deps.fixCostUnits;
    this.staticAudit = deps.staticAudit ?? createLocalStaticAuditGate(deps.fixCostUnits);
    this.secrets = deps.secrets ?? createLocalSecretScanner(deps.fixCostUnits);
  }

  /** Level-2 static audit. Zero model tokens. */
  async staticAuditCheck(snapshot: RepoSnapshot): Promise<AuditCheck> {
    const report = await this.staticAudit.auditFeature(snapshot);
    return check("A:static_audit", report.findings);
  }

  /** Full-repo secret scan standing in for or bound to `GitSafetyScanner`. */
  async secretScanCheck(snapshot: RepoSnapshot): Promise<AuditCheck> {
    return check("A:secret_scan", await this.secrets.scan(snapshot.files));
  }

  migrationCheck(snapshot: RepoSnapshot): AuditCheck {
    return check("A:migration_cleanliness", scanMigrations(snapshot.files, this.fixCostUnits));
  }

  envExampleCheck(snapshot: RepoSnapshot): AuditCheck {
    return check("A:env_example", scanEnvExample(snapshot.files, this.fixCostUnits));
  }

  async commandCheck(kind: "production_build" | "typecheck" | "lint", runner: CheckRunnerPort): Promise<AuditCheck> {
    const result = await runner.run(kind, INTEGRATION_REF);
    const findings = result.passed
      ? []
      : [
          makeFinding({
            code: kind,
            kind: "layer_a",
            severity: "critical",
            detail: result.detail,
            fixCostUnits: this.fixCostUnits,
          }),
        ];
    return check(`A:${kind}`, findings);
  }

  async suiteCheck(verifier: CleanVerifierHarnessPort, label: string): Promise<AuditCheck> {
    const result = await verifier.runCombined({ ref: INTEGRATION_REF, label });
    const findings = result.cases
      .filter((item) => !item.passed)
      .map((item) =>
        makeFinding({
          code: "suite-failure",
          kind: "layer_a",
          severity: "high",
          detail: `${item.kind} ${item.id} failed for ${item.featureId}`,
          requirementId: null,
          fixCostUnits: this.fixCostUnits,
        }),
      );
    return check("A:combined_test_suite", findings, result.cases);
  }

  async auditAll(
    snapshot: RepoSnapshot,
    runner: CheckRunnerPort,
    verifier: CleanVerifierHarnessPort,
    label = "initial",
  ): Promise<LayerAReport> {
    const checks = [
      await this.staticAuditCheck(snapshot),
      await this.secretScanCheck(snapshot),
      this.migrationCheck(snapshot),
      this.envExampleCheck(snapshot),
      await this.commandCheck("production_build", runner),
      await this.commandCheck("typecheck", runner),
      await this.commandCheck("lint", runner),
      await this.suiteCheck(verifier, label),
    ];
    return combineLayerA(checks);
  }
}

export function combineLayerA(checks: readonly AuditCheck[]): LayerAReport {
  const findings = checks.flatMap((item) => item.findings);
  const suite = checks.find((item) => item.id === "A:combined_test_suite");
  return {
    llmTokens: 0,
    passed: checks.every((item) => item.passed),
    checks,
    findings,
    suiteCases: suite?.suiteCases ?? [],
  };
}

export function regressionsAgainst(baseline: readonly SuiteCase[], next: readonly SuiteCase[]) {
  const before = new Map(baseline.map((item) => [item.id, item]));
  const found = [];
  for (const item of next) {
    const prior = before.get(item.id);
    if (prior?.passed && !item.passed) {
      found.push({
        caseId: item.id,
        featureId: item.featureId,
        detail: `${item.id} passed before the audit fix and now fails`,
      });
    }
  }
  return found;
}
