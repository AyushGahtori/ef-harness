import { afterEach, describe, expect, it } from "vitest";
import { countEvent, insertFeatureRuntime, insertNode, insertTask, listOutbox, openLifecycle, readFeatureState, type HarnessHandle } from "./fixture.js";

let handle: HarnessHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

function waveFeature(feature: string): void {
  insertNode(handle.db, feature, "feature", { feature });
  insertFeatureRuntime(handle.db, feature, "IN_WAVE", 1);
}

describe("advance_feature_leaves_merged", () => {
  it("refuses a feature with zero tasks and a feature whose only task is wiring", () => {
    handle = openLifecycle();
    waveFeature("F0");
    const empty = handle.repo.advanceFeatureLeavesMerged({
      feature: "F0",
      expectedEpoch: 1,
      rev: 2,
      now: 2,
    });
    expect(empty).toMatchObject({ ok: false, reason: "no_tasks", state: "IN_WAVE" });
    expect(readFeatureState(handle.db, "F0").state).toBe("IN_WAVE");

    waveFeature("FW");
    insertTask(handle.db, "FW-W", "FW", "DRAFTED", { task_type: "wiring" });
    const wiringOnly = handle.repo.advanceFeatureLeavesMerged({
      feature: "FW",
      expectedEpoch: 1,
      rev: 2,
      now: 2,
    });
    expect(wiringOnly).toMatchObject({ ok: false, reason: "no_leaves", state: "IN_WAVE" });
    expect(readFeatureState(handle.db, "FW").state).toBe("IN_WAVE");
    expect(countEvent(handle.db, "FeatureStateChanged")).toBe(0);
  });

  it("refuses while a leaf is ACCEPTED and advances when every leaf is merged even if wiring is DRAFTED", () => {
    handle = openLifecycle();
    waveFeature("FA");
    insertTask(handle.db, "FA-T", "FA", "ACCEPTED", {});
    insertTask(handle.db, "FA-W", "FA", "DRAFTED", { task_type: "wiring" });
    const refused = handle.repo.advanceFeatureLeavesMerged({
      feature: "FA",
      expectedEpoch: 1,
      rev: 3,
      now: 3,
    });
    expect(refused).toMatchObject({ ok: false, reason: "leaves_outstanding", state: "IN_WAVE" });
    expect(readFeatureState(handle.db, "FA").state).toBe("IN_WAVE");
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(0);

    handle.db.prepare(`UPDATE task_runtime SET state = 'MERGED_TO_FEATURE' WHERE task = 'FA-T'`).run();
    const advanced = handle.repo.advanceFeatureLeavesMerged({
      feature: "FA",
      expectedEpoch: 1,
      rev: 4,
      now: 4,
    });
    expect(advanced).toMatchObject({ ok: true, state: "LEAVES_MERGED", reason: "advanced", epoch: 1 });
    expect(readFeatureState(handle.db, "FA")).toMatchObject({ state: "LEAVES_MERGED", epoch: 1 });
    const wiring = handle.db.prepare(`SELECT state FROM task_runtime WHERE task = 'FA-W'`).get() as { state: string };
    expect(wiring.state).toBe("DRAFTED");
    const events = listOutbox(handle.db);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "FeatureStateChanged",
      subject: "FA",
      consumers: ["exporter", "scheduler", "ui_projection"],
    });
    expect(events[0]?.payload).toMatchObject({ from: "IN_WAVE", to: "LEAVES_MERGED" });
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(0);
  });

  it("treats CANCELLED and SUPERSEDED leaves as settled and refuses a feature that is not IN_WAVE", () => {
    handle = openLifecycle();
    waveFeature("FC");
    insertTask(handle.db, "FC-C", "FC", "CANCELLED", { task_type: "leaf" });
    insertTask(handle.db, "FC-S", "FC", "SUPERSEDED", {});
    const advanced = handle.repo.advanceFeatureLeavesMerged({
      feature: "FC",
      expectedEpoch: 1,
      rev: 2,
      now: 2,
    });
    expect(advanced.ok).toBe(true);

    insertNode(handle.db, "FP", "feature", { feature: "FP" });
    insertFeatureRuntime(handle.db, "FP", "PLANNED", 0);
    insertTask(handle.db, "FP-T", "FP", "MERGED_TO_FEATURE", { task_type: "leaf" });
    const early = handle.repo.advanceFeatureLeavesMerged({
      feature: "FP",
      expectedEpoch: 0,
      rev: 2,
      now: 2,
    });
    expect(early).toMatchObject({ ok: false, reason: "not_in_wave", state: "PLANNED" });
  });
});
