import { normalizeWorkerTier } from "@ef-harness/shared-contracts";
import type { WorkerTier } from "@ef-harness/shared-contracts";

export const WORKER_LEVELS = ["junior", "mid", "senior", "principal"] as const;
export type WorkerLevel = (typeof WORKER_LEVELS)[number];

export const BAND_NAMES = ["MUST", "SHOULD", "COULD"] as const;
export type BandName = (typeof BAND_NAMES)[number];

/** Optional brownfield convention header, in the same word-token counter as the brief. */
export const BROWNFIELD_CONVENTION_TOKEN_CAP = 600;
/** Optional recent-sweep symbol map header. */
export const SWEEP_SYMBOL_MAP_TOKEN_CAP = 300;

export const LEVEL_BUDGETS = {
  junior: { targetMin: 2000, targetMax: 3000, hardCeiling: 3200, mustRefusal: 3000 },
  mid: { targetMin: 3000, targetMax: 4500, hardCeiling: 4800, mustRefusal: 4500 },
  senior: { targetMin: 4000, targetMax: 6000, hardCeiling: 6400, mustRefusal: 6000 },
  principal: { targetMin: 6000, targetMax: 8000, hardCeiling: 8400, mustRefusal: 8000 },
} as const;

export const ATTEMPT_COST_USD = { junior: 0.05, mid: 0.15, senior: 0.4, principal: 0.8 } as const;
export const SKILL_COUNT_CAP = 2;
export const SKILL_COMBINED_TOKEN_CAP = 3500;

export const KB_PULL_TOOL_IDS = [
  "kb.search",
  "kb.get_node",
  "kb.list_rules",
  "kb.get_contract",
  "kb.get",
  "kb.neighbors",
  "kb.contract",
  "kb.why",
  "kb.code",
  "kb.get_fact",
] as const;

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export interface SliceNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly status: string;
  readonly fields: Readonly<Record<string, Json>>;
}

export interface SliceEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
  readonly dstVersionPin: number | null;
}

export interface ModuleCardRecord {
  readonly path: string;
  readonly fileHash: string;
  readonly summary: string;
}

export interface SliceGraph {
  readonly taskId: string;
  readonly nodes: readonly SliceNode[];
  readonly edges: readonly SliceEdge[];
  readonly writeScope: readonly string[];
  readonly readScope: readonly string[];
  readonly moduleCards: readonly ModuleCardRecord[];
  readonly level: WorkerLevel;
  readonly featureId: string | null;
  readonly baseBranch: string;
  readonly baseCommit: string;
  readonly epoch: number;
}

export interface ProjectPrefix {
  readonly projectId: string;
  readonly stackOverview: string;
  readonly universalRules: readonly string[];
}

export interface SkillRecord {
  readonly skillId: string;
  readonly version: string;
  readonly sha256: string;
  readonly tokenCount: number;
  readonly vettingStatus: "quarantined" | "vetted" | "revoked" | "rejected";
  readonly allowedRoles: readonly string[];
  readonly allowedTouches: readonly string[];
  readonly text: string;
}

export type SliceBand = "must" | "should" | "could";

export interface SliceItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly band: SliceBand;
  readonly version: number;
  readonly contentHash: string;
  readonly reasons: readonly string[];
  readonly relevance: number;
  readonly contractRole: "consume" | "produce" | null;
  readonly synthetic: boolean;
  readonly pointer: string | null;
  readonly excerpt: boolean;
  readonly sealed: boolean;
}

export interface OracleLeakPreventedAssertion {
  readonly code: "OracleLeakPreventedAssertion";
  readonly nodeId: string;
  readonly linkedTo: readonly string[];
}

export interface TokenBreakdown {
  readonly prefix: number;
  readonly start: number;
  readonly middle: number;
  readonly end: number;
  readonly must: number;
  readonly should: number;
  readonly could: number;
  readonly total: number;
}

export interface PinnedItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly band: SliceBand;
  readonly version: number;
  readonly contentHash: string;
  readonly reasons: readonly string[];
  readonly relevance: number;
  readonly contractRole: "consume" | "produce" | null;
  readonly synthetic: boolean;
  readonly pointer: string | null;
  readonly excerpt: boolean;
  readonly text: string | null;
}

export interface BriefManifest {
  readonly includedNodeIds: readonly string[];
  readonly trimmedShouldIds: readonly string[];
  readonly couldIndexIds: readonly string[];
  readonly tokenBreakdown: TokenBreakdown;
  readonly sliceSha256: string;
  readonly level: WorkerLevel;
  readonly taskId: string;
  readonly nodeVersions: Readonly<Record<string, number>>;
  readonly nodeHashes: Readonly<Record<string, string>>;
  readonly pinnedItems: readonly PinnedItem[];
  readonly project: ProjectPrefix;
  readonly writeScope: readonly string[];
  readonly readScope: readonly string[];
  readonly goal: string;
  readonly briefText: string;
  readonly attemptId: string | null;
}

export interface TokenAttribution {
  readonly id: string;
  readonly title: string;
  readonly tokens: number;
  readonly label: string;
}

export interface SplitRecommendation {
  readonly action: string;
  readonly estimatedUsd: number;
}

export interface OversizedMustDetails {
  readonly taskId: string;
  readonly level: WorkerLevel;
  readonly mustTokens: number;
  readonly ceiling: number;
  readonly attribution: readonly TokenAttribution[];
  readonly recommendations: readonly SplitRecommendation[];
  readonly summary: string;
}

export interface WorkerBriefPacket {
  readonly schema: "task-packet@1";
  readonly task: string;
  readonly attempt: string | null;
  readonly epoch: number;
  readonly brief_version: number;
  readonly base: { readonly branch: string; readonly commit: string };
  readonly goal: string;
  readonly write_scope: readonly string[];
  readonly read_boundary: readonly string[];
  readonly must: readonly { readonly id: string; readonly v: number; readonly text: string }[];
  readonly contracts: readonly { readonly id: string; readonly v: number; readonly role: "consume" | "produce" }[];
  readonly checks_visible: readonly string[];
  readonly checks_hidden_count: number;
  readonly should: readonly { readonly id: string; readonly v: number; readonly text: string }[];
  readonly could: readonly { readonly id: string; readonly pointer: string }[];
  readonly skills: readonly { readonly id: string; readonly digest: string }[];
  readonly tools: readonly string[];
  readonly budget: { readonly usd: number; readonly allowance: Readonly<Record<string, number>>; readonly slots: number };
  readonly limits: { readonly wall_min: number; readonly max_steps: number };
  readonly level: WorkerLevel;
}

export interface CompiledBrief {
  readonly level: WorkerLevel;
  readonly text: string;
  readonly manifest: BriefManifest;
  readonly packet: WorkerBriefPacket;
  readonly leaks: readonly OracleLeakPreventedAssertion[];
  readonly must: readonly SliceItem[];
  readonly should: readonly SliceItem[];
  readonly could: readonly SliceItem[];
  readonly trimmed: readonly SliceItem[];
  readonly effectiveTags: readonly string[];
  readonly matchedRuleIds: readonly string[];
}

export interface SliceRequest {
  readonly level?: WorkerLevel | string;
  readonly project: ProjectPrefix;
  readonly skills?: readonly SkillRecord[];
  readonly attemptId?: string | null;
  readonly role?: string;
  readonly brownfieldConventions?: string;
  readonly recentSweepSymbolMap?: string;
}

export interface SliceBriefRequest {
  readonly graph: SliceGraph;
  readonly project: ProjectPrefix;
  readonly tier?: WorkerTier | string;
  readonly level?: WorkerLevel | string;
  readonly skills?: readonly SkillRecord[];
  readonly attemptId?: string | null;
  readonly role?: string;
  readonly brownfieldConventions?: string;
  readonly recentSweepSymbolMap?: string;
}

export interface BandedItem extends Omit<SliceItem, "band"> {
  readonly band: BandName;
}

export interface CompiledTaskBrief {
  readonly tier: WorkerTier;
  readonly level: WorkerLevel;
  readonly text: string;
  readonly bands: {
    readonly MUST: readonly BandedItem[];
    readonly SHOULD: readonly BandedItem[];
    readonly COULD: readonly BandedItem[];
  };
  readonly brief: CompiledBrief;
}

export interface MustBandOversizeRefusal {
  readonly code: "MustBandOversizeRefusal";
  readonly taskId: string;
  readonly tier: WorkerTier;
  readonly level: WorkerLevel;
  readonly mustTokens: number;
  readonly ceiling: number;
  readonly attribution: readonly TokenAttribution[];
  readonly recommendations: readonly SplitRecommendation[];
  readonly summary: string;
}

export function normalizeLevel(value: string): WorkerLevel {
  const tier = normalizeWorkerTier(value);
  if (tier === "Junior") return "junior";
  if (tier === "Mid") return "mid";
  if (tier === "Senior") return "senior";
  if (tier === "Principal") return "principal";
  if (value.trim().toLowerCase() === "cheap") return "junior";
  throw new Error(`unsupported worker level: ${value}`);
}

export function tierForLevel(level: WorkerLevel): WorkerTier {
  if (level === "junior") return "Junior";
  if (level === "mid") return "Mid";
  if (level === "senior") return "Senior";
  return "Principal";
}

export function includesFailureModes(level: WorkerLevel): boolean {
  return level === "senior" || level === "principal";
}

export function toBandName(band: SliceBand): BandName {
  if (band === "must") return "MUST";
  if (band === "should") return "SHOULD";
  return "COULD";
}

export function fieldString(fields: Readonly<Record<string, Json>>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" ? value : null;
}

export function fieldBool(fields: Readonly<Record<string, Json>>, key: string): boolean {
  const value = fields[key];
  return value === true || value === 1 || value === "true";
}

export function fieldNumber(fields: Readonly<Record<string, Json>>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function fieldStrings(fields: Readonly<Record<string, Json>>, key: string): string[] {
  const value = fields[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function nodeById(graph: SliceGraph, id: string): SliceNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}
