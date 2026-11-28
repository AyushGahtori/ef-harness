import { ProductionRequiresExplicitApprovalError } from "./errors.js";
import type { ApprovalCardPayload, ApprovalStatus, DeployTargetEnv } from "./types.js";
import { formatApprovalLines } from "./name-diff.js";
import type { DeployApprovalPort } from "./contracts.js";

export class DeployApprovalPolicyEngine implements DeployApprovalPort {
  private readonly previewAutoDeployOptIn: boolean;

  constructor(options?: { readonly previewAutoDeployOptIn?: boolean }) {
    this.previewAutoDeployOptIn = options?.previewAutoDeployOptIn ?? false;
  }

  requiresExplicitApproval(effectType: string, targetEnv: DeployTargetEnv): boolean {
    if (targetEnv === "production" || targetEnv === "staging") return true;
    if (targetEnv === "preview") return !this.previewAutoDeployOptIn;
    return true;
  }

  assertDispatchAllowed(input: {
    readonly effectType: string;
    readonly targetEnv: DeployTargetEnv;
    readonly approvalStatus: ApprovalStatus;
    readonly autoApprove?: boolean;
  }): void {
    if (input.targetEnv === "production") {
      if (input.autoApprove === true || input.approvalStatus === "auto_allowed") {
        throw new ProductionRequiresExplicitApprovalError(input.effectType);
      }
      if (input.approvalStatus !== "approved") {
        throw new ProductionRequiresExplicitApprovalError(input.effectType);
      }
    }
    if (input.targetEnv === "staging" && input.approvalStatus === "pending_approval") {
      throw new ProductionRequiresExplicitApprovalError(input.effectType);
    }
  }

  buildApprovalPayload(input: ApprovalCardPayload): { readonly lines: readonly string[] } {
    const envLines = formatApprovalLines(input.envDiff);
    const lines = [
      `commit ${input.commitSha}`,
      `target ${input.targetEnv}`,
      `effect ${input.effectType}`,
      `payload ${input.canonicalPayloadHash}`,
      ...(input.migrationStatus ? [`migrations ${input.migrationStatus}`] : []),
      ...envLines,
    ];
    return { lines };
  }
}