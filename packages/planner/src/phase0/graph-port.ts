import { scopesOverlap } from "./scope.js";
import type { Phase0CompileResult, DeterministicGraphCompilerPort } from "./ports.js";
import type { DependencyIntent, Phase0Plan, Phase0Recipe } from "./types.js";

const PACKAGE_FILES = new Set(["package.json", "pnpm-lock.yaml"]);

/**
 * Local port of `Task 092` `DeterministicGraphCompiler` for Phase 0 only.
 * Parallel tasks are not allowed to own `package.json` or the lockfile.
 * Those dependency intents are hoisted onto the serial `P0.1` install.
 */
export class LocalDeterministicGraphCompiler implements DeterministicGraphCompilerPort {
  compile(plan: Phase0Plan): Phase0CompileResult {
    const errors: string[] = [];
    const hoisted: DependencyIntent[] = [];
    const recipes = plan.recipes.map((recipe) => hoistPackageWrites(recipe, plan.projectKind, hoisted, errors));
    if (plan.projectKind === "brownfield") {
      for (const recipe of recipes) {
        if (recipe.id === "P0.1" || recipe.stage !== "parallel" || recipe.dependsOn.length !== 0) {
          errors.push(`${recipe.id} cannot run as greenfield scaffold in a brownfield repo`);
        }
        for (const scope of recipe.writeScope) {
          if (isPackageFile(scope)) errors.push(`${recipe.id} still writes ${scope}`);
        }
      }
    } else {
      const first = recipes[0];
      if (!first || first.id !== "P0.1" || first.stage !== "serial") {
        errors.push("P0.1 must be committed before Stage 0B");
      }
      for (const recipe of recipes.slice(1)) {
        if (recipe.stage !== "parallel" || recipe.dependsOn[0] !== "P0.1") {
          errors.push(`${recipe.id} must depend on P0.1 and run in Stage 0B`);
        }
      }
    }
    collectOverlaps(recipes, errors);
    return { ok: errors.length === 0, errors, recipes, hoistedIntents: hoisted };
  }
}

function isPackageFile(scope: string): boolean {
  const normalized = scope.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
  return PACKAGE_FILES.has(normalized) || normalized.endsWith("/package.json") || normalized.endsWith("/pnpm-lock.yaml");
}

function hoistPackageWrites(
  recipe: Phase0Recipe,
  projectKind: Phase0Plan["projectKind"],
  hoisted: DependencyIntent[],
  errors: string[],
): Phase0Recipe {
  const packageScopes = recipe.writeScope.filter((scope) => isPackageFile(scope));
  const intents = recipe.dependencyIntents ?? [];
  if (recipe.id === "P0.1" || (recipe.stage === "serial" && projectKind !== "brownfield")) {
    return recipe;
  }
  if (intents.length > 0 || packageScopes.length > 0) {
    hoisted.push(...intents);
    if (packageScopes.length > 0 && intents.length === 0) {
      errors.push(`${recipe.id} edits ${packageScopes.join(", ")} without a dependency intent to hoist`);
    }
  }
  if (packageScopes.length === 0 && intents.length === 0) return recipe;
  const banned = new Set(packageScopes);
  const writeScope = recipe.writeScope.filter((scope) => !banned.has(scope));
  const expectedOutputs = recipe.expectedOutputs.filter((scope) => !banned.has(scope));
  return {
    id: recipe.id,
    title: recipe.title,
    stage: recipe.stage,
    dependsOn: recipe.dependsOn,
    level: recipe.level,
    writeScope,
    steps: recipe.steps,
    expectedOutputs,
    refs: recipe.refs,
  };
}

function collectOverlaps(recipes: readonly Phase0Recipe[], errors: string[]): void {
  const parallel = recipes.filter((recipe) => recipe.stage === "parallel");
  for (let i = 0; i < parallel.length; i += 1) {
    const left = parallel[i];
    if (!left) continue;
    for (let j = i + 1; j < parallel.length; j += 1) {
      const right = parallel[j];
      if (!right) continue;
      for (const a of left.writeScope) {
        for (const b of right.writeScope) {
          if (scopesOverlap(a, b)) errors.push(`${left.id} write scope ${a} overlaps ${right.id} write scope ${b}`);
        }
      }
    }
  }
}
