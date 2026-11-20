import type { BandOverride, SlicerPromotionHook } from "./ports/knowledge-packet-slicer.js";
import { mustFits } from "./ports/token-budget.js";
import type { PullReadRecord } from "./pull-read-analytics-recorder.js";
import { uniqueSorted } from "./text.js";
import {
  PULL_TAG_TASK_THRESHOLD,
  PULL_WAVE_RATIO_DENOMINATOR,
  PULL_WAVE_RATIO_NUMERATOR,
  type KnowledgeBand,
  type WorkerLevel,
} from "./types.js";

export type PromotionReason =
  | "repeated_pull_tag"
  | "wave_pull_ratio"
  | "late_verification_failure";

export interface PullObservation {
  readonly projectId: string;
  readonly waveId: string;
  readonly waveIndex: number;
  readonly taskId: string;
  readonly tags: readonly string[];
  readonly nodeId: string;
  readonly workerLevel: WorkerLevel;
  readonly currentMustTokens: number;
  readonly nodeTokenCost: number;
  readonly currentBand: KnowledgeBand;
}

export interface LateVerificationFailure {
  readonly projectId: string;
  readonly waveId: string;
  readonly waveIndex: number;
  readonly taskId: string;
  readonly tags: readonly string[];
  readonly nodeId: string;
  readonly workerLevel: WorkerLevel;
  readonly currentMustTokens: number;
  readonly nodeTokenCost: number;
  readonly currentBand: KnowledgeBand;
  readonly pulledLate: boolean;
}

export interface WaveMembership {
  readonly projectId: string;
  readonly waveId: string;
  readonly waveIndex: number;
  readonly taskIds: readonly string[];
}

export interface FeedbackInput {
  readonly pulls: readonly PullObservation[];
  readonly lateFailures: readonly LateVerificationFailure[];
  readonly waves: readonly WaveMembership[];
}

export interface PromotionRecommendation {
  readonly projectId: string;
  readonly nodeId: string;
  readonly tag: string;
  readonly fromBand: "COULD" | "SHOULD";
  readonly toBand: "SHOULD" | "MUST";
  readonly reasons: readonly PromotionReason[];
  readonly effectiveWave: number;
  readonly distinctTasks: number;
  readonly taskIds: readonly string[];
  readonly wavePullers: number | null;
  readonly waveMembers: number | null;
  readonly tokenCost: number;
  readonly capped: boolean;
}

interface TaskFact {
  taskId: string;
  projectId: string;
  waveId: string;
  waveIndex: number;
  tags: Set<string>;
  workerLevel: WorkerLevel;
  currentMustTokens: number;
  nodeTokenCost: number;
  currentBand: KnowledgeBand;
  pulled: boolean;
  pulledLate: boolean;
}

interface NodeGroup {
  projectId: string;
  nodeId: string;
  tasks: Map<string, TaskFact>;
}

const REASON_ORDER: readonly PromotionReason[] = [
  "repeated_pull_tag",
  "wave_pull_ratio",
  "late_verification_failure",
];

/** Integer comparison for `pullers / members >= 40%`. */
export function meetsWavePullRatio(pullers: number, members: number): boolean {
  if (members <= 0 || pullers <= 0) return false;
  return pullers * PULL_WAVE_RATIO_DENOMINATOR >= members * PULL_WAVE_RATIO_NUMERATOR;
}

export function observationsFromRecords(records: readonly PullReadRecord[]): PullObservation[] {
  const observations: PullObservation[] = [];
  for (const record of records) {
    if (record.budgetExceeded || record.securityAnomaly) continue;
    for (const node of record.pulledNodes) {
      observations.push({
        projectId: record.projectId,
        waveId: record.waveId,
        waveIndex: record.waveIndex,
        taskId: record.taskId,
        tags: record.taskTags,
        nodeId: node.nodeId,
        workerLevel: record.workerLevel,
        currentMustTokens: record.currentMustTokens,
        nodeTokenCost: node.tokenCost,
        currentBand: node.band,
      });
    }
  }
  return observations;
}

/**
 * Promotes a pulled COULD fact when sibling tasks keep fetching it, or when a worker
 * fails a rule it only pulled after verification. MUST is used only when every receiving
 * task stays inside the Junior 3,000 / Senior 6,000 ceiling; otherwise the band is SHOULD.
 */
export class PullToPushFeedbackAnalyzer {
  analyze(input: FeedbackInput): readonly PromotionRecommendation[] {
    const groups = new Map<string, NodeGroup>();
    for (const pull of input.pulls) {
      const fact = ensureTask(groups, pull.projectId, pull.nodeId, pull.taskId);
      mergePull(fact, pull);
    }
    for (const failure of input.lateFailures) {
      if (!failure.pulledLate) continue;
      const fact = ensureTask(groups, failure.projectId, failure.nodeId, failure.taskId);
      mergeFailure(fact, failure);
    }
    const recommendations: PromotionRecommendation[] = [];
    for (const group of groups.values()) {
      recommendations.push(...recommendGroup(group, input.waves));
    }
    recommendations.sort((left, right) => {
      const project = left.projectId.localeCompare(right.projectId);
      if (project !== 0) return project;
      const node = left.nodeId.localeCompare(right.nodeId);
      if (node !== 0) return node;
      return left.tag.localeCompare(right.tag);
    });
    return recommendations;
  }

  apply(recommendations: readonly PromotionRecommendation[], hook: SlicerPromotionHook): void {
    for (const recommendation of recommendations) {
      const override: BandOverride = {
        projectId: recommendation.projectId,
        tag: recommendation.tag,
        nodeId: recommendation.nodeId,
        band: recommendation.toBand,
        effectiveWave: recommendation.effectiveWave,
        tokenCost: recommendation.tokenCost,
        capped: recommendation.capped,
      };
      hook.upsertBand(override);
    }
  }

  /** Analyze completed pulls and write the project's local slicer overrides. */
  run(input: FeedbackInput, hook: SlicerPromotionHook): readonly PromotionRecommendation[] {
    const recommendations = this.analyze(input);
    this.apply(recommendations, hook);
    return recommendations;
  }
}

function ensureTask(
  groups: Map<string, NodeGroup>,
  projectId: string,
  nodeId: string,
  taskId: string,
): TaskFact {
  const key = `${projectId}\u0000${nodeId}`;
  let group = groups.get(key);
  if (!group) {
    group = { projectId, nodeId, tasks: new Map() };
    groups.set(key, group);
  }
  let fact = group.tasks.get(taskId);
  if (!fact) {
    fact = {
      taskId,
      projectId,
      waveId: "",
      waveIndex: Number.POSITIVE_INFINITY,
      tags: new Set(),
      workerLevel: "junior",
      currentMustTokens: 0,
      nodeTokenCost: 0,
      currentBand: "COULD",
      pulled: false,
      pulledLate: false,
    };
    group.tasks.set(taskId, fact);
  }
  return fact;
}

function mergePull(fact: TaskFact, pull: PullObservation): void {
  fact.pulled = true;
  absorb(fact, pull);
}

function mergeFailure(fact: TaskFact, failure: LateVerificationFailure): void {
  fact.pulledLate = true;
  absorb(fact, failure);
}

function absorb(
  fact: TaskFact,
  source: {
    readonly waveId: string;
    readonly waveIndex: number;
    readonly tags: readonly string[];
    readonly workerLevel: WorkerLevel;
    readonly currentMustTokens: number;
    readonly nodeTokenCost: number;
    readonly currentBand: KnowledgeBand;
  },
): void {
  const first = fact.waveId === "";
  if (first || source.waveIndex < fact.waveIndex) {
    fact.waveId = source.waveId;
    fact.waveIndex = source.waveIndex;
  }
  for (const tag of source.tags) {
    const trimmed = tag.trim();
    if (trimmed) fact.tags.add(trimmed);
  }
  if (first || source.workerLevel === "junior") fact.workerLevel = source.workerLevel;
  fact.currentMustTokens = Math.max(fact.currentMustTokens, source.currentMustTokens);
  fact.nodeTokenCost = Math.max(fact.nodeTokenCost, source.nodeTokenCost);
  fact.currentBand = first ? source.currentBand : weakerBand(fact.currentBand, source.currentBand);
}

function recommendGroup(group: NodeGroup, waves: readonly WaveMembership[]): PromotionRecommendation[] {
  const facts = [...group.tasks.values()];
  const pullers = facts.filter((fact) => fact.pulled);
  const tagCounts = new Map<string, number>();
  for (const fact of pullers) {
    for (const tag of fact.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const thresholdTags = new Set<string>();
  for (const [tag, count] of tagCounts) {
    if (count >= PULL_TAG_TASK_THRESHOLD) thresholdTags.add(tag);
  }
  const waveHit = triggeringWave(group.projectId, pullers, waves);
  const waveTags = waveHit ? tagsForWave(waveHit.pullers) : new Set<string>();
  const lateTags = new Set<string>();
  for (const fact of facts) {
    if (!fact.pulledLate) continue;
    for (const tag of fact.tags) lateTags.add(tag);
  }
  const tags = uniqueSorted([...thresholdTags, ...waveTags, ...lateTags]);
  const recommendations: PromotionRecommendation[] = [];
  for (const tag of tags) {
    const reasons: PromotionReason[] = [];
    if (thresholdTags.has(tag)) reasons.push("repeated_pull_tag");
    if (waveTags.has(tag)) reasons.push("wave_pull_ratio");
    if (lateTags.has(tag)) reasons.push("late_verification_failure");
    if (reasons.length === 0) continue;
    const tagged = facts.filter((fact) => fact.tags.has(tag) && (fact.pulled || fact.pulledLate));
    if (tagged.length === 0) continue;
    const wantsMust = reasons.includes("late_verification_failure");
    let toBand: "SHOULD" | "MUST" = wantsMust ? "MUST" : "SHOULD";
    let capped = false;
    if (toBand === "MUST" && !tagged.every((fact) => mustFits(fact.workerLevel, fact.currentMustTokens, fact.nodeTokenCost))) {
      toBand = "SHOULD";
      capped = true;
    }
    if (tagged.every((fact) => bandRank(fact.currentBand) >= bandRank(toBand))) continue;
    const fromBand: "COULD" | "SHOULD" = tagged.some((fact) => fact.currentBand === "COULD")
      ? "COULD"
      : "SHOULD";
    const taskIds = tagged.map((fact) => fact.taskId).sort((left, right) => left.localeCompare(right));
    const waveIndex = Math.min(...tagged.map((fact) => fact.waveIndex));
    const tokenCost = Math.max(...tagged.map((fact) => fact.nodeTokenCost));
    recommendations.push({
      projectId: group.projectId,
      nodeId: group.nodeId,
      tag,
      fromBand,
      toBand,
      reasons: REASON_ORDER.filter((reason) => reasons.includes(reason)),
      effectiveWave: waveIndex + 1,
      distinctTasks: taskIds.length,
      taskIds,
      wavePullers: waveHit && waveTags.has(tag) ? waveHit.pullers.length : null,
      waveMembers: waveHit && waveTags.has(tag) ? waveHit.members : null,
      tokenCost,
      capped,
    });
  }
  return recommendations;
}

interface WaveHit {
  readonly pullers: readonly TaskFact[];
  readonly members: number;
  readonly waveIndex: number;
}

function triggeringWave(
  projectId: string,
  pullers: readonly TaskFact[],
  waves: readonly WaveMembership[],
): WaveHit | null {
  const hits: WaveHit[] = [];
  for (const wave of waves) {
    if (wave.projectId !== projectId) continue;
    const members = new Set(wave.taskIds);
    const inWave = pullers.filter((fact) => fact.waveId === wave.waveId && members.has(fact.taskId));
    if (!meetsWavePullRatio(inWave.length, members.size)) continue;
    hits.push({ pullers: inWave, members: members.size, waveIndex: wave.waveIndex });
  }
  hits.sort((left, right) => left.waveIndex - right.waveIndex);
  return hits[0] ?? null;
}

function tagsForWave(pullers: readonly TaskFact[]): Set<string> {
  const first = pullers[0];
  if (!first) return new Set();
  let shared = new Set(first.tags);
  for (const fact of pullers.slice(1)) {
    shared = new Set([...shared].filter((tag) => fact.tags.has(tag)));
  }
  if (shared.size > 0) return shared;
  const counts = new Map<string, number>();
  for (const fact of pullers) {
    for (const tag of fact.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  let bestTag = "";
  let bestCount = -1;
  for (const [tag, count] of counts) {
    if (count > bestCount || (count === bestCount && tag.localeCompare(bestTag) < 0)) {
      bestTag = tag;
      bestCount = count;
    }
  }
  return bestTag ? new Set([bestTag]) : new Set();
}

function weakerBand(left: KnowledgeBand, right: KnowledgeBand): KnowledgeBand {
  return bandRank(left) <= bandRank(right) ? left : right;
}

function bandRank(band: KnowledgeBand): number {
  if (band === "MUST") return 2;
  if (band === "SHOULD") return 1;
  return 0;
}
