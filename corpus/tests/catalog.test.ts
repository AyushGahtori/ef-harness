import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CorpusLoadError, CorpusPackLoader } from "../src/index.js";

const RULE_IDS = [
  "X-01",
  "X-02",
  "X-03",
  "X-04",
  "X-05",
  "X-06",
  "X-07",
  "X-08",
  "X-09",
  "X-10",
  "X-11",
  "X-12",
  "X-13",
  "X-14",
] as const;

const POLICY_IDS = ["UP-01", "UP-02", "UP-03", "UP-04", "UP-05", "UP-06", "UP-07", "UP-08"] as const;

const SEAM_IDS = ["S-01", "S-02", "S-03", "S-04", "S-05", "S-06", "S-07", "S-08", "S-09", "S-10"] as const;

describe("bundled corpus catalog", () => {
  const catalog = new CorpusPackLoader().loadAllBundledPacks();

  it("loads core, data, auth, and web-api-cli questions with anchors resolved", () => {
    const yamlQuestions = catalog.questions.filter((question) => question.sourceFile.endsWith(".yaml"));
    expect(yamlQuestions.filter((question) => question.sourceFile.endsWith("/core.yaml"))).toHaveLength(18);
    expect(yamlQuestions.filter((question) => question.sourceFile.endsWith("/data.yaml"))).toHaveLength(6);
    expect(yamlQuestions.filter((question) => question.sourceFile.endsWith("/auth.yaml"))).toHaveLength(5);
    expect(yamlQuestions.filter((question) => question.pack === "web").map((question) => question.id)).toEqual([
      "ui.responsive_targets",
      "ui.pages_inventory",
      "ui.forms_validation_style",
      "ui.states_style",
      "ui.look_and_feel",
      "ui.accessibility_level",
    ]);
    expect(yamlQuestions.filter((question) => question.pack === "api")).toHaveLength(5);
    expect(yamlQuestions.filter((question) => question.pack === "cli")).toHaveLength(4);
    const style = yamlQuestions.find((question) => question.id === "api.style");
    const rest = style?.options.find((option) => option.id === "rest_openapi");
    const rpc = style?.options.find((option) => option.id === "rpc_schema");
    expect(rest?.stageSuitability).toEqual(["prototype", "mvp", "production"]);
    expect(rpc?.stageSuitability).toEqual(rest?.stageSuitability);
  });

  it("loads X-01 through X-14, UP-01 through UP-08, and ten seam templates", () => {
    expect(catalog.crossCuttingRules.map((rule) => rule.id)).toEqual([...RULE_IDS]);
    expect(catalog.universalPolicies.map((policy) => policy.id)).toEqual([...POLICY_IDS]);
    expect(catalog.seamTemplates.map((seam) => seam.id)).toEqual([...SEAM_IDS]);
    expect(catalog.elaborations.length).toBeGreaterThanOrEqual(60);
  });

  it("keeps every elaboration and conflict option id attached to a loaded question", () => {
    expect(catalog.danglingOptionIds).toEqual([]);
    const pairs = new Set(
      catalog.questions.flatMap((question) => question.options.map((option) => `${question.id}:${option.id}`)),
    );
    for (const elaboration of catalog.elaborations) {
      expect(pairs.has(`${elaboration.questionId}:${elaboration.optionId}`)).toBe(true);
    }
  });

  it("loads the 87 v1 questions from core, wave 1, and wave 2", () => {
    const yamlQuestions = catalog.questions.filter((question) => question.sourceFile.endsWith(".yaml"));
    const m2 = yamlQuestions.filter(
      (question) =>
        question.sourceFile.includes("core-data-auth/") || question.sourceFile.includes("web-api-cli/"),
    );
    const wave1 = yamlQuestions.filter((question) => question.sourceFile.includes("wave1-expanded/"));
    const wave2 = yamlQuestions.filter((question) => question.sourceFile.includes("wave2-expanded/"));
    expect(m2).toHaveLength(44);
    expect(wave1).toHaveLength(28);
    expect(wave2).toHaveLength(15);
    expect(yamlQuestions).toHaveLength(87);
    expect(new Set(yamlQuestions.map((question) => question.id)).size).toBe(87);
    expect(catalog.danglingOptionIds).toEqual([]);
    expect(catalog.files.some((file) => file.path === "packs/wave1-expanded/payments.yaml")).toBe(true);
    expect(catalog.files.some((file) => file.path === "packs/wave2-expanded/manifest.yaml")).toBe(true);
    expect(catalog.files.some((file) => file.path === "packs/wave2-expanded/activation-table.yaml")).toBe(true);
    expect(yamlQuestions.every((question) => question.criteria.length > 0)).toBe(true);
    expect(yamlQuestions.every((question) => question.touches.length > 0)).toBe(true);
  });

  it("hashes the bundled files stably and includes the web-api-cli manifest", () => {
    expect(catalog.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new CorpusPackLoader().loadAllBundledPacks().manifestSha256).toBe(catalog.manifestSha256);
    expect(catalog.files.some((file) => file.path === "packs/web-api-cli/manifest.yaml")).toBe(true);
    expect(catalog.files.some((file) => file.path === "packs/web-api-cli/api.yaml")).toBe(true);
    expect(catalog.files.some((file) => file.path === "rules-seams/cross-cutting-rules.yaml")).toBe(true);
    expect(catalog.files.some((file) => file.path === "rules-seams/seam-templates.yaml")).toBe(true);
  });

  it("rejects a document whose alias count exceeds the cap", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-corpus-alias-"));
    const pack = path.join(root, "packs");
    fs.mkdirSync(pack);
    const lines = ["item: &row", "  - 1", ...Array.from({ length: 101 }, (_, index) => `copy${index}: *row`)];
    fs.writeFileSync(path.join(pack, "bomb.yaml"), lines.join("\n"), "utf8");
    expect(() => new CorpusPackLoader(root).loadAllBundledPacks()).toThrow(CorpusLoadError);
  });
});
