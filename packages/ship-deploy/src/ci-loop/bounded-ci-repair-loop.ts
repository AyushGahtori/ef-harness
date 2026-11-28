import type { BaseBranchCiSnapshot, CiRepairDependencies } from "./contracts.js";
import { computeFailureFingerprint } from "./failure-fingerprint.js";
import { extractSecretName, FiveClassCiTriager } from "./five-class-ci-triager.js";
import type { CiClassification, CiFailureInput, RepairLoopDecision } from "./types.js";

export const MAX_PUSHES_PER_FINGERPRINT = 3;
export const MAX_TOTAL_REPAIR_PUSHES = 5;

export class BoundedCiRepairLoop {
  private readonly triager = new FiveClassCiTriager();

  constructor(private readonly deps: CiRepairDependencies) {}

  decideNext(params: {
    readonly shipRunId: string;
    readonly failure: CiFailureInput;
    readonly prNumber: number;
    readonly awaitingMergeApproval?: boolean;
    readonly greenCheckCount?: number;
    readonly baseSnapshot?: BaseBranchCiSnapshot;
  }): RepairLoopDecision {
    if (params.greenCheckCount !== undefined && params.greenCheckCount > 0 && params.awaitingMergeApproval !== false) {
      return {
        kind: "celebrate_green",
        message: `All ${params.greenCheckCount} CI checks passed — Ready to merge PR #${params.prNumber} or deploy!`,
      };
    }

    const classification = this.triager.classify(params.failure, params.baseSnapshot);
    return this.routeClassification(params.shipRunId, classification, params.failure);
  }

  private routeClassification(
    shipRunId: string,
    classification: CiClassification,
    failure: CiFailureInput,
  ): RepairLoopDecision {
    const fingerprint = computeFailureFingerprint({
      errorType: classification.operationalClass,
      filePath: classification.triage.evidence_lines[0] ?? failure.jobName,
      message: classification.triage.evidence_lines.join(" | "),
    });

    if (classification.operationalClass === "class_5_preexisting_main") {
      return { kind: "report_preexisting" };
    }

    if (classification.operationalClass === "class_4_missing_secret") {
      const secretName = extractSecretName(failure.logExcerpt) ?? "UNKNOWN_SECRET";
      return { kind: "surface_secret_card", secretName };
    }

    if (classification.operationalClass === "class_3_transient") {
      return { kind: "rerun_failed_jobs", fingerprint };
    }

    if (!classification.allowsAutomatedCodeRepair) {
      return {
        kind: "escalate_human",
        reason: "Failure class does not allow automated code repair",
        fingerprint,
      };
    }

    return this.evaluatePushBudget(shipRunId, fingerprint);
  }

  private evaluatePushBudget(shipRunId: string, fingerprint: string): RepairLoopDecision {
    const record = this.deps.store.get(shipRunId);
    const perFingerprint = record?.repairPushesByFingerprint[fingerprint] ?? 0;
    const total = record?.totalRepairPushes ?? 0;

    if (perFingerprint >= MAX_PUSHES_PER_FINGERPRINT || total >= MAX_TOTAL_REPAIR_PUSHES) {
      return {
        kind: "escalate_human",
        reason: "CI repair paused after 3 attempts on the same error — Inspect logs / Fix by hand",
        fingerprint,
      };
    }

    return { kind: "push_repair", fingerprint, pushNumber: perFingerprint + 1 };
  }

  async executeRepairPush(shipRunId: string, effectId: string, fingerprint: string): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    const local = await this.deps.verifier.runFullSuite();
    if (!local.ok) {
      return { ok: false, reason: local.detail ?? "local verification failed" };
    }

    const scan = await this.deps.scanner.scanCommitRange("origin/main", "HEAD");
    if (scan.length > 0) {
      return { ok: false, reason: "gitleaks blocked CI repair push" };
    }

    const record = this.deps.store.get(shipRunId);
    const perFingerprint = record?.repairPushesByFingerprint[fingerprint] ?? 0;
    if (perFingerprint >= MAX_PUSHES_PER_FINGERPRINT) {
      return { ok: false, reason: "fingerprint push cap reached" };
    }

    this.deps.ledger.recordGitPush(effectId, { shipRunId, fingerprint, pushNumber: perFingerprint + 1 });
    return { ok: true };
  }
}