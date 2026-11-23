import { PROTECTED_DEFAULT_BRANCHES } from "./types.js";

export interface PushPolicyInput {
  readonly targetBranch: string;
  readonly force: boolean;
  readonly forceWithLease: boolean;
  readonly harnessOwnedPrBranch: boolean;
  readonly userApprovedForceWithLease: boolean;
  readonly branchProtected: boolean;
}

export interface PushPolicyVerdict {
  readonly allowed: boolean;
  readonly reason: string;
}

export function evaluatePushPolicy(input: PushPolicyInput): PushPolicyVerdict {
  const defaultBranch = PROTECTED_DEFAULT_BRANCHES.includes(
    input.targetBranch as (typeof PROTECTED_DEFAULT_BRANCHES)[number],
  );
  if (input.force && (defaultBranch || input.branchProtected)) {
    return {
      allowed: false,
      reason: `git push --force is forbidden on protected branch '${input.targetBranch}'`,
    };
  }
  if (input.force && !input.harnessOwnedPrBranch) {
    return { allowed: false, reason: "Force push is only allowed on harness-owned PR branches" };
  }
  if (input.forceWithLease) {
    if (!input.harnessOwnedPrBranch || !input.userApprovedForceWithLease) {
      return {
        allowed: false,
        reason: "--force-with-lease requires explicit user approval on a harness-owned PR branch",
      };
    }
  }
  return { allowed: true, reason: "Push allowed" };
}