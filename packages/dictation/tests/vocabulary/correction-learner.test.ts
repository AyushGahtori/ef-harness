import { describe, expect, it } from "vitest";
import {
  MemoryVocabularyStore,
  TwoOccurrenceCorrectionLearner,
  WhisperInitialPromptBuilder,
} from "../../src/vocabulary/index.js";
import { fixedClock } from "./fixtures.js";

function learn(store: MemoryVocabularyStore) {
  return new TwoOccurrenceCorrectionLearner(store, fixedClock);
}

describe("TwoOccurrenceCorrectionLearner", () => {
  it("ignores a single accidental typo and promotes on the second distinct occurrence", () => {
    const store = new MemoryVocabularyStore();
    const learner = learn(store);
    const once = learner.observeCorrection({
      projectId: "kitchen",
      heard: "order",
      corrected: "odrer",
      occurrenceId: "turn-typo",
    });
    expect(once.promoted).toBe(false);
    expect(once.occurrence_count).toBe(1);
    expect(learner.apply("kitchen", "order the menu").text).toBe("order the menu");

    const replay = learner.observeCorrection({
      projectId: "kitchen",
      heard: "order",
      corrected: "odrer",
      occurrenceId: "turn-typo",
    });
    expect(replay.occurrence_count).toBe(1);
    expect(replay.promoted).toBe(false);

    const first = learner.observeCorrection({
      projectId: "kitchen",
      heard: "super base",
      corrected: "Supabase",
      occurrenceId: "turn-1",
    });
    expect(first.promoted).toBe(false);
    expect(learner.apply("kitchen", "open super base").text).toBe("open super base");
    const second = learner.observeCorrection({
      projectId: "kitchen",
      heard: "super base",
      corrected: "Supabase",
      occurrenceId: "turn-2",
    });
    expect(second.promoted).toBe(true);
    expect(second.occurrence_count).toBe(2);
    const draft = learner.apply("kitchen", "open super base now");
    expect(draft.text).toBe("open Supabase now");
    expect(draft.spans[0]?.tooltip).toBe("Auto-corrected from 'super base' · Undo");
    expect(draft.undo(draft.spans[0]?.id ?? "").text).toBe("open super base now");

    const stored = store.get("kitchen", "Supabase");
    expect(stored?.source).toBe("user_correction");
    expect(stored?.weight).toBeGreaterThanOrEqual(800);
    expect(stored?.correction_from).toBe("super base");
  });

  it("preserves developer casing and does not retitle the rest of the sentence", () => {
    const store = new MemoryVocabularyStore();
    const learner = learn(store);
    const pairs = [
      ["post grass", "Postgres"],
      ["vite", "Vite"],
      ["oauth", "OAuth"],
      ["sqlite", "SQLite"],
      ["next js", "Next.js"],
      ["tee rpc", "tRPC"],
      ["prisma", "Prisma"],
      ["post gre sql", "PostgreSQL"],
    ] as const;
    for (const [heard, corrected] of pairs) {
      learner.observeCorrection({ projectId: "kitchen", heard, corrected, occurrenceId: `${corrected}-1` });
      learner.observeCorrection({ projectId: "kitchen", heard, corrected, occurrenceId: `${corrected}-2` });
    }
    const draft = learner.apply(
      "kitchen",
      "vite ships oauth tokens into sqlite and next js with tee rpc plus prisma post gre sql",
    );
    expect(draft.text).toBe(
      "Vite ships OAuth tokens into SQLite and Next.js with tRPC plus Prisma PostgreSQL",
    );
    expect(draft.text).not.toMatch(/Oauth|Sqlite|Vite Ships/);
    for (const span of draft.spans) {
      expect(span.tooltip).toBe(`Auto-corrected from '${span.heard}' · Undo`);
    }
  });

  it("permanently honors a suppressed deletion", () => {
    const store = new MemoryVocabularyStore();
    const learner = learn(store);
    learner.observeCorrection({
      projectId: "kitchen",
      heard: "post grass",
      corrected: "Postgres",
      occurrenceId: "a",
    });
    learner.observeCorrection({
      projectId: "kitchen",
      heard: "post grass",
      corrected: "Postgres",
      occurrenceId: "b",
    });
    const row = store.get("kitchen", "Postgres");
    expect(row).not.toBeNull();
    if (!row) return;
    store.upsert({ ...row, suppressed: true });
    const again = learner.observeCorrection({
      projectId: "kitchen",
      heard: "post grass",
      corrected: "Postgres",
      occurrenceId: "c",
    });
    expect(again.ignoredBecauseSuppressed).toBe(true);
    expect(again.promoted).toBe(false);
    learner.observeCorrection({
      projectId: "kitchen",
      heard: "post grass",
      corrected: "Postgres",
      occurrenceId: "d",
    });
    expect(learner.apply("kitchen", "use post grass").text).toBe("use post grass");
    expect(store.get("kitchen", "Postgres")?.suppressed).toBe(true);
  });

  it("leaves a one-off typo out of the whisper prompt", () => {
    const store = new MemoryVocabularyStore();
    const learner = learn(store);
    learner.observeCorrection({
      projectId: "kitchen",
      heard: "order",
      corrected: "odrer",
      occurrenceId: "once",
    });
    const prompt = new WhisperInitialPromptBuilder().build({
      projectId: "kitchen",
      entries: store.list(),
    });
    expect(prompt.terms).not.toContain("odrer");
  });
});
