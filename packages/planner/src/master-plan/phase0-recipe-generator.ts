import { MasterPlanError } from "./errors.js";
import { phase0Catalog } from "./phase0-catalog.js";
import {
  assertDisjointWriteScopes,
  expectedPhase0Ids,
  greenfieldIds,
  omissionReason,
  resolvePhase0Capabilities,
  type Phase0SelectionInput,
} from "./phase0-shared.js";
import type { Phase0Plan, Phase0Recipe } from "./types.js";

export type Phase0Input = Phase0SelectionInput;

/**
 * Deterministic Phase 0 recipes.
 * Greenfield: P0.1 is strictly serial and P0.2–P0.8 run in parallel after it.
 * Headless CLI omits P0.3, P0.4, and P0.8.
 * API projects omit the UI recipes P0.4 and P0.8.
 * Brownfield emits only P0.B1 and P0.B2 and never rewrites the scaffold.
 */
export class Phase0RecipeGenerator {
  generate(input: Phase0Input): Phase0Plan {
    const capabilities = resolvePhase0Capabilities(input);
    const ids = expectedPhase0Ids(input.projectKind, capabilities);
    const catalog = phase0Catalog(input.projectKind);
    const recipes: Phase0Recipe[] = [];
    for (const id of ids) {
      const found = catalog.get(id);
      if (!found) {
        throw new MasterPlanError("phase0_order", `Missing Phase 0 catalog entry ${id}`);
      }
      recipes.push(found);
    }
    if (input.projectKind === "brownfield") {
      for (const recipe of recipes) {
        if (recipe.stage !== "parallel" || recipe.dependsOn.length !== 0) {
          throw new MasterPlanError("phase0_order", `${recipe.id} must be parallel and independent`);
        }
      }
      assertDisjointWriteScopes(recipes);
    } else {
      const first = recipes[0];
      if (!first || first.id !== "P0.1" || first.stage !== "serial" || first.dependsOn.length !== 0) {
        throw new MasterPlanError("phase0_order", "P0.1 must be the serial first Phase 0 recipe");
      }
      for (const recipe of recipes.slice(1)) {
        if (recipe.stage !== "parallel" || recipe.dependsOn.length !== 1 || recipe.dependsOn[0] !== "P0.1") {
          throw new MasterPlanError("phase0_order", `${recipe.id} must run in parallel after P0.1`);
        }
      }
      assertDisjointWriteScopes(recipes);
    }
    const selected = new Set(ids);
    const omitted = (input.projectKind === "brownfield" ? [...greenfieldIds()] : [...greenfieldIds()].filter((id) => !selected.has(id))).map(
      (id) => ({ id, reason: omissionReason(id, input.projectKind, capabilities) }),
    );
    return {
      projectKind: input.projectKind,
      capabilities,
      recipes,
      omitted,
    };
  }
}
