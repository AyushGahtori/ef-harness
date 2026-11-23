import { describe, expect, it } from "vitest";
import {
  CARRY_INITIAL_PROMPT_FLAG,
  VOCABULARY_PIPELINE_BUDGET_MS,
  WHISPER_PROMPT_TOKEN_LIMIT,
  WhisperInitialPromptBuilder,
  countWhisperBpeTokens,
  encodeWhisperBpe,
  warmWhisperBpe,
} from "../../src/vocabulary/index.js";
import { entry } from "./fixtures.js";

describe("WhisperInitialPromptBuilder", () => {
  it("caps 800 terms at 224 BPE tokens, lowest weight first, and carries the initial prompt", () => {
    warmWhisperBpe();
    const entries = Array.from({ length: 800 }, (_, index) => {
      const term = `Qzx${String(index).padStart(4, "0")}abcdefghijKLMNOPQRST`;
      return entry({
        term,
        project_id: "kitchen",
        weight: index + 1,
        source: "entity_auto",
      });
    });
    const totalTokens = entries.reduce((sum, item) => sum + countWhisperBpeTokens(` ${item.term}`), 0);
    expect(totalTokens).toBeGreaterThanOrEqual(3_500);

    const builder = new WhisperInitialPromptBuilder();
    let prompt = builder.build({ projectId: "kitchen", entries });
    let bestMs = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 7; run += 1) {
      const started = performance.now();
      prompt = builder.build({ projectId: "kitchen", entries });
      bestMs = Math.min(bestMs, performance.now() - started);
    }

    expect(prompt.tokenCount).toBeLessThanOrEqual(WHISPER_PROMPT_TOKEN_LIMIT);
    expect(prompt.tokenCount).toBe(prompt.tokenIds.length);
    expect([...prompt.tokenIds]).toEqual([...encodeWhisperBpe(prompt.text)]);
    expect(prompt.carryInitialPrompt).toBe(true);
    expect(prompt.flag).toBe(CARRY_INITIAL_PROMPT_FLAG);
    expect(prompt.args).toEqual(["--prompt", prompt.text, CARRY_INITIAL_PROMPT_FLAG]);
    expect(prompt.terms.length).toBeGreaterThan(0);
    expect(prompt.terms.length).toBeLessThan(800);

    const heaviest = entries[799]?.term;
    expect(heaviest).toBeDefined();
    expect(prompt.terms.at(-1)).toBe(heaviest);
    expect(prompt.text.endsWith(heaviest ?? "")).toBe(true);
    const weightOf = new Map(entries.map((item) => [item.term, item.weight]));
    for (let index = 1; index < prompt.terms.length; index += 1) {
      const previous = weightOf.get(prompt.terms[index - 1] ?? "") ?? 0;
      const current = weightOf.get(prompt.terms[index] ?? "") ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
    expect(bestMs).toBeLessThan(VOCABULARY_PIPELINE_BUDGET_MS);
  });

  it("ranks focused canvas terms above corrections, entities, tech stack, and older terms", () => {
    warmWhisperBpe();
    const builder = new WhisperInitialPromptBuilder();
    const prompt = builder.build({
      projectId: "kitchen",
      focusTerms: ["DietaryTag"],
      neighborTerms: ["Allergen"],
      entries: [
        entry({ term: "OldName", project_id: "kitchen", source: "user_manual", weight: 900 }),
        entry({ term: "Playwright", project_id: "kitchen", source: "tech_stack", weight: 300 }),
        entry({ term: "MenuItem", project_id: "kitchen", source: "entity_auto", weight: 500 }),
        entry({
          term: "Supabase",
          project_id: "kitchen",
          source: "user_correction",
          weight: 800,
          occurrence_count: 2,
          correction_from: "super base",
        }),
        entry({ term: "DietaryTag", project_id: "kitchen", source: "entity_auto", weight: 1 }),
        entry({ term: "Allergen", project_id: "kitchen", source: "entity_auto", weight: 2 }),
        entry({ term: "GahtoriKitchen", project_id: "other", source: "entity_auto", weight: 5_000 }),
      ],
    });
    expect(prompt.terms).toEqual(["OldName", "Playwright", "MenuItem", "Supabase", "Allergen", "DietaryTag"]);
    expect(prompt.text.endsWith("Allergen DietaryTag")).toBe(true);
    expect(prompt.text.includes("GahtoriKitchen")).toBe(false);
    expect(prompt.tokenCount).toBeLessThanOrEqual(WHISPER_PROMPT_TOKEN_LIMIT);
  });

  it("keeps a focused box on the tail after a project fills the 224-token budget", () => {
    warmWhisperBpe();
    const fillers = Array.from({ length: 400 }, (_, index) =>
      entry({
        term: `Fill${String(index).padStart(4, "0")}abcdefghij`,
        project_id: "kitchen",
        source: "tech_stack",
        weight: 200 + index,
      }),
    );
    const builder = new WhisperInitialPromptBuilder();
    const prompt = builder.build({
      projectId: "kitchen",
      entries: [
        ...fillers,
        entry({ term: "DietaryTag", project_id: "kitchen", source: "user_manual", weight: 1 }),
        entry({ term: "Allergen", project_id: "kitchen", source: "user_manual", weight: 1 }),
      ],
      focusTerms: ["DietaryTag"],
      neighborTerms: ["Allergen"],
    });
    expect(prompt.tokenCount).toBeLessThanOrEqual(WHISPER_PROMPT_TOKEN_LIMIT);
    expect(prompt.terms.at(-1)).toBe("DietaryTag");
    expect(prompt.terms.at(-2)).toBe("Allergen");
    expect(prompt.terms.length).toBeLessThan(402);
    expect(prompt.args[2]).toBe("--carry-initial-prompt");
  });

  it("shares global tech terms and drops unpromoted one-off corrections", () => {
    const builder = new WhisperInitialPromptBuilder();
    const prompt = builder.build({
      projectId: "expense",
      entries: [
        entry({ term: "PostgreSQL", project_id: "", source: "tech_stack", weight: 300 }),
        entry({ term: "ExpenseCli", project_id: "expense", source: "entity_auto", weight: 500 }),
        entry({ term: "GahtoriKitchen", project_id: "kitchen", source: "entity_auto", weight: 500 }),
        entry({
          term: "odrer",
          project_id: "expense",
          source: "user_correction",
          weight: 100,
          occurrence_count: 1,
          correction_from: "order",
        }),
      ],
    });
    expect(prompt.terms).toEqual(["PostgreSQL", "ExpenseCli"]);
  });
});
