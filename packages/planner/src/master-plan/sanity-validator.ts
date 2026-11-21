import { MasterPlanError } from "./errors.js";
import { computeAllocation } from "./integer-budget.js";
import { currencyCode } from "./ports.js";
import { assertDisjointWriteScopes, expectedPhase0Ids } from "./phase0-shared.js";
import { projectedCost, projectedTaskCount, allocationWeights } from "./wave-dag-builder.js";
import { ENVELOPE_IDS, type MasterPlan, type PlannedWave } from "./types.js";

const SCAFFOLD_PATHS = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "eslint.config.mjs",
  "prettier.config.mjs",
]);

function sameUnits(left: bigint, right: bigint, label: string): void {
  if (left !== right) {
    throw new MasterPlanError("budget_drift", `${label} drifted: ${left.toString()} !== ${right.toString()}`);
  }
}

function assertWaveProjection(plan: MasterPlan, wave: PlannedWave): void {
  const features = wave.featureIds.map((id) => {
    const feature = plan.features.find((item) => item.id === id);
    if (!feature) {
      throw new MasterPlanError("unscheduled_feature", `Wave ${wave.index} names unknown feature ${id}`);
    }
    return feature;
  });
  let weight = 0;
  let minTasks = 0;
  let maxTasks = 0;
  let minCost = 0n;
  let maxCost = 0n;
  for (const feature of features) {
    const tasks = projectedTaskCount(feature);
    const cost = projectedCost(feature, plan.costPerLeafUnits);
    minTasks += tasks.min;
    maxTasks += tasks.max;
    minCost += cost.min;
    maxCost += cost.max;
    weight += tasks.max;
  }
  const expectedWeight = Math.max(1, weight);
  if (wave.weightTasks !== expectedWeight) {
    throw new MasterPlanError("budget_drift", `Wave ${wave.index} weight does not match its features`);
  }
  if (wave.leafTasks.length > 0) {
    throw new MasterPlanError(
      "premature_wave_leaf_tasks",
      `Wave ${wave.index} cannot store ${wave.leafTasks.length} leaf tasks`,
    );
  }
  if (wave.index === 1) {
    if (wave.status !== "planned" || wave.projected !== null) {
      throw new MasterPlanError("wave_order_violation", "Wave 1 stores feature assignments only, with no projected leaf range");
    }
    if (wave.dependsOn.length !== 1 || wave.dependsOn[0] !== "phase0") {
      throw new MasterPlanError("wave_order_violation", "Wave 1 depends on Phase 0");
    }
    return;
  }
  if (wave.status !== "projected" || !wave.projected) {
    throw new MasterPlanError("wave_order_violation", `Wave ${wave.index} must store a projected range and no leaf tasks`);
  }
  if (
    wave.projected.taskCount.min !== minTasks ||
    wave.projected.taskCount.max !== maxTasks ||
    wave.projected.costUnits.min !== minCost ||
    wave.projected.costUnits.max !== maxCost
  ) {
    throw new MasterPlanError("budget_drift", `Wave ${wave.index} projection does not match its features`);
  }
  const previous = `wave:${wave.index - 1}`;
  if (wave.dependsOn.length !== 1 || wave.dependsOn[0] !== previous) {
    throw new MasterPlanError("wave_order_violation", `Wave ${wave.index} must depend on ${previous}`);
  }
}

function assertPhase0(plan: MasterPlan): void {
  const expected = expectedPhase0Ids(plan.projectKind, plan.capabilities);
  const actual = plan.phase0.map((recipe) => recipe.id);
  if (actual.join(",") !== expected.join(",")) {
    throw new MasterPlanError("phase0_order", `Phase 0 recipes ${actual.join(",")} !== ${expected.join(",")}`);
  }
  if (plan.projectKind === "brownfield") {
    for (const recipe of plan.phase0) {
      if (recipe.stage !== "parallel" || recipe.dependsOn.length !== 0) {
        throw new MasterPlanError("phase0_order", `${recipe.id} must stay parallel in brownfield mode`);
      }
      for (const scope of recipe.writeScope) {
        const normalized = scope.replaceAll("\\", "/");
        if (SCAFFOLD_PATHS.has(normalized) || normalized.includes("package.json")) {
          throw new MasterPlanError("brownfield_touches_scaffold", `${recipe.id} touches ${scope}`);
        }
      }
    }
    assertDisjointWriteScopes(plan.phase0);
    return;
  }
  const first = plan.phase0[0];
  if (!first || first.id !== "P0.1" || first.stage !== "serial" || first.dependsOn.length !== 0) {
    throw new MasterPlanError("phase0_order", "P0.1 must run strictly before P0.2-P0.8");
  }
  for (const recipe of plan.phase0.slice(1)) {
    if (recipe.stage !== "parallel" || recipe.dependsOn.length !== 1 || recipe.dependsOn[0] !== "P0.1") {
      throw new MasterPlanError("phase0_order", `${recipe.id} must run in parallel after P0.1`);
    }
  }
  assertDisjointWriteScopes(plan.phase0);
}

function assertBudget(plan: MasterPlan): void {
  const weights = allocationWeights(plan.phase0.length, plan.waves);
  const expected = computeAllocation({
    currency: plan.currency,
    totalUnits: plan.totalUnits,
    weights,
  });
  sameUnits(plan.allocation.totalUnits, plan.totalUnits, "allocation total");
  sameUnits(plan.allocation.paperworkUnits, expected.paperworkUnits, "paperwork");
  sameUnits(plan.allocation.buildUnits, expected.buildUnits, "build");
  for (const id of ENVELOPE_IDS) {
    sameUnits(plan.allocation.envelopes[id], expected.envelopes[id], id);
  }
  if (plan.allocation.buckets.length !== expected.buckets.length) {
    throw new MasterPlanError("budget_drift", "Per-wave envelope buckets do not match the weight split");
  }
  for (let index = 0; index < expected.buckets.length; index += 1) {
    const actual = plan.allocation.buckets[index];
    const wanted = expected.buckets[index];
    if (!actual || !wanted || actual.key !== wanted.key || actual.weight !== wanted.weight) {
      throw new MasterPlanError("budget_drift", "Per-wave envelope bucket keys drifted");
    }
    for (const id of ENVELOPE_IDS) {
      sameUnits(actual.envelopes[id], wanted.envelopes[id], `${actual.key}:${id}`);
    }
  }
  const envelopeSum = ENVELOPE_IDS.reduce((sum, id) => sum + plan.allocation.envelopes[id], 0n);
  sameUnits(envelopeSum, plan.totalUnits, "envelope sum");
}

/** Reject a master plan that breaks Phase 0 order, wave topology, coverage, or integer budgets. */
export function validateMasterPlan(plan: MasterPlan): void {
  if (plan.schema !== "master-planner@1" || plan.payloadVersion !== 1) {
    throw new MasterPlanError("corrupt_plan", "Master plan schema is not master-planner@1");
  }
  if (!Number.isSafeInteger(plan.createdAt) || plan.createdAt < 0) {
    throw new MasterPlanError("corrupt_plan", "createdAt must be a non-negative safe integer");
  }
  if (plan.currencyCode !== currencyCode(plan.currency, plan.connectionId)) {
    throw new MasterPlanError("invalid_budget", "Currency code does not match the budget currency");
  }
  if (plan.features.length === 0) {
    throw new MasterPlanError("no_active_features", "Master plan has no active features");
  }
  assertPhase0(plan);
  if (plan.waves.length === 0) {
    throw new MasterPlanError("no_active_features", "Master plan has no feature waves");
  }
  const seenFeatures = new Set<string>();
  for (let index = 0; index < plan.waves.length; index += 1) {
    const wave = plan.waves[index];
    if (!wave || wave.index !== index + 1) {
      throw new MasterPlanError("wave_order_violation", "Feature wave indexes must be contiguous from 1");
    }
    if (wave.featureIds.length === 0 || wave.featureIds.length > plan.breadthCap) {
      throw new MasterPlanError("invalid_breadth", `Wave ${wave.index} breaks the breadth cap`);
    }
    assertWaveProjection(plan, wave);
    for (const id of wave.featureIds) {
      if (seenFeatures.has(id)) {
        throw new MasterPlanError("duplicate_feature", `Feature ${id} is assigned twice`);
      }
      seenFeatures.add(id);
    }
  }
  for (const feature of plan.features) {
    if (!seenFeatures.has(feature.id)) {
      throw new MasterPlanError("unscheduled_feature", `Feature ${feature.id} is unscheduled`);
    }
  }
  if (seenFeatures.size !== plan.features.length) {
    throw new MasterPlanError("unscheduled_feature", "Wave assignments do not match the active feature set");
  }
  const waveOf = new Map<string, number>();
  for (const wave of plan.waves) {
    for (const id of wave.featureIds) waveOf.set(id, wave.index);
  }
  for (const feature of plan.features) {
    const wave = waveOf.get(feature.id);
    for (const dep of feature.dependsOn) {
      const depWave = waveOf.get(dep);
      if (wave === undefined || depWave === undefined || depWave >= wave) {
        throw new MasterPlanError(
          "wave_order_violation",
          `Feature ${feature.id} depends on ${dep}, which is not in an earlier wave`,
        );
      }
    }
  }
  const wave1 = plan.waves[0];
  if (!wave1?.featureIds.includes(plan.walkingSkeletonFeatureId)) {
    throw new MasterPlanError("wave1_missing_vertical_slice", "Walking skeleton is not in Wave 1");
  }
  const skeleton = plan.features.find((feature) => feature.id === plan.walkingSkeletonFeatureId);
  if (!skeleton || skeleton.verticalSlice !== true || skeleton.dependsOn.length !== 0) {
    throw new MasterPlanError(
      "wave1_missing_vertical_slice",
      "Wave 1 must contain an immediately buildable vertical-slice feature",
    );
  }
  const last = plan.waves[plan.waves.length - 1];
  if (!last) {
    throw new MasterPlanError("corrupt_plan", "Missing last feature wave");
  }
  if (
    plan.completionWave.id !== "completion" ||
    plan.completionWave.ownerTask !== "101" ||
    plan.completionWave.index !== last.index + 1 ||
    plan.completionWave.status !== "projected" ||
    plan.completionWave.leafTasks.length !== 0 ||
    plan.completionWave.dependsOn.length !== 1 ||
    plan.completionWave.dependsOn[0] !== `wave:${last.index}` ||
    plan.completionWave.projected.taskCount.min !== 1 ||
    plan.completionWave.projected.taskCount.max !== 1 ||
    plan.completionWave.projected.costUnits.min !== plan.costPerLeafUnits ||
    plan.completionWave.projected.costUnits.max !== plan.costPerLeafUnits
  ) {
    throw new MasterPlanError("premature_wave_leaf_tasks", "Completion wave must stay a projected Task 101 slot");
  }
  assertBudget(plan);
}
