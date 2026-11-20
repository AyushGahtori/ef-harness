import { INTEGRATION_REF } from "./constants.js";
import { createLocalSecretScanner, createLocalStaticAuditGate, scanEnvExample, scanMigrations } from "./repo-scan.js";
import { makeFinding } from "./text.js";
import type {
  AuditCheck,
  CheckRunnerPort,
  CleanVerifierHarnessPort,
  ConfirmedFinding,
  LayerAReport,
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
  staticAuditCheck(snapshot: RepoSnapshot): AuditCheck {
    const report = this.staticAudit.auditFeature(snapshot);
    return check("A:static_audit", report.findings);
  }

  /** Full-repo secret scan standing in for gitleaks until Task 036 is wired. */
  secretScanCheck(snapshot: RepoSnapshot): AuditCheck {
    return check("A:secret_scan", this.secrets.scan(snapshot.files));
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
      this.staticAuditCheck(snapshot),
      this.secretScanCheck(snapshot),
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
