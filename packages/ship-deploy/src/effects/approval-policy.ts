import {
  ApprovalStalePayloadChangedError,
  EffectNotApprovedError,
  ProductionAlwaysRequiresExplicitApprovalError,
} from "./errors.js";
import type { ApprovalStatus, EffectRecord, EnvApprovalPolicyOptions, TargetEnv } from "./types.js";

const PRODUCTION_TARGETS: ReadonlySet<TargetEnv> = new Set(["production"]);

export interface PolicyEvaluation {
  readonly requiresExplicitApproval: boolean;
  readonly autoAllowEligible: boolean;
  readonly summary: string;
}

export class EnvApprovalPolicyEngine {
  private readonly previewAutoDeployOptIn: boolean;

  constructor(options: EnvApprovalPolicyOptions = {}) {
    this.previewAutoDeployOptIn = options.previewAutoDeployOptIn ?? false;
  }

  evaluate(effectType: string, targetEnv: TargetEnv, autoApprove?: boolean): PolicyEvaluation {
    if (autoApprove === true && PRODUCTION_TARGETS.has(targetEnv)) {
      throw new ProductionAlwaysRequiresExplicitApprovalError(effectType, targetEnv);
    }
    if (targetEnv === "production") {
      return {
        requiresExplicitApproval: true,
        autoAllowEligible: false,
        summary: `Production ${effectType} always requires explicit ApprovalCard approval bound to payload hash`,
      };
    }
    if (targetEnv === "staging") {
      return {
        requiresExplicitApproval: true,
        autoAllowEligible: false,
        summary: `Staging ${effectType} requires ApprovalCard with commit SHA, migration diff, and name-only env diff`,
      };
    }
    if (targetEnv === "git_remote") {
      return {
        requiresExplicitApproval: true,
        autoAllowEligible: false,
        summary: `Git remote ${effectType} requires explicit push/PR ApprovalCard (CI repair pushes may inherit grant)`,
      };
    }
    if (targetEnv === "preview") {
      return {
        requiresExplicitApproval: !this.previewAutoDeployOptIn,
        autoAllowEligible: this.previewAutoDeployOptIn,
        summary: this.previewAutoDeployOptIn
          ? "Preview deploy auto-allowed by project opt-in"
          : "Preview deploy asks on first use",
      };
    }
    return {
      requiresExplicitApproval: true,
      autoAllowEligible: false,
      summary: `${effectType} on ${targetEnv}`,
    };
  }

  initialApprovalStatus(
    effectType: string,
    targetEnv: TargetEnv,
    autoApprove?: boolean,
  ): ApprovalStatus {
    const policy = this.evaluate(effectType, targetEnv, autoApprove);
    if (policy.autoAllowEligible && autoApprove === true) {
      return "auto_allowed";
    }
    if (!policy.requiresExplicitApproval && autoApprove === true) {
      return "auto_allowed";
    }
    return "pending_approval";
  }

  assertDispatchAllowed(record: EffectRecord, options?: { autoApprove?: boolean }): void {
    if (options?.autoApprove === true && record.targetEnv === "production") {
      throw new ProductionAlwaysRequiresExplicitApprovalError(record.effectType, record.targetEnv);
    }
    if (
      record.boundApprovalPayloadHash !== null &&
      record.boundApprovalPayloadHash !== record.canonicalPayloadHash
    ) {
      throw new ApprovalStalePayloadChangedError(record.effectId);
    }
    const allowed: ApprovalStatus[] = ["approved", "auto_allowed"];
    if (!allowed.includes(record.approvalStatus)) {
      throw new EffectNotApprovedError(record.effectId);
    }
    if (record.targetEnv === "production" && record.approvalStatus === "auto_allowed") {
      throw new ProductionAlwaysRequiresExplicitApprovalError(record.effectType, record.targetEnv);
    }
  }

  bindApproval(payloadHash: string): { approvalStatus: ApprovalStatus; boundPayloadHash: string } {
    return { approvalStatus: "approved", boundPayloadHash: payloadHash };
  }
}