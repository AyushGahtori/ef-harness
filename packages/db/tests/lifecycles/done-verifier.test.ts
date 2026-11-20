import { afterEach, describe, expect, it } from "vitest";
import { FeatureDoneRefusedError } from "../../src/lifecycles/index.js";
import {
  bumpNodeVersion,
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
import type { FeatureDoneConditionId, FeatureDoneEvidenceInput } from "../../src/lifecycles/index.js";

let handle: HarnessHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

function refuse(evidence: FeatureDoneEvidenceInput, condition: FeatureDoneConditionId): void {
  const result = handle.repo.verifyFeatureDoneConditions(evidence);
  expect(result.ok).toBe(false);
  expect(result.failedConditions).toEqual([condition]);
  expect(() =>
    handle.repo.transitionFeatureState({
      feature: evidence.feature,
      to: "DONE",
      expectedEpoch: 1,
      rev: 9,
      now: 9,
      evidence,
    }),
  ).toThrow(FeatureDoneRefusedError);
  expect(readFeatureState(handle.db, evidence.feature).state).toBe("MERGED");
  expect(countEvent(handle.db, "FeatureCompleted")).toBe(0);
}

describe("verifyFeatureDoneConditions", () => {
  it("refuses DONE when a task is still ACCEPTED", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db);
    handle.db.prepare(`UPDATE task_runtime SET state = 'ACCEPTED' WHERE task = ?`).run(ids.leaf);
    refuse(passingEvidence(ids.feature), "1");
  });

  it("refuses DONE when the accepted brief or a consumed contract is not current", () => {
    handle = openLifecycle();
    const staleBrief = seedGreenFeature(handle.db, { feature: "FB" });
    bumpNodeVersion(handle.db, staleBrief.leaf);
    refuse(passingEvidence("FB"), "1");

    handle.close();
    handle = openLifecycle();
    const staleContract = seedGreenFeature(handle.db, { feature: "FC" });
    bumpNodeVersion(handle.db, staleContract.contract);
    refuse(passingEvidence("FC"), "1");

    handle.close();
    handle = openLifecycle();
    const unpinned = seedGreenFeature(handle.db, { feature: "FU" });
    insertNode(handle.db, "FU2", "contract", { feature: "FU" });
    insertEdge(handle.db, unpinned.leaf, "consumes_contract", "FU2", null);
    refuse(passingEvidence("FU"), "1");
    handle.db
      .prepare(`INSERT INTO read_sets(attempt, node, version, hash, how) VALUES (?, 'FU2', 1, 'h', 'pulled')`)
      .run(unpinned.attempt);
    expect(handle.repo.verifyFeatureDoneConditions(passingEvidence("FU")).failedConditions).not.toContain("1");
  });

  it("refuses DONE when the latest check at the current version is not a pass", () => {
    handle = openLifecycle();
    const stale = seedGreenFeature(handle.db, { feature: "FS" });
    bumpNodeVersion(handle.db, stale.specCheck);
    const staleResult = handle.repo.verifyFeatureDoneConditions(passingEvidence("FS"));
    expect(staleResult.failedConditions).toEqual(["2"]);
    expect(staleResult.failingRequirements).toEqual([stale.spec]);

    for (const status of ["fail", "skip", "missing"] as const) {
      handle.close();
      handle = openLifecycle();
      const ids = seedGreenFeature(handle.db, { feature: `F${status}` });
      handle.db.prepare(`UPDATE check_results SET status = ? WHERE check_id = ?`).run(status, ids.specCheck);
      refuse(passingEvidence(ids.feature), "2");
    }
  });

  it("accepts an approved waiver in place of a failing check", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db);
    handle.db.prepare(`UPDATE check_results SET status = 'fail' WHERE check_id = ?`).run(ids.specCheck);
    expect(handle.repo.verifyFeatureDoneConditions(passingEvidence()).failedConditions).toEqual(["2"]);
    insertNode(handle.db, "W1", "waiver", {
      feature: ids.feature,
      reason: "developer approved",
      approved_by: "developer",
      risk_max: "low",
    });
    insertEdge(handle.db, "W1", "waives", ids.spec);
    expect(handle.repo.verifyFeatureDoneConditions(passingEvidence()).ok).toBe(true);
  });

  it("refuses DONE when the static audit is not clean", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db);
    const evidence = passingEvidence(ids.feature);
    refuse(
      { ...evidence, staticAudit: { ...evidence.staticAudit, clean: false } },
      "3",
    );
  });

  it("refuses DONE when the feature journey did not pass in a clean environment", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db);
    const evidence = passingEvidence(ids.feature);
    refuse({ ...evidence, journey: { ...evidence.journey, passed: false } }, "4");
  });

  it("refuses DONE unless earlier DONE features are in the green regression set on harness/integration", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db);
    insertNode(handle.db, "F0", "feature", { feature: "F0" });
    insertFeatureRuntime(handle.db, "F0", "DONE", 1);
    const evidence = passingEvidence(ids.feature, []);
    refuse(evidence, "5");
    const wrongRef = passingEvidence(ids.feature, ["F0"]);
    refuse(
      {
        ...wrongRef,
        integrationMerge: { ...wrongRef.integrationMerge, ref: "refs/heads/main" },
      },
      "5",
    );
  });

  it("refuses DONE when a screen-bearing feature has a serious accessibility or layout finding", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db, { screenBearing: true });
    const evidence = passingEvidence(ids.feature);
    refuse(
      { ...evidence, accessibility: { seriousFindingIds: ["A11Y-1"] } },
      "6",
    );
    const clean = handle.repo.verifyFeatureDoneConditions(evidence);
    expect(clean.ok).toBe(true);
    expect(clean.failedConditions).toEqual([]);
  });

  it("refuses DONE while an open CCR originates from or targets the feature and returns those ids", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db);
    insertNode(handle.db, "CCR-14", "ccr", {
      from_feature: ids.feature,
      target: "entity:orders",
      status: "open",
    });
    insertNode(handle.db, "CCR-15", "ccr", {
      from_feature: "F9",
      to_feature: ids.feature,
      target: "entity:orders",
      status: "open",
    });
    insertNode(handle.db, "CCR-OTHER", "ccr", {
      from_feature: "F9",
      target: "entity:orders",
      status: "open",
    });
    const result = handle.repo.verifyFeatureDoneConditions(passingEvidence(ids.feature));
    expect(result.failedConditions).toEqual(["7"]);
    expect(result.blockingCcrIds).toEqual(["CCR-14", "CCR-15"]);
    expect(() =>
      handle.repo.transitionFeatureState({
        feature: ids.feature,
        to: "DONE",
        expectedEpoch: 1,
        rev: 9,
        now: 9,
        evidence: passingEvidence(ids.feature),
      }),
    ).toThrow(FeatureDoneRefusedError);
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(0);
  });

  it("emits FeatureCompleted only after every condition passes inside the same transition", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db);
    insertNode(handle.db, "F0", "feature", { feature: "F0" });
    insertFeatureRuntime(handle.db, "F0", "DONE", 2);
    const evidence = passingEvidence(ids.feature, ["F0"]);
    expect(handle.repo.verifyFeatureDoneConditions(evidence)).toEqual({
      ok: true,
      failedConditions: [],
      blockingCcrIds: [],
      failingRequirements: [],
    });
    const done = handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "DONE",
      expectedEpoch: 1,
      rev: 8,
      now: 8,
      evidence,
    });
    expect(done.to).toBe("DONE");
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(1);
    expect(countEvent(handle.db, "FeatureStateChanged")).toBe(1);
  });

  it("refuses DONE for a feature with zero tasks", () => {
    handle = openLifecycle();
    insertNode(handle.db, "FE", "feature", { feature: "FE", screen_bearing: false });
    insertFeatureRuntime(handle.db, "FE", "MERGED", 1);
    const evidence = passingEvidence("FE");
    const result = handle.repo.verifyFeatureDoneConditions({
      ...evidence,
      staticAudit: { ...evidence.staticAudit, paths: ["src/app/FE/"] },
    });
    expect(result.ok).toBe(false);
    expect(result.failedConditions).toContain("1");
    expect(() =>
      handle.repo.transitionFeatureState({
        feature: "FE",
        to: "DONE",
        expectedEpoch: 1,
        rev: 4,
        now: 4,
        evidence,
      }),
    ).toThrow(FeatureDoneRefusedError);
    expect(readFeatureState(handle.db, "FE").state).toBe("MERGED");
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(0);
  });
});
