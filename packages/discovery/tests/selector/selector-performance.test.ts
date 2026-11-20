import { describe, expect, it } from "vitest";
import {
  GreedyQuestionSelector,
  selectNextBatch,
  unblockerIds,
  type CatalogQuestion,
  type CriterionState,
} from "../../src/selector/index.js";

describe("selector performance", () => {
  it("selects a batch from 500 questions and 1000 criteria in under 5 ms", () => {
    const criteria: CriterionState[] = [];
    for (let index = 0; index < 1000; index += 1) {
      criteria.push({
        id: `c${index}`,
        decisionId: `d${index}`,
        label: `choice ${index}`,
        status: "open",
        mustAsk: false,
        scope: "leaf",
        askCount: 0,
        lastAskedTurn: null,
        skipCount: 0,
        ambiguous: false,
        requiresSettled: [],
      });
    }
    const catalog: CatalogQuestion[] = [];
    for (let index = 0; index < 500; index += 1) {
      const targets: string[] = [];
      for (let offset = 0; offset < 4; offset += 1) {
        targets.push(`c${(index * 4 + offset) % 1000}`);
      }
      catalog.push({
        id: `q${index}`,
        text: "Which option should we use?",
        options: [
          { id: "yes", label: "Yes", recommended: true },
          { id: "no", label: "No", recommended: false },
        ],
        targetCriteria: targets,
        requiresSettled: [],
        touches: ["interactive_ui"],
        catalogPriority: index,
        complex: false,
        conflictResolution: false,
        mustAsk: false,
        bundleGroup: null,
        whyAsking: "Decides the next product choice.",
        projectLocal: false,
      });
    }
    const input = {
      workItemId: "work-stress",
      scopeRev: 1,
      batchId: "batch-stress",
      catalogVersion: "stress-1",
      criteria,
      catalog,
      turn: 1,
      createdAt: 1,
      lastOptionsVersion: 0,
      projectLocalCount: 0,
      targetSize: 4,
    };
    expect(criteria).toHaveLength(1000);
    expect(catalog).toHaveLength(500);
    const selector = new GreedyQuestionSelector();
    const unblockers = unblockerIds(catalog, criteria);
    const covered = new Set<string>();
    const skipped = new Set<string>();
    const greedyInput = {
      candidates: catalog,
      downstreamCatalog: catalog,
      criteria,
      unblockers,
      targetSize: 4,
      initialCovered: covered,
      skipQuestionIds: skipped,
      usedPrimaries: covered,
      allowComplex: true,
    };
    for (let warmup = 0; warmup < 4; warmup += 1) selector.select(greedyInput);
    const samples: number[] = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const started = performance.now();
      const picks = selector.select(greedyInput);
      samples.push(performance.now() - started);
      expect(picks.length).toBeGreaterThan(0);
      expect(picks.length).toBeLessThanOrEqual(4);
    }
    samples.sort((left, right) => left - right);
    const median = samples[2] ?? samples[0] ?? 0;
    expect(median).toBeLessThan(5);

    const batch = selectNextBatch(input);
    expect(batch.batch.snapshot.length).toBeGreaterThan(0);
    expect(batch.batch.snapshot.length).toBeLessThanOrEqual(4);
  });
});
