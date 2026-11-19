import { afterEach, describe, expect, it } from "vitest";
import { FeatureDoneRefusedError, FOUNDATION_GATE_META_KEY, StaleEpochError } from "../../src/lifecycles/index.js";
import {
  countEvent,
  insertEdge,
  insertFeatureRuntime,
  insertNode,
  openLifecycle,
  passingEvidence,
  readFeatureState,
  seedGreenFeature,
  type HarnessHandle,
} from "./fixture.js";

let handle: HarnessHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

describe("integration holder epoch", () => {
  it("bumps epoch on takeover and rejects a stale integrator, including DONE", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db, { epoch: 0 });
    const transferred = handle.repo.transferIntegrationHolder({
      feature: ids.feature,
      nextHolder: "successor",
      expectedEpoch: 0,
      rev: 2,
      now: 2,
    });
    expect(transferred).toMatchObject({
      previousHolder: "author",
      integrationHolder: "successor",
      epoch: 1,
      state: "MERGED",
    });
    expect(() =>
      handle.repo.transitionFeatureState({
        feature: ids.feature,
        to: "DONE",
        expectedEpoch: 0,
        rev: 3,
        now: 3,
        evidence: passingEvidence(ids.feature),
      }),
    ).toThrow(StaleEpochError);
    expect(readFeatureState(handle.db, ids.feature)).toMatchObject({ state: "MERGED", epoch: 1, holder: "successor" });
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(0);

    expect(() =>
      handle.repo.transitionFeatureState({
        feature: ids.feature,
        to: "DONE",
        expectedEpoch: 1,
        rev: 4,
        now: 4,
        evidence: {
          ...passingEvidence(ids.feature),
          journey: { passed: false, entryPoint: "/app", cleanEnvironment: true },
        },
      }),
    ).toThrow(FeatureDoneRefusedError);
    expect(readFeatureState(handle.db, ids.feature).state).toBe("MERGED");

    const done = handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "DONE",
      expectedEpoch: 1,
      rev: 5,
      now: 5,
      evidence: passingEvidence(ids.feature),
    });
    expect(done).toMatchObject({ to: "DONE", epoch: 1, integrationHolder: "successor" });
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(1);

    expect(() =>
      handle.repo.advanceFeatureLeavesMerged({
        feature: ids.feature,
        expectedEpoch: 0,
        rev: 6,
        now: 6,
      }),
    ).toThrow(StaleEpochError);
  });
});

describe("listUnlockableFeatures", () => {
  it("returns PLANNED and JIT_READY features only after upstream features are DONE and the foundation gate has passed", () => {
    handle = openLifecycle();
    insertNode(handle.db, "UP", "feature", { feature: "UP" });
    insertFeatureRuntime(handle.db, "UP", "MERGED", 1);
    insertNode(handle.db, "DOWN", "feature", { feature: "DOWN" });
    insertFeatureRuntime(handle.db, "DOWN", "PLANNED", 0);
    insertNode(handle.db, "READY", "feature", { feature: "READY" });
    insertFeatureRuntime(handle.db, "READY", "JIT_READY", 0);
    insertNode(handle.db, "BUSY", "feature", { feature: "BUSY" });
    insertFeatureRuntime(handle.db, "BUSY", "IN_WAVE", 1);
    insertEdge(handle.db, "DOWN", "depends_on", "UP");
    insertEdge(handle.db, "BUSY", "depends_on", "UP");

    expect(handle.repo.listUnlockableFeatures()).toEqual([]);
    handle.db.prepare(`UPDATE feature_runtime SET state = 'JOURNEY_PASSED' WHERE feature = 'UP'`).run();
    expect(handle.repo.listUnlockableFeatures()).toEqual([]);
    handle.db.prepare(`UPDATE feature_runtime SET state = 'DONE' WHERE feature = 'UP'`).run();
    expect(handle.repo.listUnlockableFeatures()).toEqual([]);

    handle.repo.transitionProjectState({ to: "SPEC_COMPLETE", rev: 1, now: 1 });
    handle.repo.transitionProjectState({ to: "UPFRONT_DOCS", rev: 1, now: 1 });
    handle.repo.transitionProjectState({ to: "PREVIEW", rev: 1, now: 1 });
    handle.repo.transitionProjectState({ to: "PHASE0", rev: 1, now: 1 });
    expect(handle.repo.listUnlockableFeatures()).toEqual([]);
    handle.db
      .prepare(`INSERT INTO meta(key, value) VALUES (?, 'passed')`)
      .run(FOUNDATION_GATE_META_KEY);
    expect(handle.repo.listUnlockableFeatures()).toEqual(["DOWN", "READY"]);
    handle.db.prepare(`DELETE FROM meta WHERE key = ?`).run(FOUNDATION_GATE_META_KEY);
    expect(handle.repo.listUnlockableFeatures()).toEqual([]);

    handle.repo.transitionProjectState({ to: "WAVES", rev: 2, now: 2, currentWave: 1 });
    expect(handle.repo.listUnlockableFeatures()).toEqual(["DOWN", "READY"]);
    handle.db.prepare(`UPDATE feature_runtime SET state = 'MERGED' WHERE feature = 'UP'`).run();
    expect(handle.repo.listUnlockableFeatures()).toEqual(["READY"]);
    handle.db.prepare(`UPDATE feature_runtime SET state = 'JOURNEY_PASSED' WHERE feature = 'UP'`).run();
    expect(handle.repo.listUnlockableFeatures()).toEqual(["READY"]);
    handle.db.prepare(`UPDATE feature_runtime SET state = 'DONE' WHERE feature = 'UP'`).run();
    expect(handle.repo.listUnlockableFeatures()).toEqual(["DOWN", "READY"]);
  });
});
