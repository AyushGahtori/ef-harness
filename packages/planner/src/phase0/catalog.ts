import { isUiProjectKind, normalizeProjectKind } from "@ef-harness/shared-contracts";

import { filesForTask } from "./foundation-files.js";
import { Phase0Error } from "./errors.js";
import { scopesOverlap } from "./scope.js";
import type { Phase0Capabilities, Phase0Plan, Phase0Recipe, Phase0SelectionInput, ProjectKind } from "./types.js";

const GREENFIELD_IDS = ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"] as const;

/**
 * Local stand-in for `Task 090` `Phase0RecipeGenerator`.
 * Selection matches that generator: `P0.1` serial, then disjoint `P0.2`–`P0.8`.
 * Headless CLI omits `P0.3`, `P0.4`, and `P0.8`. API projects omit `P0.4` and `P0.8`.
 * Brownfield emits only `P0.B1` and `P0.B2`.
 */
export function coercePhase0Kind(value: string): ProjectKind {
  if (value === "brownfield") return "brownfield";
  const canonical = normalizeProjectKind(value);
  if (canonical === "cli_tool") return "headless_cli";
  if (canonical === "api_service") return "api";
  if (
    canonical === "web_saas" ||
    canonical === "web_static" ||
    canonical === "desktop_electron" ||
    canonical === "mobile_web"
  ) {
    return "web_saas";
  }
  if (canonical && isUiProjectKind(canonical)) return "web_saas";
  throw new Phase0Error("invalid_project_kind", `Unknown project kind ${value}`);
}

export class LocalPhase0RecipeGenerator {
  generate(input: Phase0SelectionInput): Phase0Plan {
    const projectKind = coercePhase0Kind(input.projectKind);
    const normalized: Phase0SelectionInput = {
      projectKind,
      ...(input.database !== undefined ? { database: input.database } : {}),
      ...(input.auth !== undefined ? { auth: input.auth } : {}),
    };
    const capabilities = resolveCapabilities(normalized);
    const ids = expectedIds(projectKind, capabilities);
    const recipes = ids.map((id) => recipeFor(id, projectKind));
    assertOrder(projectKind, recipes);
    assertDisjoint(recipes);
    const selected = new Set(ids);
    const omitted = (projectKind === "brownfield" ? [...GREENFIELD_IDS] : GREENFIELD_IDS.filter((id) => !selected.has(id))).map(
      (id) => ({ id, reason: omissionReason(id, projectKind, capabilities) }),
    );
    return { projectKind, capabilities, recipes, omitted };
  }
}

export function resolveCapabilities(input: Phase0SelectionInput): Phase0Capabilities {
  const projectKind = coercePhase0Kind(input.projectKind);
  if (projectKind === "brownfield") return { database: false, auth: false, ui: false };
  return {
    database: input.database !== false,
    auth: projectKind !== "headless_cli" && input.auth !== false,
    ui: projectKind === "web_saas",
  };
}

export function expectedIds(projectKind: ProjectKind, capabilities: Phase0Capabilities): string[] {
  if (projectKind === "brownfield") return ["P0.B1", "P0.B2"];
  const ids = ["P0.1"];
  if (capabilities.database) ids.push("P0.2");
  if (capabilities.auth) ids.push("P0.3");
  if (capabilities.ui) ids.push("P0.4");
  ids.push("P0.5", "P0.6", "P0.7");
  if (capabilities.ui) ids.push("P0.8");
  return ids;
}

function omissionReason(id: string, projectKind: ProjectKind, capabilities: Phase0Capabilities): string {
  if (projectKind === "brownfield") return "brownfield_skips_greenfield_scaffold";
  if (id === "P0.2" && !capabilities.database) return "no_primary_database";
  if (id === "P0.3" && projectKind === "headless_cli") return "headless_cli_skips_auth_middleware";
  if (id === "P0.3" && !capabilities.auth) return "auth_not_required";
  if (id === "P0.4") return "pure_cli_or_api_skips_design_system";
  if (id === "P0.8") return "non_ui_skips_jsx_preview";
  return "not_applicable";
}

function recipeFor(id: string, projectKind: ProjectKind): Phase0Recipe {
  const files = filesForTask(id, projectKind);
  const writeScope = id === "P0.1" ? [...Object.keys(files), "pnpm-lock.yaml"] : Object.keys(files);
  if (writeScope.length === 0) {
    throw new Phase0Error("phase0_order", `No foundation files for ${id}`);
  }
  const brownfield = id.startsWith("P0.B");
  return {
    id,
    title: titleFor(id),
    stage: id === "P0.1" ? "serial" : "parallel",
    dependsOn: brownfield || id === "P0.1" ? [] : ["P0.1"],
    level: id === "P0.2" || id === "P0.3" || id === "P0.4" || id === "P0.7" || id === "P0.B1" ? "mid" : "junior",
    writeScope,
    steps: [`Execute ${id} inside its disjoint write scope.`, "Route dependency installs through the kernel installer."],
    expectedOutputs: writeScope,
    refs: refsFor(id),
  };
}

function titleFor(id: string): string {
  const titles: Record<string, string> = {
    "P0.1": "Scaffold, manifests, configs, env example, and kernel install",
    "P0.2": "Database schema skeleton, migrations, and template database",
    "P0.3": "Auth middleware and shared error envelope",
    "P0.4": "UI design system and /__styleguide harness",
    "P0.5": "Shared domain types, validation, and brand registry",
    "P0.6": "Test environment, smoke harness, and CI stub",
    "P0.7": "Observability, health, and deterministic clock",
    "P0.8": "Dev JSX source tagger and preview entry",
    "P0.B1": "Brownfield characterization and baseline test health",
    "P0.B2": "Brownfield additive prep without scaffold edits",
  };
  return titles[id] ?? id;
}

function refsFor(id: string): readonly string[] {
  const refs: Record<string, readonly string[]> = {
    "P0.1": ["Task 048"],
    "P0.2": ["Task 052"],
    "P0.4": ["Task 094"],
    "P0.5": ["Task 099"],
    "P0.6": ["Task 050"],
    "P0.8": ["Task 160", "Task 161"],
    "P0.B1": ["Task 170"],
    "P0.B2": ["Task 048", "Task 166"],
  };
  return refs[id] ?? [];
}

function assertOrder(projectKind: ProjectKind, recipes: readonly Phase0Recipe[]): void {
  if (projectKind === "brownfield") {
    for (const recipe of recipes) {
      if (recipe.stage !== "parallel" || recipe.dependsOn.length !== 0 || recipe.id === "P0.1") {
        throw new Phase0Error("phase0_order", `${recipe.id} is not a brownfield prep task`);
      }
    }
    return;
  }
  const first = recipes[0];
  if (!first || first.id !== "P0.1" || first.stage !== "serial") {
    throw new Phase0Error("phase0_order", "P0.1 must be the serial first Phase 0 recipe");
  }
  for (const recipe of recipes.slice(1)) {
    if (recipe.stage !== "parallel" || recipe.dependsOn.length !== 1 || recipe.dependsOn[0] !== "P0.1") {
      throw new Phase0Error("phase0_order", `${recipe.id} must run in parallel after P0.1`);
    }
  }
}

function assertDisjoint(recipes: readonly Phase0Recipe[]): void {
  for (let i = 0; i < recipes.length; i += 1) {
    const left = recipes[i];
    if (!left) continue;
    for (let j = i + 1; j < recipes.length; j += 1) {
      const right = recipes[j];
      if (!right) continue;
      for (const a of left.writeScope) {
        for (const b of right.writeScope) {
          if (scopesOverlap(a, b)) {
            throw new Phase0Error("overlapping_write_scope", `${left.id} overlaps ${right.id} at ${a} and ${b}`);
          }
        }
      }
    }
  }
}
