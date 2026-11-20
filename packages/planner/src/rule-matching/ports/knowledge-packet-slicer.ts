import { mustFits } from "./token-budget.js";
import type { KnowledgeBand, WorkerLevel } from "../types.js";

export interface BandOverride {
  readonly projectId: string;
  readonly tag: string;
  readonly nodeId: string;
  readonly band: "SHOULD" | "MUST";
  readonly effectiveWave: number;
  readonly tokenCost: number;
  readonly capped: boolean;
}

/** Hook Task 088's slicer implements when that branch is integrated. */
export interface SlicerPromotionHook {
  upsertBand(override: BandOverride): void;
}

export class LocalSlicerPromotionStore implements SlicerPromotionHook {
  private readonly rows: BandOverride[] = [];

  upsertBand(override: BandOverride): void {
    const index = this.rows.findIndex(
      (row) =>
        row.projectId === override.projectId &&
        row.tag === override.tag &&
        row.nodeId === override.nodeId,
    );
    if (index < 0) {
      this.rows.push(override);
      return;
    }
    const current = this.rows[index];
    if (!current) return;
    const band = bandRank(override.band) >= bandRank(current.band) ? override.band : current.band;
    this.rows[index] = {
      ...current,
      band,
      effectiveWave: Math.min(current.effectiveWave, override.effectiveWave),
      tokenCost: override.tokenCost,
      capped: override.capped || current.capped,
    };
  }

  list(): readonly BandOverride[] {
    return [...this.rows].sort((left, right) => {
      const project = left.projectId.localeCompare(right.projectId);
      if (project !== 0) return project;
      const node = left.nodeId.localeCompare(right.nodeId);
      if (node !== 0) return node;
      return left.tag.localeCompare(right.tag);
    });
  }

  overrideFor(projectId: string, nodeId: string, tags: readonly string[], waveIndex: number): BandOverride | null {
    const tagSet = new Set(tags);
    const applicable = this.rows.filter(
      (row) =>
        row.projectId === projectId &&
        row.nodeId === nodeId &&
        tagSet.has(row.tag) &&
        waveIndex >= row.effectiveWave,
    );
    if (applicable.length === 0) return null;
    applicable.sort((left, right) => {
      const byBand = bandRank(right.band) - bandRank(left.band);
      if (byBand !== 0) return byBand;
      return left.tag.localeCompare(right.tag);
    });
    return applicable[0] ?? null;
  }
}

function bandRank(band: "SHOULD" | "MUST"): number {
  return band === "MUST" ? 2 : 1;
}

export interface SlicerNode {
  readonly id: string;
  readonly title: string;
  readonly band: KnowledgeBand;
  readonly tokens: number;
  readonly tags: readonly string[];
}

export interface SliceTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly waveIndex: number;
  readonly tags: readonly string[];
  readonly level: WorkerLevel;
}

export interface BriefItem {
  readonly nodeId: string;
  readonly title: string;
  readonly band: "MUST" | "SHOULD";
  readonly tokens: number;
  readonly tags: readonly string[];
}

export interface CompiledBrief {
  readonly taskId: string;
  readonly projectId: string;
  readonly waveIndex: number;
  readonly level: WorkerLevel;
  readonly must: readonly BriefItem[];
  readonly should: readonly BriefItem[];
  readonly couldIndex: readonly string[];
  readonly mustTokens: number;
  readonly shouldTokens: number;
  readonly mustOverflowAvoided: readonly string[];
}

/**
 * Local port of Task 088 `KnowledgePacketSlicer`.
 * Promoted facts enter the brief at `effectiveWave` and never push MUST over the level ceiling.
 */
export class LocalKnowledgePacketSlicer {
  constructor(
    private readonly nodes: readonly SlicerNode[],
    private readonly store: LocalSlicerPromotionStore,
  ) {}

  compile(task: SliceTask): CompiledBrief {
    const taskTags = new Set(task.tags);
    const relevant = this.nodes
      .filter((node) => node.tags.length === 0 || node.tags.some((tag) => taskTags.has(tag)))
      .sort((left, right) => left.id.localeCompare(right.id));
    const decided = relevant.map((node) => {
      const override = this.store.overrideFor(task.projectId, node.id, task.tags, task.waveIndex);
      const band: KnowledgeBand = override?.band ?? node.band;
      const promoted = override !== null && override.band !== node.band;
      return { node, band, promoted };
    });
    const placedMust: BriefItem[] = [];
    const placedShould: BriefItem[] = [];
    const couldIndex: string[] = [];
    const mustOverflowAvoided: string[] = [];
    let mustTokens = 0;
    const place = (node: SlicerNode, band: "MUST" | "SHOULD"): void => {
      const item: BriefItem = {
        nodeId: node.id,
        title: node.title,
        band,
        tokens: node.tokens,
        tags: [...node.tags],
      };
      if (band === "MUST") {
        placedMust.push(item);
        mustTokens += node.tokens;
      } else {
        placedShould.push(item);
      }
    };
    for (const row of decided) {
      if (row.promoted || row.node.band !== "MUST") continue;
      place(row.node, "MUST");
    }
    for (const row of decided) {
      if (!row.promoted && row.node.band === "MUST") continue;
      let band = row.band;
      if (band === "MUST" && !mustFits(task.level, mustTokens, row.node.tokens)) {
        band = "SHOULD";
        mustOverflowAvoided.push(row.node.id);
      }
      if (band === "COULD") {
        couldIndex.push(row.node.id);
        continue;
      }
      place(row.node, band);
    }
    const shouldTokens = placedShould.reduce((sum, item) => sum + item.tokens, 0);
    return {
      taskId: task.taskId,
      projectId: task.projectId,
      waveIndex: task.waveIndex,
      level: task.level,
      must: placedMust,
      should: placedShould,
      couldIndex,
      mustTokens,
      shouldTokens,
      mustOverflowAvoided,
    };
  }
}

export function pushedNodeIds(brief: CompiledBrief): Set<string> {
  return new Set([...brief.must, ...brief.should].map((item) => item.nodeId));
}

/**
 * A pushed MUST/SHOULD fact is not pulled again.
 * `redundantPulls` counts issued pulls that duplicate the brief (the planner keeps this at 0).
 * `avoidedBecausePushed` is the set Wave 2 no longer has to fetch.
 */
export function planPulls(
  brief: CompiledBrief,
  desiredNodeIds: readonly string[],
): {
  issued: readonly string[];
  avoidedBecausePushed: readonly string[];
  redundantPulls: number;
} {
  const pushed = pushedNodeIds(brief);
  const issued: string[] = [];
  const avoidedBecausePushed: string[] = [];
  for (const nodeId of desiredNodeIds) {
    if (pushed.has(nodeId)) avoidedBecausePushed.push(nodeId);
    else issued.push(nodeId);
  }
  const redundantPulls = issued.filter((nodeId) => pushed.has(nodeId)).length;
  return { issued, avoidedBecausePushed, redundantPulls };
}
