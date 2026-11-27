import { FinalProjectAuditorV1Schema } from "@ef-harness/shared-contracts";
import { InvalidAuditorOutputError } from "./errors.js";

export interface LocatedFinding {
  readonly requirement: string;
  readonly location: string;
  readonly detail: string;
}

export interface WeakCheckFinding {
  readonly check: string;
  readonly requirement: string;
  readonly why: string;
}

export interface FinalProjectAuditorSuccess {
  readonly missing: readonly LocatedFinding[];
  readonly stubbed: readonly LocatedFinding[];
  readonly unhandled_edge_cases: readonly LocatedFinding[];
  readonly weak_checks: readonly WeakCheckFinding[];
  readonly verdict: "complete" | "incomplete";
}

export interface FinalProjectAuditorBlocked {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type FinalProjectAuditorV1 = FinalProjectAuditorSuccess | FinalProjectAuditorBlocked;

/** Validates `final-project-auditor@1` output against canonical `FinalProjectAuditorV1Schema`. */
export function parseFinalProjectAuditorV1(input: unknown): FinalProjectAuditorV1 {
  const parsed = FinalProjectAuditorV1Schema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) =>
        issue.code === "unrecognized_keys"
          ? `unexpected key ${issue.keys.join(", ")}`
          : issue.message,
      )
      .join("; ");
    throw new InvalidAuditorOutputError(details || parsed.error.message);
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

export function isBlockedAuditor(value: FinalProjectAuditorV1): value is FinalProjectAuditorBlocked {
  return "blocked" in value && value.blocked === true;
}
