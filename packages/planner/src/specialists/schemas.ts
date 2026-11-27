import {
  AskOwnerResponderV1Schema,
  ReviewerV1Schema,
  TasteReviewerV1Schema,
} from "@ef-harness/shared-contracts";
import type {
  AskOwnerSchemaPayload,
  ReviewerFindingKind,
  TasteFindingKind,
  TasteSeverity,
} from "./types.js";

export type SchemaParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface ReviewerFindingV1 {
  readonly kind: ReviewerFindingKind;
  readonly location: string;
  readonly explanation: string;
}

export interface ReviewerSuccessV1 {
  readonly blocked?: undefined;
  readonly findings: readonly ReviewerFindingV1[];
  readonly verdict: "ok" | "concerns";
}

export interface BlockedExitV1 {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type ReviewerV1 = ReviewerSuccessV1 | BlockedExitV1;

export interface TasteFindingV1 {
  readonly screen: string;
  readonly region: string;
  readonly kind: TasteFindingKind;
  readonly severity: TasteSeverity;
  readonly suggestion: string;
}

export interface TasteSuccessV1 {
  readonly blocked?: undefined;
  readonly advisory: true;
  readonly findings: readonly TasteFindingV1[];
}

export type TasteReviewerV1 = TasteSuccessV1 | BlockedExitV1;

export type AskOwnerResponderV1 = AskOwnerSchemaPayload | BlockedExitV1;

function blockedFromData(data: {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[] | undefined;
}): BlockedExitV1 {
  return {
    blocked: true,
    reason: data.reason,
    ...(data.missing_ids !== undefined ? { missing_ids: data.missing_ids } : {}),
  };
}

function formatZodIssues(error: { readonly issues: readonly { readonly message: string }[]; readonly message: string }): string {
  return error.issues.map((issue) => issue.message).join("; ") || error.message;
}

export function parseReviewerV1(value: unknown): SchemaParse<ReviewerV1> {
  const parsed = ReviewerV1Schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: formatZodIssues(parsed.error) };
  }
  const data = parsed.data;
  if ("blocked" in data) {
    return { ok: true, value: blockedFromData(data) };
  }
  return { ok: true, value: data };
}

export function parseTasteReviewerV1(value: unknown): SchemaParse<TasteReviewerV1> {
  const parsed = TasteReviewerV1Schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: formatZodIssues(parsed.error) };
  }
  const data = parsed.data;
  if ("blocked" in data) {
    return { ok: true, value: blockedFromData(data) };
  }
  return { ok: true, value: data };
}

export function parseAskOwnerResponderV1(value: unknown): SchemaParse<AskOwnerResponderV1> {
  const parsed = AskOwnerResponderV1Schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: formatZodIssues(parsed.error) };
  }
  const data = parsed.data;
  if ("blocked" in data) {
    return { ok: true, value: blockedFromData(data) };
  }
  return { ok: true, value: data };
}

export function isBlockedExit(
  value: ReviewerV1 | TasteReviewerV1 | AskOwnerResponderV1,
): value is BlockedExitV1 {
  return "blocked" in value && value.blocked === true;
}
