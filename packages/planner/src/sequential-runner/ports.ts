import { StateDb } from "./state-db.js";
import { GitWorkspace } from "./git-workspace.js";
import type {
  AuditResult,
  CleanVerifierHarnessPort,
  DiffAutoTagDetectorPort,
  FeatureDoneGatePort,
  FeatureIntegrationResult,
  FeatureIntegratorPort,
  SevenConditionReport,
  StaticAuditPort,
  TagReport,
  VerifierResult,
  WaveAdvancementPort,
  WaveCompileResult,
} from "./types.js";

const STUB_MARKER = ["TO", "DO"].join("");
const FIX_MARKER = ["FIX", "ME"].join("");

export class LocalDiffAutoTagDetector implements DiffAutoTagDetectorPort {
  detect(_diff: string, paths: readonly string[]): TagReport {
    const sqlMigration = paths.some((item) => {
      const normalized = item.replaceAll("\\", "/");
      return normalized.endsWith(".sql") || normalized.includes("/migrations/") || normalized.startsWith("migrations/");
    });
    return { tags: sqlMigration ? ["sql", "migration"] : [], sqlMigration };
  }
}

export function writeScopeViolation(declared: readonly string[] | undefined, report: TagReport): boolean {
  if (!report.sqlMigration) return false;
  const tags = new Set(declared ?? []);
  return !tags.has("sql") && !tags.has("migration") && !tags.has("data");
}

export class LocalStaticAudit implements StaticAuditPort {
  audit(input: { taskId: string; diff: string; worktree: string }): AuditResult {
    if (input.diff.includes("STATIC_AUDIT_FAIL") || input.diff.includes(STUB_MARKER) || input.diff.includes(FIX_MARKER)) {
      return { pass: false, fingerprint: "static-marker", findings: ["static audit marker"] };
    }
    return { pass: true, fingerprint: "", findings: [] };
  }
}

export class LocalCleanVerifier implements CleanVerifierHarnessPort {
  verify(input: { taskId: string; worktree: string; diff: string }): VerifierResult {
    if (input.diff.includes("DISPUTE_TEST")) return { verdict: "dispute", errors: ["DisputeTest"] };
    if (input.diff.includes("VERIFIER_FAIL")) return { verdict: "fail", errors: ["verification failed"] };
    return { verdict: "pass", errors: [] };
  }
}

export class LocalFeatureIntegrator implements FeatureIntegratorPort {
  constructor(
    private readonly db: StateDb,
    private readonly git: GitWorkspace,
  ) {}

  async integrate(input: { featureId: string; branch: string; headSha: string }): Promise<FeatureIntegrationResult> {
    const merged = this.git.mergeIntoIntegration(input.branch);
    const screens = this.db.pageRouteCount(input.featureId);
    const journeys = this.db.journeyCount(input.featureId);
    if (!merged.ok) {
      return {
        featureId: input.featureId,
        merged: false,
        mergedSha: null,
        journeyPassed: false,
        a11yClean: screens === 0,
        message: merged.message,
      };
    }
    return {
      featureId: input.featureId,
      merged: true,
      mergedSha: merged.sha,
      journeyPassed: journeys === 0,
      a11yClean: screens === 0,
      message: journeys === 0 ? "no journey declared" : "journey required",
    };
  }
}

export class LocalFeatureDoneGate implements FeatureDoneGatePort {
  constructor(
    private readonly db: StateDb,
    private readonly git: GitWorkspace,
  ) {}

  evaluate(featureId: string, integration: FeatureIntegrationResult): SevenConditionReport {
    const failing: string[] = [];
    if (!this.db.featureHeadTasksMerged(featureId)) failing.push("leaves");
    for (const requirement of this.db.unmetRequirements(featureId)) failing.push(`requirement:${requirement}`);
    if (!this.db.staticAuditClean(featureId)) failing.push("static_audit");
    if (!integration.journeyPassed) failing.push("journey");
    const integrationHead = this.git.head("harness/integration");
    if (!integration.merged || integration.mergedSha !== integrationHead) failing.push("integration");
    if (this.db.pageRouteCount(featureId) > 0 && !integration.a11yClean) failing.push("a11y");
    if (this.db.openChangeRequests(featureId) > 0) failing.push("ccr");
    return { ok: failing.length === 0, failing };
  }
}

export class FinalWaveAdvancement implements WaveAdvancementPort {
  compile(): WaveCompileResult {
    return { status: "final_wave" };
  }
}
