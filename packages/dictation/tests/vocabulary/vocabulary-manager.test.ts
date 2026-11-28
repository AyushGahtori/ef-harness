import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GlobalBrokerDb } from "@ef-harness/db";
import {
  FrozenGlobalVocabularyStore,
  GLOBAL_PROJECT_ID,
  GlobalBrokerVocabularyDriver,
  VOCABULARY_PIPELINE_BUDGET_MS,
  WHISPER_PROMPT_TOKEN_LIMIT,
  createProjectDictationVocabularyManager,
  warmWhisperBpe,
  type VocabularyEntry,
} from "../../src/vocabulary/index.js";
import { entry, fixedClock } from "./fixtures.js";
import { MemoryProjectStateCatalog } from "../../src/vocabulary/index.js";

describe("ProjectDictationVocabularyManager", () => {
  it("harvests canonical tech and symbol casing into the project vocabulary", () => {
    const manager = createProjectDictationVocabularyManager({
      clock: fixedClock,
      symbols: {
        listSymbolNames: () => [
          { term: "postgresql", kind: "library" },
          { term: "playwright", kind: "library" },
          { term: "supabase", kind: "library" },
          { term: "mailpit", kind: "library" },
          { term: "stripe", kind: "library" },
          { term: "MenuItem", kind: "symbol" },
        ],
      },
    });
    const report = manager.harvest("kitchen");
    expect(report.inserted).toEqual(["PostgreSQL", "Playwright", "Supabase", "Mailpit", "Stripe", "MenuItem"]);
    const prompt = manager.buildPrompt("kitchen");
    for (const term of ["PostgreSQL", "Playwright", "Supabase", "Mailpit", "Stripe", "MenuItem"]) {
      expect(prompt.text).toContain(term);
    }
    expect(prompt.carryInitialPrompt).toBe(true);
  });

  it("keeps project brands isolated until they are promoted to global", () => {
    const seen: string[] = [];
    const manager = createProjectDictationVocabularyManager({
      clock: fixedClock,
      whisper: {
        applyCarryInitialPrompt(prompt) {
          seen.push(prompt.text);
        },
      },
    });
    manager.addManualTerm({ projectId: "kitchen", term: "GahtoriKitchen" });
    manager.addManualTerm({ projectId: "kitchen", term: "CateringBatch" });
    manager.addManualTerm({ projectId: "expense", term: "ExpenseCli" });
    manager.addManualTerm({ projectId: GLOBAL_PROJECT_ID, term: "PostgreSQL" });
    const expense = manager.buildPrompt("expense");
    expect(expense.text).toContain("ExpenseCli");
    expect(expense.text).toContain("PostgreSQL");
    expect(expense.text).not.toContain("GahtoriKitchen");
    expect(expense.text).not.toContain("CateringBatch");
    expect(seen.at(-1)).toBe(expense.text);

    manager.promoteToGlobal({ projectId: "kitchen", term: "GahtoriKitchen" });
    const shared = manager.buildPrompt("expense");
    expect(shared.text).toContain("GahtoriKitchen");
    const listed = manager.list("expense").map((item) => `${item.scope}:${item.term}`);
    expect(listed).toContain("project:ExpenseCli");
    expect(listed).toContain("global:PostgreSQL");
    expect(listed).toContain("global:GahtoriKitchen");
    expect(listed.join(" ")).not.toContain("CateringBatch");
  });

  it("exposes list, add, remove, reset, and focus re-ranking", () => {
    const manager = createProjectDictationVocabularyManager({
      clock: fixedClock,
      canvas: {
        describeBox: (_projectId, boxId) => {
          if (boxId === "entity:DietaryTag") {
            return { terms: ["DietaryTag"], neighborTerms: ["Allergen"] };
          }
          if (boxId === "feature:CateringEmail") {
            return { terms: ["CateringEmail"], neighborTerms: ["MenuItem"] };
          }
          return null;
        },
      },
      symbols: {
        listSymbolNames: () => Array.from({ length: 180 }, (_, index) => ({
          term: `Sym${String(index).padStart(3, "0")}abcdefghij`,
          kind: "symbol" as const,
        })),
      },
    });
    manager.harvest("kitchen");
    const added = manager.addManualTerm({ projectId: "kitchen", term: "tRPC" });
    expect(added.term).toBe("tRPC");
    expect(added.source).toBe("user_manual");
    manager.focusCanvasBox("kitchen", "entity:DietaryTag");
    const dietary = manager.buildPrompt("kitchen");
    expect(dietary.tokenCount).toBeLessThanOrEqual(WHISPER_PROMPT_TOKEN_LIMIT);
    expect(dietary.terms.at(-1)).toBe("DietaryTag");
    expect(dietary.terms.at(-2)).toBe("Allergen");
    expect(dietary.args[2]).toBe("--carry-initial-prompt");

    manager.focusCanvasBox("kitchen", "feature:CateringEmail");
    const catering = manager.buildPrompt("kitchen");
    expect(catering.terms.at(-1)).toBe("CateringEmail");
    expect(catering.terms.at(-2)).toBe("MenuItem");

    manager.clearFocus("kitchen");
    manager.noteRecentlyEdited("kitchen", ["tRPC"]);
    expect(manager.buildPrompt("kitchen").terms.at(-1)).toBe("tRPC");

    const removed = manager.removeTerm({ projectId: "kitchen", term: "tRPC" });
    expect(removed?.suppressed).toBe(true);
    expect(manager.buildPrompt("kitchen").text).not.toContain("tRPC");
    manager.harvest("kitchen");
    expect(manager.store.get("kitchen", "tRPC")?.suppressed).toBe(true);

    manager.learner.observeCorrection({
      projectId: "kitchen",
      heard: "super base",
      corrected: "Supabase",
      occurrenceId: "1",
    });
    manager.learner.observeCorrection({
      projectId: "kitchen",
      heard: "super base",
      corrected: "Supabase",
      occurrenceId: "2",
    });
    const normalized = manager.normalizeTranscript("kitchen", "ship super base");
    expect(normalized.text).toBe("ship Supabase");
    expect(normalized.tooltips).toEqual(["Auto-corrected from 'super base' · Undo"]);
    expect(normalized.undoCorrection(normalized.spans[0]?.id ?? "").text).toBe("ship super base");

    manager.resetLearnedCorrections("kitchen");
    expect(manager.store.get("kitchen", "Supabase")).toBeNull();
    expect(manager.normalizeTranscript("kitchen", "ship super base").text).toBe("ship super base");
    expect(manager.list("kitchen").some((item) => item.term === "tRPC" && item.suppressed)).toBe(true);
  });

  it("runs learning and spoken-id normalization inside the 5 ms budget", () => {
    warmWhisperBpe();
    const catalog = new MemoryProjectStateCatalog();
    catalog.add("kitchen", "rule", "R17");
    catalog.add("kitchen", "task", "T-42");
    const manager = createProjectDictationVocabularyManager({ clock: fixedClock, catalog });
    manager.learner.observeCorrection({
      projectId: "kitchen",
      heard: "post grass",
      corrected: "Postgres",
      occurrenceId: "warm",
    });
    manager.learner.observeCorrection({
      projectId: "kitchen",
      heard: "post grass",
      corrected: "Postgres",
      occurrenceId: "hot",
    });
    let bestMs = Number.POSITIVE_INFINITY;
    let spoken = manager.spokenIds.normalize("kitchen", "change rule seventeen and task forty two");
    let corrected = manager.learner.apply("kitchen", "use post grass today");
    for (let run = 0; run < 7; run += 1) {
      const started = performance.now();
      spoken = manager.spokenIds.normalize("kitchen", "change rule seventeen and task forty two");
      corrected = manager.learner.apply("kitchen", "use post grass today");
      bestMs = Math.min(bestMs, performance.now() - started);
    }
    expect(spoken.text).toBe("change R17 and T-42");
    expect(corrected.text).toBe("use Postgres today");
    expect(bestMs).toBeLessThan(VOCABULARY_PIPELINE_BUDGET_MS);
  });
});

describe("frozen global.db vocabulary adapter", () => {
  it("round-trips logical rows onto GlobalBrokerDb vocabulary columns and sidecar", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dictation-vocab-"));
    const identity = { pid: 158, processStartTime: 1, hostname: "dictation-test" };
    const original: VocabularyEntry = entry({
      term: "Postgres",
      project_id: "kitchen",
      source: "user_correction",
      weight: 800,
      correction_from: "post grass",
      occurrence_count: 2,
      occurrence_ids: ["a", "b"],
      suppressed: true,
    });
    try {
      const first = GlobalBrokerDb.open({ root, identity, now: () => 1_700_000_000_000 });
      const driver = new GlobalBrokerVocabularyDriver(first);
      const store = new FrozenGlobalVocabularyStore(driver);
      store.upsert(original);
      const frozen = driver.listVocabulary()[0];
      expect(frozen?.source).toBe("correction");
      expect(frozen?.project).toBe("kitchen");
      expect(frozen?.heard_as).toBe("post grass");
      expect(frozen?.hits).toBe(2);
      expect(frozen?.weight).toBe(800);
      first.close();

      const reopened = GlobalBrokerDb.open({ root, identity, now: () => 1_700_000_001_000 });
      const loaded = new FrozenGlobalVocabularyStore(new GlobalBrokerVocabularyDriver(reopened)).get(
        "kitchen",
        "Postgres",
      );
      reopened.close();
      expect(loaded?.source).toBe("user_correction");
      expect(loaded?.suppressed).toBe(true);
      expect(loaded?.occurrence_ids).toEqual(["a", "b"]);
      expect(loaded?.correction_from).toBe("post grass");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
