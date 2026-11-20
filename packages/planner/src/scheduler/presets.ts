import {
  AGE_MS_PER_SKIP,
  BALANCED_PRESET_CAP,
  CACHE_BONUS_MS,
  CHEAPEST_PRESET_CAP,
  CREW_LEVELS,
  EXPLICIT_BOOST_MS,
  levelIndex,
  type CrewLevel,
  type CrewPreset,
  type CrewPresetProfile,
  type DifficultyTier,
  type LevelSelection,
  type LevelSelectionRequest,
  type ScheduleGraph,
  type ScheduleTask,
  type TaskLevelAssignment,
} from "./types.js";

/**
 * Local stand-in for Task 106 `ExpectedCostLevelSelector`.
 * E[cost] = unit_cost / P(pass). Safety floors and Hint 2+ escalation stay here
 * until the crew-levels barrel is wired.
 */
export const UNIT_COST_MICRO_USD: Readonly<Record<CrewLevel, number>> = {
  junior: 20_000,
  mid: 80_000,
  senior: 180_000,
  principal: 400_000,
};

export const PASS_PROBABILITY: Readonly<Record<DifficultyTier, Readonly<Record<CrewLevel, number>>>> = {
  trivial: { junior: 0.9, mid: 0.95, senior: 0.97, principal: 0.98 },
  standard: { junior: 0.55, mid: 0.88, senior: 0.93, principal: 0.96 },
  complex: { junior: 0.25, mid: 0.7, senior: 0.9, principal: 0.94 },
  critical: { junior: 0.15, mid: 0.55, senior: 0.85, principal: 0.92 },
};

const FLOOR_TAGS = new Set(["auth", "payments", "destructive_migration", "cross_feature_conflict"]);

export function expectedCostMicroUsd(level: CrewLevel, difficulty: DifficultyTier): number {
  return Math.round(UNIT_COST_MICRO_USD[level] / PASS_PROBABILITY[difficulty][level]);
}

export function safetyFloor(task: ScheduleTask): CrewLevel {
  if (task.role === "oracle-author@1") return "senior";
  if (task.riskTags.some((tag) => FLOOR_TAGS.has(tag))) return "senior";
  if (task.difficulty === "critical") return "mid";
  return "junior";
}

function atLeast(level: CrewLevel, floor: CrewLevel): CrewLevel {
  return levelIndex(level) >= levelIndex(floor) ? level : floor;
}

function escalate(level: CrewLevel, steps: number): CrewLevel {
  const next = Math.min(CREW_LEVELS.length - 1, levelIndex(level) + steps);
  return CREW_LEVELS[next] ?? "principal";
}

function cheapestLevel(task: ScheduleTask, floor: CrewLevel): CrewLevel {
  let best = floor;
  let bestCost = expectedCostMicroUsd(floor, task.difficulty);
  for (const level of CREW_LEVELS) {
    if (levelIndex(level) < levelIndex(floor)) continue;
    const cost = expectedCostMicroUsd(level, task.difficulty);
    if (cost < bestCost) {
      best = level;
      bestCost = cost;
    }
  }
  return best;
}

export interface ExpectedCostLevelSelectorPort {
  selectLevel(input: LevelSelectionRequest): LevelSelection;
}

export class LocalExpectedCostLevelSelector implements ExpectedCostLevelSelectorPort {
  selectLevel(input: LevelSelectionRequest): LevelSelection {
    const floor = safetyFloor(input.task);
    let level = cheapestLevel(input.task, floor);
    if (input.preset === "Fastest" && input.onCriticalPath) {
      level = atLeast("principal", floor);
    } else if (input.preset === "Fastest" && (input.task.difficulty === "complex" || input.task.difficulty === "critical")) {
      level = atLeast(atLeast(level, "senior"), floor);
    } else if (
      input.preset === "Balanced" &&
      (input.onCriticalPath || input.task.difficulty === "complex" || input.task.difficulty === "critical")
    ) {
      level = atLeast(atLeast(level, "senior"), floor);
    }
    const escalations = input.hintStep >= 2 ? input.hintStep - 1 : 0;
    if (escalations > 0) level = atLeast(escalate(level, escalations), floor);
    const pass = PASS_PROBABILITY[input.task.difficulty][level];
    const cost = expectedCostMicroUsd(level, input.task.difficulty);
    const dollars = (cost / 1_000_000).toFixed(2);
    const percent = Math.round(pass * 100);
    const why = input.onCriticalPath
      ? "critical path"
      : input.task.riskTags.length > 0
        ? `tags ${input.task.riskTags.join("+")}`
        : `${input.task.difficulty} leaf`;
    return {
      level,
      expectedCostMicroUsd: cost,
      passProbability: pass,
      safetyFloor: floor,
      rationale: `Assigned ${level} (est. $${dollars}, ${percent}% 1st-pass) — ${input.preset}; ${why}`,
    };
  }
}

export class CrewPresetProfileEngine {
  constructor(private readonly levels: ExpectedCostLevelSelectorPort = new LocalExpectedCostLevelSelector()) {}

  profile(preset: CrewPreset): CrewPresetProfile {
    if (preset === "Fastest") {
      return {
        preset,
        userPresetCap: Number.POSITIVE_INFINITY,
        prewarmNextWave: true,
        preferSubscription: false,
        batchSameFeature: false,
        summary: "Maximizes width and puts high first-pass models on the critical path",
      };
    }
    if (preset === "Cheapest") {
      return {
        preset,
        userPresetCap: CHEAPEST_PRESET_CAP,
        prewarmNextWave: false,
        preferSubscription: true,
        batchSameFeature: true,
        summary: "Minimizes expected cost, batches same-feature siblings, and prefers subscription windows",
      };
    }
    return {
      preset,
      userPresetCap: BALANCED_PRESET_CAP,
      prewarmNextWave: false,
      preferSubscription: false,
      batchSameFeature: false,
      summary: "Expected-cost levels, senior on the critical path, laptop-friendly width",
    };
  }

  assignLevel(task: ScheduleTask, onCriticalPath: boolean, preset: CrewPreset, hintStep = task.hintStep): LevelSelection {
    return this.levels.selectLevel({ task, preset, onCriticalPath, hintStep });
  }

  assignAll(
    graph: ScheduleGraph,
    onCriticalPath: ReadonlySet<string>,
    preset: CrewPreset,
    hintOverride: Readonly<Record<string, number>> = {},
  ): readonly TaskLevelAssignment[] {
    return graph.tasks.map((task) => {
      const critical = onCriticalPath.has(task.id);
      const hint = hintOverride[task.id] ?? task.hintStep;
      return { taskId: task.id, onCriticalPath: critical, ...this.assignLevel(task, critical, preset, hint) };
    });
  }
}

export function priorityScore(input: {
  readonly rankUMs: number;
  readonly onCriticalPath: boolean;
  readonly explicit: boolean;
  readonly optionalPolish: boolean;
  readonly skippedRounds: number;
  readonly sameFeatureBonus: boolean;
}): { readonly band: number; readonly score: number } {
  const band = input.onCriticalPath ? 2 : 1;
  const explicitBoost =
    !input.onCriticalPath && input.explicit && !input.optionalPolish ? EXPLICIT_BOOST_MS : 0;
  const cache = !input.onCriticalPath && input.sameFeatureBonus ? CACHE_BONUS_MS : 0;
  return {
    band,
    score: input.rankUMs + explicitBoost + input.skippedRounds * AGE_MS_PER_SKIP + cache,
  };
}

export interface ReadyCandidate {
  readonly index: number;
  readonly id: string;
  readonly featureId: string;
  readonly band: number;
  readonly score: number;
  readonly featureAffinity: number;
  readonly readySinceMs: number;
}

export function compareCandidates(left: ReadyCandidate, right: ReadyCandidate, policy: "heft" | "fifo"): number {
  if (policy === "fifo") return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  if (left.band !== right.band) return right.band - left.band;
  if (left.score !== right.score) return right.score - left.score;
  if (left.featureAffinity !== right.featureAffinity) return right.featureAffinity - left.featureAffinity;
  if (left.readySinceMs !== right.readySinceMs) return left.readySinceMs - right.readySinceMs;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
