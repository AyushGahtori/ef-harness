import {
  anthropicOauthPrefix,
  CLAUDE_SUBSCRIPTION_REJECTION,
} from "./prefix-fragments.js";

export interface ComplianceInspection {
  readonly allowed: boolean;
  readonly code: "ok" | "subscription_oauth_rejected";
  readonly message: string;
}

/**
 * Local stand-in for Task 135 `CompliancePolicyLocks`.
 * Integration swaps this class for the signed policy engine's lock implementation.
 */
export interface CompliancePolicyLocksPort {
  inspectApiKey(normalizedKey: string): ComplianceInspection;
}

export class LocalCompliancePolicyLocks implements CompliancePolicyLocksPort {
  inspectApiKey(normalizedKey: string): ComplianceInspection {
    if (normalizedKey.startsWith(anthropicOauthPrefix)) {
      return {
        allowed: false,
        code: "subscription_oauth_rejected",
        message: CLAUDE_SUBSCRIPTION_REJECTION,
      };
    }
    return { allowed: true, code: "ok", message: "" };
  }
}
