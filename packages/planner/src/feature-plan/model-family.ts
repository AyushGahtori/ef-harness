import { FeaturePlanError } from "./errors.js";
import type { DiagnosticEntry, ModelAssignment, ModelRoster, OracleIndependence } from "./types.js";

export interface OracleSelection {
  readonly assignment: ModelAssignment;
  readonly independence: OracleIndependence;
  readonly warnings: readonly DiagnosticEntry[];
}

/**
 * Pick oracle-author@1 on a different model family from the build worker
 * whenever at least two families are configured. A single family stamps
 * `same_family_only` and logs `same_family_degraded` without throwing.
 */
export function selectOracleAuthor(roster: ModelRoster, buildWorker: ModelAssignment): OracleSelection {
  const families = roster.families.filter((family) => family.models.length > 0);
  if (families.length === 0) {
    throw new FeaturePlanError("no_model", "No model family is configured for oracle-author@1");
  }
  const workerFamily = families.find((family) => family.id === buildWorker.family);
  if (!workerFamily) {
    throw new FeaturePlanError("unknown_build_worker", "Build worker family is not in the roster", {
      family: buildWorker.family,
    });
  }
  const others = families.filter((family) => family.id !== buildWorker.family);
  if (others.length > 0) {
    const family = others[0];
    if (!family) {
      throw new FeaturePlanError("no_model", "Independent family selection failed");
    }
    const model = family.models.find((item) => item.tier === "senior") ?? family.models[0];
    if (!model) {
      throw new FeaturePlanError("no_model", "Independent family has no model");
    }
    return {
      assignment: { family: family.id, model: model.id },
      independence: "cross_family",
      warnings: [],
    };
  }
  const distinct =
    workerFamily.models.find((item) => item.id !== buildWorker.model) ?? workerFamily.models[0];
  if (!distinct) {
    throw new FeaturePlanError("no_model", "The only model family has no model tier");
  }
  return {
    assignment: { family: workerFamily.id, model: distinct.id },
    independence: "same_family_only",
    warnings: [
      {
        code: "same_family_degraded",
        message:
          "Only one model family is connected. oracle-author@1 selected a distinct tier when one was available and stamped oracle_independence same_family_only.",
      },
    ],
  };
}

export function selectPlannerModel(roster: ModelRoster): ModelAssignment {
  for (const family of roster.families) {
    const senior = family.models.find((model) => model.tier === "senior");
    if (senior) return { family: family.id, model: senior.id };
  }
  const family = roster.families[0];
  const model = family?.models[0];
  if (!family || !model) {
    throw new FeaturePlanError("no_model", "No model is configured for feature-planner@1");
  }
  return { family: family.id, model: model.id };
}
