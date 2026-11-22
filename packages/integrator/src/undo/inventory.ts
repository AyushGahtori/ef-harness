import { IN_FLIGHT_STATES, INTEGRATION_BRANCH, LLM_TOKENS, MODE_FAST_PATH, MODE_SURGICAL } from "./constants.js";
import { UnknownFeatureError } from "./errors.js";
import { featureDiff, findFeatureMerge, revertConflicts, type GitRepo } from "./git.js";
import type { KnowledgeGraphPort } from "./state-db.js";
import type { UndoInventory } from "./types.js";
import { CrossFeatureUsageGraphChecker, exclusiveRatio, partition, ReverseImpactWalkerPort } from "./usage-graph.js";

/**
 * Strict 3-step undo starts here. This pass is read-only: it never checks out,
 * resets, or edits a worktree. Fast-path eligibility is `Exclusive === 100%`
 * and a clean `git merge-tree` preview of `git revert -m 1`.
 */
export class FeatureUndoInventoryAnalyzer {
  private readonly usage: CrossFeatureUsageGraphChecker;
  private readonly impact: ReverseImpactWalkerPort;

  constructor(
    private readonly git: GitRepo,
    private readonly graph: KnowledgeGraphPort,
    usage?: CrossFeatureUsageGraphChecker,
  ) {
    this.usage = usage ?? new CrossFeatureUsageGraphChecker(git, graph);
    this.impact = new ReverseImpactWalkerPort(graph);
  }

  analyze(featureId: string): UndoInventory {
    const feature = this.graph.getFeature(featureId);
    if (!feature) throw new UnknownFeatureError(featureId);
    const hardDependents = this.impact.hardDependents(featureId);
    const inFlight = isInFlight(feature.lifecycle, feature.landed);
    if (inFlight) {
      return {
        featureId,
        title: feature.title,
        landed: false,
        inFlight: true,
        mergeSha: "",
        nonFastForward: false,
        exclusive: [],
        shared: [],
        persistentData: [],
        exclusiveRatio: 1,
        fastPathCandidate: false,
        revertConflicts: [],
        laterOverlapPaths: [],
        hardDependents,
        externalEffects: [],
        llmTokens: LLM_TOKENS,
      };
    }
    const mergeSha = findFeatureMerge(this.git, featureId, feature.mergeSha);
    if (!mergeSha) throw new UnknownFeatureError(featureId);
    const parents = this.git.parents(mergeSha);
    const nonFastForward = parents.length >= 2;
    const changes = featureDiff(this.git, mergeSha);
    const classified = this.usage.check(featureId, changes, mergeSha);
    const buckets = partition(classified);
    const laterOverlapPaths = classified
      .filter((item) => item.reasons.includes("later_edit") && !item.path.startsWith("db:"))
      .map((item) => item.path);
    const externalEffects = classified.filter((item) => item.kind === "external_effect").map((item) => item.path);
    const conflicts = nonFastForward ? revertConflicts(this.git, mergeSha, INTEGRATION_BRANCH) : [];
    const ratio = exclusiveRatio(classified);
    const fastPathCandidate =
      nonFastForward &&
      ratio === 1 &&
      buckets.shared.length === 0 &&
      buckets.persistentData.length === 0 &&
      laterOverlapPaths.length === 0 &&
      conflicts.length === 0 &&
      externalEffects.length === 0;
    return {
      featureId,
      title: feature.title,
      landed: true,
      inFlight: false,
      mergeSha,
      nonFastForward,
      exclusive: buckets.exclusive,
      shared: buckets.shared,
      persistentData: buckets.persistentData,
      exclusiveRatio: ratio,
      fastPathCandidate,
      revertConflicts: conflicts,
      laterOverlapPaths,
      hardDependents,
      externalEffects,
      llmTokens: LLM_TOKENS,
    };
  }
}

function isInFlight(lifecycle: string, landed: boolean): boolean {
  if (landed) return false;
  return (IN_FLIGHT_STATES as readonly string[]).includes(lifecycle);
}

export function executionMode(inventory: UndoInventory): typeof MODE_FAST_PATH | typeof MODE_SURGICAL {
  if (inventory.fastPathCandidate) return MODE_FAST_PATH;
  return MODE_SURGICAL;
}
