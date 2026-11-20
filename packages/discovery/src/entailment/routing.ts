import type { ModelIdentity } from "./types.js";

export interface ModelRoster {
  readonly connected: readonly ModelIdentity[];
  readonly batchResolve: ModelIdentity;
}

export interface SelectedEntailmentModel extends ModelIdentity {
  readonly independentFamily: boolean;
}

/**
 * Prefer a family other than `batch-resolve@1` whenever at least two families
 * are connected. A single connected family still runs; the check stays fail-closed
 * if that call times out.
 */
export function selectEntailmentModel(roster: ModelRoster): SelectedEntailmentModel {
  const others = roster.connected
    .filter((model) => model.family !== roster.batchResolve.family)
    .slice()
    .sort((left, right) => left.family.localeCompare(right.family) || left.modelId.localeCompare(right.modelId));
  const chosen = others[0];
  if (chosen) {
    return { family: chosen.family, modelId: chosen.modelId, independentFamily: true };
  }
  return {
    family: roster.batchResolve.family,
    modelId: roster.batchResolve.modelId,
    independentFamily: false,
  };
}
