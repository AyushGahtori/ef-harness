import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportCorpusEvalDataset } from "../../src/corpus-loader/eval-export.js";
import { loadCorpusPacks } from "../../src/corpus-loader/load.js";
import { repositoryCorpusRoot } from "../../src/corpus-loader/paths.js";
import { TOUCHES_TAGS } from "../../src/corpus-loader/touches-tags.js";
import { PROJECT_STAGES } from "../../src/corpus-loader/types.js";

describe("M2 core data auth corpus", () => {
  const bundle = loadCorpusPacks(repositoryCorpusRoot());

  it("loads exactly 18 core, 6 data, and 5 auth questions", () => {
    const counts = new Map<string, number>();
    for (const question of bundle.questions) {
      const file = path.basename(question.source_file);
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    expect(counts.get("core.yaml")).toBe(18);
    expect(counts.get("data.yaml")).toBe(6);
    expect(counts.get("auth.yaml")).toBe(5);
    expect(bundle.questions).toHaveLength(29);
    expect(bundle.corpusBundleHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the corpus bundle hash stable across loads and changes it when a question changes", () => {
    const again = loadCorpusPacks(repositoryCorpusRoot());
    expect(again.corpusBundleHash).toBe(bundle.corpusBundleHash);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-corpus-hash-"));
    const source = path.join(repositoryCorpusRoot(), "packs", "core-data-auth");
    const destination = path.join(root, "packs", "core-data-auth");
    fs.mkdirSync(destination, { recursive: true });
    for (const name of ["core.yaml", "data.yaml", "auth.yaml"]) {
      fs.copyFileSync(path.join(source, name), path.join(destination, name));
    }
    expect(loadCorpusPacks(root).corpusBundleHash).toBe(bundle.corpusBundleHash);
    const corePath = path.join(destination, "core.yaml");
    const core = fs.readFileSync(corePath, "utf8").replace("Who is this for", "Who exactly is this for");
    fs.writeFileSync(corePath, core, "utf8");
    expect(loadCorpusPacks(root).corpusBundleHash).not.toBe(bundle.corpusBundleHash);
  });

  it("validates examples, closed touches tags, stage recommendations, and an acyclic graph", () => {
    expect(TOUCHES_TAGS).toHaveLength(28);
    for (const question of bundle.questions) {
      expect(question.positive_examples.length).toBeGreaterThanOrEqual(5);
      expect(question.negative_examples.length).toBeGreaterThanOrEqual(2);
      expect(question.positive_examples.some((example) => example.style === "spoken_dictation")).toBe(true);
      for (const tag of question.touches) expect(TOUCHES_TAGS).toContain(tag);
      for (const stage of PROJECT_STAGES) {
        expect(question.stage_recommendations[stage].rationale.trim().length).toBeGreaterThan(0);
        expect(question.options.some((option) => option.id === question.stage_recommendations[stage].option)).toBe(
          true,
        );
      }
      for (const option of question.options) {
        expect(option.label.trim().length).toBeGreaterThan(0);
        expect(option.meaning.trim().length).toBeGreaterThan(0);
        expect(option.stage_suitability.length).toBeGreaterThan(0);
      }
    }
    const offline = bundle.questions.find((question) => question.id === "Q-CORE-06");
    expect(offline?.negative_examples.some((example) => example.utterance === "use on their phones")).toBe(true);
    expect(offline?.negative_examples.some((example) => example.must_not_settle.includes("offline_native_app"))).toBe(
      true,
    );
  });

  it("exports a deterministic positive and negative dataset for later evals", () => {
    const first = exportCorpusEvalDataset(bundle);
    const second = exportCorpusEvalDataset(bundle);
    expect(first.positiveCount).toBe(29 * 5);
    expect(first.negativeCount).toBe(29 * 2);
    expect(first.caseCount).toBe(203);
    expect(first.datasetHash).toBe(second.datasetHash);
    expect(first.cases[0]?.polarity).toBe("negative");
    expect(first.corpusBundleHash).toBe(bundle.corpusBundleHash);
    const phones = first.cases.find(
      (item) => item.questionId === "Q-CORE-06" && item.utterance === "use on their phones",
    );
    expect(phones?.polarity).toBe("negative");
    expect(phones?.mustNotSettle).toContain("offline_native_app");
  });

  it("validates the real packs in under 500ms", () => {
    const started = Date.now();
    loadCorpusPacks(repositoryCorpusRoot());
    expect(Date.now() - started).toBeLessThan(500);
  });
});
