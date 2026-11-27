import { EntailmentCheckerV1Schema } from "@ef-harness/shared-contracts";

import type { EntailmentVerdict } from "./types.js";

/** `entailment-checker@1` parsed through `@ef-harness/shared-contracts`. */
export type EntailmentCheckerSuccess = {
  readonly verdict: EntailmentVerdict;
  readonly reason: string;
};

export type EntailmentCheckerBlocked = {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
};

export type EntailmentCheckerV1 = EntailmentCheckerSuccess | EntailmentCheckerBlocked;

export function isBlockedEntailment(value: EntailmentCheckerV1): value is EntailmentCheckerBlocked {
  return "blocked" in value && value.blocked === true;
}

export function parseEntailmentCheckerV1(value: unknown): EntailmentCheckerV1 | null {
  const parsed = EntailmentCheckerV1Schema.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  if ("blocked" in data && data.blocked === true) {
    if (data.missing_ids !== undefined && data.missing_ids.length > 0) {
      return { blocked: true, reason: data.reason, missing_ids: data.missing_ids };
    }
    return { blocked: true, reason: data.reason };
  }
  if ("verdict" in data) {
    return { verdict: data.verdict, reason: data.reason };
  }
  return null;
}
