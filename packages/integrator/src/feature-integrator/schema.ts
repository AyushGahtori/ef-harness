import { FeatureIntegratorV1Schema } from "@ef-harness/shared-contracts";
import { InvalidIntegratorOutputError } from "./errors.js";
import type { FeatureIntegratorBlocked, FeatureIntegratorV1 } from "./types.js";

/**
 * Validates `feature-integrator@1` output against canonical `FeatureIntegratorV1Schema`.
 */
export function parseFeatureIntegratorV1(value: unknown): FeatureIntegratorV1 {
  const parsed = FeatureIntegratorV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidIntegratorOutputError(
      parsed.error.issues.map((issue) => issue.message).join("; ") || parsed.error.message,
    );
  }
  const data = parsed.data;
  if ("blocked" in data) {
    return {
      blocked: true,
      reason: data.reason,
      ...(data.missing_ids !== undefined ? { missing_ids: data.missing_ids } : {}),
    };
  }
  return data;
}

export function isBlockedOutput(value: FeatureIntegratorV1): value is FeatureIntegratorBlocked {
  return "blocked" in value && value.blocked === true;
}
