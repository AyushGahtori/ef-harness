import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GlobalBrokerDb } from "@ef-harness/db";
import { describe, expect, it } from "vitest";
import { FrozenGlobalVocabularyStore, GlobalBrokerVocabularyDriver } from "../../src/vocabulary/index.js";
import { MemoryProjectStateCatalog } from "../../src/vocabulary/memory-store.js";
import { createDictationVocabularyPipeline } from "../../src/stt/vocabulary-pipeline.js";
import { createSession, speechPcm, words } from "./support.js";

describe("LocalWhisperSttEngine vocabulary pipeline", () => {
  it("builds the prompt, applies learned corrections and spoken ids, and reloads GlobalBrokerDb", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dictation-pipeline-"));
    const identity = { pid: 157, processStartTime: 1, hostname: "dictation-pipeline" };
    const catalog = new MemoryProjectStateCatalog();
    catalog.add("kitchen", "rule", "R17");
    try {
      const db = GlobalBrokerDb.open({ root, identity, now: () => 1_700_000_000_000 });
      const store = new FrozenGlobalVocabularyStore(new GlobalBrokerVocabularyDriver(db));
      store.upsert({
        term: "Stripe",
        project_id: "kitchen",
        weight: 900,
        source: "tech_stack",
        correction_from: null,
        heard_forms: [],
        occurrence_count: 0,
        occurrence_ids: [],
        last_used_at: 1_700_000_000_000,
        suppressed: false,
      });
      const pipeline = createDictationVocabularyPipeline({
        projectId: "kitchen",
        store,
        catalog,
        clock: { now: () => 1_700_000_000_000 },
      });
      pipeline.learner.observeCorrection({
        projectId: "kitchen",
        heard: "post grass",
        corrected: "Postgres",
        occurrenceId: "one",
      });
      pipeline.learner.observeCorrection({
        projectId: "kitchen",
        heard: "post grass",
        corrected: "Postgres",
        occurrenceId: "two",
      });
      const { engine, decoder } = createSession({ pipeline });
      decoder.queue(words("use post grass and rule seventeen"));
      await engine.start();
      const args = engine.snapshot().whisperArgs ?? [];
      expect(args).toContain("--carry-initial-prompt");
      expect(args.some((arg) => arg.includes("Stripe"))).toBe(true);
      expect(engine.snapshot().gpuHeld).toBe(true);
      engine.pushPcm(speechPcm());
      expect(engine.snapshot().fullText).toBe("use Postgres and R17");
      db.close();

      const reopened = GlobalBrokerDb.open({ root, identity, now: () => 1_700_000_002_000 });
      const again = new FrozenGlobalVocabularyStore(new GlobalBrokerVocabularyDriver(reopened));
      expect(again.get("kitchen", "Stripe")?.source).toBe("tech_stack");
      expect(again.get("kitchen", "Postgres")?.occurrence_count).toBe(2);
      reopened.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
