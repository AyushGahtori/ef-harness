import { createHash } from "node:crypto";

/** Task 090 research envelope: 3% of the wave budget. */
export const RESEARCH_BUDGET_NUMERATOR = 3;
export const RESEARCH_BUDGET_DENOMINATOR = 100;

/** Same 90-day horizon as `global.db.research_cache` (`expires_at = fetched_at + TTL`). */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const RESEARCH_CACHE_TTL_MS = 90 * DAY_MS;

export const QUOTE_MIN_CHARS = 10;
export const QUOTE_MIN_ALIGNMENT_PERCENT = 95;

export const RESEARCHER_ROLE = "feature-researcher@1" as const;
export const RESEARCHER_TOOL_AUTHORITY = "none" as const;

export type VerifiedBy = "quote_matcher" | "installed_types" | "both";

export type TopicKind =
  | "stack_compatibility"
  | "major_version_api"
  | "saas_webhook_oauth"
  | "windows_native"
  | "db_driver_orm"
  | "security_compliance"
  | "cross_cutting_risk"
  | "library"
  | "feature_risk";

export type TopicDisposition = "selected" | "deferred_to_installed_types" | "skipped_trivial";

export interface StackPackage {
  readonly name: string;
  readonly version: string;
}

export interface TopicSignal {
  readonly id: string;
  readonly title: string;
  readonly text?: string;
  readonly riskTags?: readonly string[];
  readonly libraryName?: string;
  readonly fromVersion?: string;
  readonly toVersion?: string;
  readonly kindHint?:
    | "stack"
    | "library"
    | "service"
    | "native"
    | "database"
    | "security"
    | "feature"
    | "language_basic";
  readonly targetNodeIds?: readonly string[];
  readonly docUrl?: string;
}

export interface ResearchBudget {
  readonly waveTokenBudget: number;
  readonly tokensPerTopic: number;
  readonly waveMicroUsd?: number;
  readonly microUsdPerTopic?: number;
}

export interface ResearchFact {
  readonly claim: string;
  readonly exactQuote: string;
  readonly sourceUrl: string;
  readonly docVersion: string;
  readonly fetchedAt: string;
  readonly verifiedBy: VerifiedBy;
}

export function researchTokenCap(waveTokenBudget: number): number {
  assertSafeNonNegative(waveTokenBudget, "waveTokenBudget");
  return Math.floor((waveTokenBudget * RESEARCH_BUDGET_NUMERATOR) / RESEARCH_BUDGET_DENOMINATOR);
}

export function researchMicroUsdCap(waveMicroUsd: number): number {
  assertSafeNonNegative(waveMicroUsd, "waveMicroUsd");
  return Math.floor((waveMicroUsd * RESEARCH_BUDGET_NUMERATOR) / RESEARCH_BUDGET_DENOMINATOR);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalTopicHash(parts: {
  readonly kind: string;
  readonly title: string;
  readonly libraryName: string | null;
  readonly majorMinor: string | null;
}): string {
  const payload = JSON.stringify({
    kind: parts.kind,
    libraryName: parts.libraryName,
    majorMinor: parts.majorMinor,
    title: parts.title.normalize("NFC").trim(),
  });
  return sha256Hex(payload);
}

export function majorMinor(version: string | null | undefined): string | null {
  if (!version) return null;
  const match = /v?(\d+)\.(\d+)/.exec(version.trim());
  if (!match?.[1] || !match[2]) return null;
  return `${match[1]}.${match[2]}`;
}

export function majorNumber(version: string | null | undefined): number | null {
  if (!version) return null;
  const trimmed = version.trim().replace(/^v/i, "");
  const match = /^(\d+)/.exec(trimmed);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

export function assertSafeNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export function topicCacheDocUrl(topicHash: string): string {
  return `ef-topic:${topicHash}`;
}
