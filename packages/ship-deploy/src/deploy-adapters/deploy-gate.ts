import type { DeployApprovalPort } from "./contracts.js";
import type { ApprovalStatus, DeployTargetEnv } from "./types.js";

export function assertDeployDispatchAllowed(
  approval: DeployApprovalPort,
  input: {
    readonly effectType: "deploy" | "sync_env" | "rollback";
    readonly targetEnv: DeployTargetEnv;
    readonly approvalStatus: ApprovalStatus;
    readonly autoApprove?: boolean;
  },
): void {
  approval.assertDispatchAllowed({
    effectType: input.effectType,
    targetEnv: input.targetEnv,
    approvalStatus: input.approvalStatus,
    ...(input.autoApprove === undefined ? {} : { autoApprove: input.autoApprove }),
  });
}