import { describe, expect, it } from "vitest";

import { Phase0RecipeGenerator, writeScopesOverlap } from "../../src/master-plan/index.js";

function overlapsAny(scopes: readonly (readonly string[])[]): boolean {
  for (let i = 0; i < scopes.length; i += 1) {
    const left = scopes[i] ?? [];
    for (let j = i + 1; j < scopes.length; j += 1) {
      const right = scopes[j] ?? [];
      for (const a of left) {
        for (const b of right) {
          if (writeScopesOverlap(a, b)) return true;
        }
      }
    }
  }
  return false;
}

describe("Phase0RecipeGenerator", () => {
  const generator = new Phase0RecipeGenerator();

  it("generates serial P0.1 then parallel P0.2-P0.8 for a web SaaS", () => {
    const plan = generator.generate({ projectKind: "web_saas" });
    expect(plan.recipes.map((recipe) => recipe.id)).toEqual([
      "P0.1",
      "P0.2",
      "P0.3",
      "P0.4",
      "P0.5",
      "P0.6",
      "P0.7",
      "P0.8",
    ]);
    const first = plan.recipes[0];
    expect(first?.stage).toBe("serial");
    expect(first?.dependsOn).toEqual([]);
    expect(first?.writeScope).toContain("package.json");
    expect(first?.writeScope).toContain("pnpm-lock.yaml");
    expect(first?.writeScope).toContain(".env.example");
    expect(first?.refs).toContain("Task 048");
    for (const recipe of plan.recipes.slice(1)) {
      expect(recipe.stage).toBe("parallel");
      expect(recipe.dependsOn).toEqual(["P0.1"]);
    }
    expect(plan.recipes.find((recipe) => recipe.id === "P0.4")?.refs).toContain("Task 094");
    expect(plan.recipes.find((recipe) => recipe.id === "P0.8")?.refs).toEqual(["Task 160", "Task 161"]);
    expect(overlapsAny(plan.recipes.map((recipe) => recipe.writeScope))).toBe(false);
    expect(plan.omitted).toEqual([]);
  });

  it("skips P0.3, P0.4, and P0.8 for a headless CLI", () => {
    const plan = generator.generate({ projectKind: "headless_cli" });
    expect(plan.recipes.map((recipe) => recipe.id)).toEqual(["P0.1", "P0.2", "P0.5", "P0.6", "P0.7"]);
    expect(plan.recipes.some((recipe) => recipe.id === "P0.4" || recipe.id === "P0.8" || recipe.id === "P0.3")).toBe(
      false,
    );
    expect(plan.omitted.map((item) => item.id)).toEqual(["P0.3", "P0.4", "P0.8"]);
    expect(plan.omitted.find((item) => item.id === "P0.4")?.reason).toBe("pure_cli_or_api_skips_design_system");
    expect(plan.omitted.find((item) => item.id === "P0.8")?.reason).toBe("non_ui_skips_jsx_preview");
    const smoke = plan.recipes.find((recipe) => recipe.id === "P0.6");
    expect(smoke?.writeScope.join(" ")).not.toContain("playwright.config.ts");
    expect(overlapsAny(plan.recipes.map((recipe) => recipe.writeScope))).toBe(false);
  });

  it("skips UI recipes for an API and keeps auth", () => {
    const plan = generator.generate({ projectKind: "api" });
    expect(plan.recipes.map((recipe) => recipe.id)).toEqual([
      "P0.1",
      "P0.2",
      "P0.3",
      "P0.5",
      "P0.6",
      "P0.7",
    ]);
  });

  it("skips P0.1 scaffold for a brownfield repo and does not touch package.json", () => {
    const plan = generator.generate({ projectKind: "brownfield" });
    expect(plan.recipes.map((recipe) => recipe.id)).toEqual(["P0.B1", "P0.B2"]);
    for (const recipe of plan.recipes) {
      expect(recipe.stage).toBe("parallel");
      expect(recipe.dependsOn).toEqual([]);
      expect(recipe.writeScope.join(" ")).not.toContain("package.json");
      expect(recipe.writeScope).not.toContain("pnpm-lock.yaml");
      expect(recipe.writeScope).not.toContain("tsconfig.json");
      expect(recipe.writeScope).not.toContain("eslint.config.mjs");
    }
    expect(plan.omitted.map((item) => item.id)).toEqual([
      "P0.1",
      "P0.2",
      "P0.3",
      "P0.4",
      "P0.5",
      "P0.6",
      "P0.7",
      "P0.8",
    ]);
    expect(plan.omitted.every((item) => item.reason === "brownfield_skips_greenfield_scaffold")).toBe(true);
    expect(overlapsAny(plan.recipes.map((recipe) => recipe.writeScope))).toBe(false);
  });

  it("is deterministic for the same project kind", () => {
    expect(generator.generate({ projectKind: "web_saas" })).toEqual(generator.generate({ projectKind: "web_saas" }));
  });
});
