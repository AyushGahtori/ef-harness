import { describe, expect, it } from "vitest";

import { LocalPhase0RecipeGenerator } from "../../src/phase0/catalog.js";
import { Phase0Error } from "../../src/phase0/errors.js";
import { LocalDeterministicGraphCompiler } from "../../src/phase0/graph-port.js";
import { buildGate0Receipt, Gate0ReceiptSchema, wave1MayStart } from "../../src/phase0/schema.js";
import { scopesOverlap } from "../../src/phase0/scope.js";
import { prepareExecution, rawInstallViolation } from "../../src/phase0/supply-chain.js";
import type { Gate0Receipt, Phase0Recipe } from "../../src/phase0/types.js";

const generator = new LocalPhase0RecipeGenerator();
const compiler = new LocalDeterministicGraphCompiler();

describe("Phase 0 recipe port and supply-chain guard", () => {
  it("keeps P0.1 serial and P0.2-P0.8 parallel for a web SaaS", () => {
    const plan = generator.generate({ projectKind: "web_saas" });
    expect(plan.recipes.map((recipe) => recipe.id)).toEqual(["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"]);
    expect(plan.recipes[0]?.stage).toBe("serial");
    expect(plan.recipes.slice(1).every((recipe) => recipe.stage === "parallel" && recipe.dependsOn[0] === "P0.1")).toBe(true);
    expect(plan.omitted).toEqual([]);
    expect(compiler.compile(plan).ok).toBe(true);
  });

  it("omits auth and UI recipes for a headless CLI and skips P0.1 for brownfield", () => {
    const cli = generator.generate({ projectKind: "headless_cli" });
    expect(cli.recipes.map((recipe) => recipe.id)).toEqual(["P0.1", "P0.2", "P0.5", "P0.6", "P0.7"]);
    expect(cli.omitted.map((item) => item.id)).toEqual(["P0.3", "P0.4", "P0.8"]);
    const brownfield = generator.generate({ projectKind: "brownfield" });
    expect(brownfield.recipes.map((recipe) => recipe.id)).toEqual(["P0.B1", "P0.B2"]);
    expect(brownfield.recipes.some((recipe) => recipe.writeScope.includes("package.json"))).toBe(false);
    expect(compiler.compile(brownfield).ok).toBe(true);
  });

  it("hoists parallel package.json edits into the P0.1 install", () => {
    const plan = generator.generate({ projectKind: "web_saas" });
    const recipes = plan.recipes.map((recipe) =>
      recipe.id === "P0.2" || recipe.id === "P0.4"
        ? {
            ...recipe,
            writeScope: [...recipe.writeScope, "package.json"],
            dependencyIntents: [{ name: "left-pad", version: "1.0.0", approved: true }],
          }
        : recipe,
    );
    const compiled = compiler.compile({ ...plan, recipes });
    expect(compiled.ok).toBe(true);
    expect(compiled.hoistedIntents.map((intent) => intent.name)).toEqual(["left-pad", "left-pad"]);
    expect(compiled.recipes.find((recipe) => recipe.id === "P0.2")?.writeScope.includes("package.json")).toBe(false);
    expect(compiled.recipes.find((recipe) => recipe.id === "P0.4")?.writeScope.includes("package.json")).toBe(false);
  });

  it("rejects overlapping Stage 0B write scopes", () => {
    const plan = generator.generate({ projectKind: "api" });
    const recipes = plan.recipes.map((recipe) =>
      recipe.id === "P0.5" ? { ...recipe, writeScope: [...recipe.writeScope, "src/auth/middleware.ts"] } : recipe,
    );
    const compiled = compiler.compile({ ...plan, recipes });
    expect(compiled.ok).toBe(false);
    expect(compiled.errors.some((error) => error.includes("overlaps"))).toBe(true);
    expect(scopesOverlap("src/auth/**", "src/auth/middleware.ts")).toBe(true);
  });

  it("rejects raw installs and files outside the task scope", () => {
    const task = taskOf("P0.5", ["src/domain/index.ts"]);
    expect(rawInstallViolation(["npm install left-pad"])).toContain("kernel installer");
    expect(rawInstallViolation(["pnpm add zod"])).toContain("kernel installer");
    expect(rawInstallViolation(["node scripts/phase0/lint.mjs"])).toBeNull();
    expect(() =>
      prepareExecution(task, { files: { "src/domain/index.ts": "export const domainReady = true;\n" }, dependencyIntents: [], attemptedCommands: ["npm install left-pad"] }),
    ).toThrow(Phase0Error);
    expect(() =>
      prepareExecution(task, { files: { "src/evil.ts": "export const evil = true;\n" }, dependencyIntents: [], attemptedCommands: [] }),
    ).toThrow(/cannot write/);
    const prepared = prepareExecution(
      { ...task, id: "P0.2", writeScope: ["db/schema.sql"] },
      {
        files: { "package.json": `${JSON.stringify({ dependencies: { "left-pad": "1.0.0" } })}\n`, "db/schema.sql": "-- schema\n" },
        dependencyIntents: [{ name: "left-pad", version: "1.0.0", approved: true }],
        attemptedCommands: [],
      },
    );
    expect(prepared.files["package.json"]).toBeUndefined();
    expect(prepared.dependencyIntents[0]?.approved).toBe(true);
  });

  it("keeps Wave 1 locked unless the receipt is PASS for that integration sha", () => {
    const sha = "a".repeat(40);
    const receipt = buildGate0Receipt({
      projectId: "web",
      status: "PASS",
      integrationSha: sha,
      repairAttempts: 0,
      commands: [{ id: "typecheck", command: "node --check src/server.ts", durationMs: 2, exitCode: 0 }],
      checks: [{ id: "typecheck", ownerTaskId: "P0.1", status: "pass", detail: "exit 0" }],
      failingTaskId: null,
      failureKind: null,
      styleguideThumbnail: null,
      escalated: false,
      quarantine: [],
      recordedAt: 1,
    });
    expect(Gate0ReceiptSchema.parse(JSON.parse(JSON.stringify(receipt))).wave1Unlocked).toBe(true);
    expect(wave1MayStart(receipt, sha)).toBe(true);
    expect(wave1MayStart(receipt, "b".repeat(40))).toBe(false);
    const failed: Gate0Receipt = { ...receipt, status: "FAIL", wave1Unlocked: true, failingTaskId: "P0.1", failureKind: "typecheck_failed" };
    expect(Gate0ReceiptSchema.safeParse(failed).ok).toBe(false);
    expect(Gate0ReceiptSchema.safeParse({ ...receipt, repairAttempts: 3 }).ok).toBe(false);
  });
});

function taskOf(id: string, writeScope: readonly string[]): Phase0Recipe {
  return {
    id,
    title: id,
    stage: "parallel",
    dependsOn: ["P0.1"],
    level: "junior",
    writeScope,
    steps: [],
    expectedOutputs: writeScope,
    refs: [],
  };
}
