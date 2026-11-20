import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AsymmetricConflictError,
  DuplicateQuestionIdError,
  InsufficientExamplesError,
  MustAskPolicyFloorError,
  OrphanCriterionError,
  PrerequisiteCycleError,
  UnrecognizedTouchesTagError,
  YamlParseError,
} from "../../src/corpus-loader/errors.js";
import { CorpusPackLoader } from "../../src/corpus-loader/load.js";
import { TOUCHES_TAGS } from "../../src/corpus-loader/touches-tags.js";
import { buildQuestion, questionPack, writeCorpus } from "./fixture.js";

describe("corpus loader adversarial fixtures", () => {
  it("rejects an unrecognized touches tag with the file, question id, and the 28 valid tags", () => {
    const question = buildQuestion("Q-CORE-01", { touches: ["graphql_magic"] });
    const root = writeCorpus([
      { relativePath: "packs/bad/core.json", document: questionPack("bad", [question]) },
    ]);
    try {
      new CorpusPackLoader(root).load();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnrecognizedTouchesTagError);
      const parsed = error as UnrecognizedTouchesTagError;
      expect(parsed.questionId).toBe("Q-CORE-01");
      expect(parsed.filePath).toContain(path.join("packs", "bad", "core.json"));
      expect(parsed.message).toContain("graphql_magic");
      expect(parsed.validTags).toEqual(TOUCHES_TAGS);
      expect(parsed.message).toContain("personal_data");
      expect(parsed.message).toContain("concurrent_edit");
    }
  });

  it("rejects a duplicate question id instead of keeping one copy", () => {
    const root = writeCorpus([
      {
        relativePath: "packs/one/data.json",
        document: questionPack("one", [buildQuestion("Q-DATA-03")]),
      },
      {
        relativePath: "packs/two/data.json",
        document: questionPack("two", [buildQuestion("Q-DATA-03", { criteria: ["fixture.other_copy"] })]),
      },
    ]);
    try {
      new CorpusPackLoader(root).load();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateQuestionIdError);
      const parsed = error as DuplicateQuestionIdError;
      expect(parsed.questionId).toBe("Q-DATA-03");
      expect(parsed.message).toContain("Q-DATA-03");
      expect(parsed.message).toContain("data.json");
    }
  });

  it("rejects a prerequisite cycle with the question ids", () => {
    const left = buildQuestion("Q-CORE-01", { requires: ["Q-CORE-02"] });
    const right = buildQuestion("Q-CORE-02", { requires: ["Q-CORE-01"] });
    const root = writeCorpus([{ relativePath: "packs/cycle/core.json", document: questionPack("cycle", [left, right]) }]);
    try {
      new CorpusPackLoader(root).load();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PrerequisiteCycleError);
      const parsed = error as PrerequisiteCycleError;
      expect(parsed.message).toContain("Q-CORE-01");
      expect(parsed.message).toContain("Q-CORE-02");
      expect(parsed.filePath).toContain("core.json");
    }
  });

  it("rejects four positive examples and one negative example", () => {
    const shortPositive = buildQuestion("Q-CORE-01");
    const root = writeCorpus([
      {
        relativePath: "packs/short/core.json",
        document: questionPack("short", [
          {
            ...shortPositive,
            positive_examples: shortPositive.positive_examples.slice(0, 4),
          },
        ]),
      },
    ]);
    try {
      new CorpusPackLoader(root).load();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientExamplesError);
      const parsed = error as InsufficientExamplesError;
      expect(parsed.questionId).toBe("Q-CORE-01");
      expect(parsed.message).toContain("4 positive");
      expect(parsed.filePath).toContain("core.json");
    }

    const shortNegative = buildQuestion("Q-AUTH-01");
    const negativeRoot = writeCorpus([
      {
        relativePath: "packs/short/auth.json",
        document: questionPack("short", [
          { ...shortNegative, negative_examples: shortNegative.negative_examples.slice(0, 1) },
        ]),
      },
    ]);
    expect(() => new CorpusPackLoader(negativeRoot).load()).toThrow(InsufficientExamplesError);
  });

  it("rejects a duplicate YAML key with the file path and line number", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-corpus-yaml-"));
    const file = path.join(root, "packs", "bad", "core.yaml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ["kind: question_pack", "id: bad", "id: worse", "version: 1"].join("\n"), "utf8");
    try {
      new CorpusPackLoader(root).load();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(YamlParseError);
      const parsed = error as YamlParseError;
      expect(parsed.filePath).toBe(file);
      expect(parsed.line).toBe(3);
      expect(parsed.message).toContain('Duplicate YAML key "id"');
    }
  });

  it("rejects costly or irreversible questions that set must_ask to false", () => {
    const question = buildQuestion("Q-AUTH-01", { reversibility: "irreversible", must_ask: false });
    const root = writeCorpus([{ relativePath: "packs/floor/auth.json", document: questionPack("floor", [question]) }]);
    try {
      new CorpusPackLoader(root).load();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MustAskPolicyFloorError);
      const parsed = error as MustAskPolicyFloorError;
      expect(parsed.questionId).toBe("Q-AUTH-01");
      expect(parsed.message).toContain("MustAskPolicyFloor");
    }
  });

  it("normalizes a one-sided conflict and still fails strict CI lint", () => {
    const left = buildQuestion("Q-CORE-01", { conflicts_with: ["Q-CORE-02"] });
    const right = buildQuestion("Q-CORE-02", { conflicts_with: [] });
    const root = writeCorpus([
      { relativePath: "packs/conflict/core.json", document: questionPack("conflict", [left, right]) },
    ]);
    const loose = new CorpusPackLoader(root, { validate: false }).load();
    expect(loose.questions.find((question) => question.id === "Q-CORE-01")?.conflicts_with).toContain("Q-CORE-02");
    expect(loose.questions.find((question) => question.id === "Q-CORE-02")?.conflicts_with).toContain("Q-CORE-01");
    expect(loose.conflictAsymmetries).toHaveLength(1);
    expect(() => new CorpusPackLoader(root, { strictConflicts: true }).load()).toThrow(AsymmetricConflictError);
    expect(() => new CorpusPackLoader(root, { strictConflicts: false }).load()).not.toThrow();
  });

  it("rejects an orphan criterion key", () => {
    const question = buildQuestion("Q-DATA-02", { invalidates_on_change: ["missing.criterion"] });
    const root = writeCorpus([{ relativePath: "packs/orphan/data.json", document: questionPack("orphan", [question]) }]);
    try {
      new CorpusPackLoader(root).load();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OrphanCriterionError);
      const parsed = error as OrphanCriterionError;
      expect(parsed.questionId).toBe("Q-DATA-02");
      expect(parsed.message).toContain("missing.criterion");
      expect(parsed.filePath).toContain("data.json");
    }
  });
});
