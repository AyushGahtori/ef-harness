import { afterEach, describe, expect, it } from "vitest";
import {
  IllegalProjectTransitionError,
  PROJECT_STATES,
  ProjectCompletionBlockedError,
} from "../../src/lifecycles/index.js";
import {
  insertChangeSet,
  insertEdge,
  insertFeatureRuntime,
  insertNode,
  listOutbox,
  openLifecycle,
  readFeatureState,
  readProject,
  seedGreenFeature,
  type HarnessHandle,
} from "./fixture.js";

let handle: HarnessHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

describe("project lifecycle", () => {
  it("walks all 10 states and keeps paused orthogonal to the phase and wave", () => {
    handle = openLifecycle();
    expect(() =>
      handle.repo.transitionProjectState({ to: "WAVES", rev: 1, now: 1, currentWave: 1 }),
    ).toThrow(IllegalProjectTransitionError);
    expect(readProject(handle.db)).toMatchObject({ state: "DISCOVERY", paused: 0, currentWave: null });

    const seen: string[] = ["DISCOVERY"];
    const next = PROJECT_STATES.slice(1);
    let rev = 1;
    for (const to of next) {
      if (to === "PHASE0") {
        handle.repo.transitionProjectState({ to, rev, now: rev });
        seen.push(to);
        const paused = handle.repo.setProjectPaused({ paused: 1, rev: rev + 1, now: rev + 1 });
        expect(paused).toMatchObject({ changed: true, state: "PHASE0", currentWave: null, paused: 1 });
        expect(readProject(handle.db)).toMatchObject({ state: "PHASE0", currentWave: null, paused: 1 });
        handle.repo.setProjectPaused({ paused: 0, rev: rev + 2, now: rev + 2 });
        expect(readProject(handle.db)).toMatchObject({ state: "PHASE0", currentWave: null, paused: 0 });
        rev += 3;
        continue;
      }
      if (to === "WAVES") {
        handle.repo.transitionProjectState({ to, rev, now: rev, currentWave: 2 });
        seen.push(to);
        handle.repo.setProjectPaused({ paused: 1, rev: rev + 1, now: rev + 1 });
        expect(readProject(handle.db)).toMatchObject({ state: "WAVES", currentWave: 2, paused: 1 });
        const again = handle.repo.setProjectPaused({ paused: 1, rev: rev + 2, now: rev + 2 });
        expect(again.changed).toBe(false);
        expect(readProject(handle.db).updatedRev).toBe(rev + 1);
        handle.repo.setProjectPaused({ paused: 0, rev: rev + 3, now: rev + 3 });
        expect(readProject(handle.db)).toMatchObject({ state: "WAVES", currentWave: 2, paused: 0 });
        rev += 4;
        continue;
      }
      const result = handle.repo.transitionProjectState({ to, rev, now: rev });
      expect(result).toMatchObject({ to, paused: 0 });
      if (seen.includes("WAVES")) {
        expect(result.currentWave).toBe(2);
      }
      seen.push(to);
      rev += 1;
    }
    expect(seen).toEqual([...PROJECT_STATES]);
    expect(readProject(handle.db).state).toBe("SHIPPING");
    const pauseEvents = listOutbox(handle.db).filter((event) => event.type === "ProjectPausedChanged");
    expect(pauseEvents.map((event) => event.payload.paused)).toEqual([1, 0, 1, 0]);
    for (const event of pauseEvents) {
      expect(event.consumers).toEqual(["exporter", "scheduler", "ui_projection"]);
    }
  });

  it("excludes approved and decoupled DEFERRED and ABANDONED features from COMPLETION blockers", () => {
    handle = openLifecycle();
    for (const to of ["SPEC_COMPLETE", "UPFRONT_DOCS", "PREVIEW", "PHASE0"] as const) {
      handle.repo.transitionProjectState({ to, rev: 1, now: 1 });
    }
    handle.repo.transitionProjectState({ to: "WAVES", rev: 1, now: 1, currentWave: 2 });

    insertNode(handle.db, "FACT", "feature", { feature: "FACT" });
    insertFeatureRuntime(handle.db, "FACT", "IN_WAVE", 1);
    expect(() => handle.repo.transitionProjectState({ to: "COMPLETION", rev: 2, now: 2 })).toThrow(
      ProjectCompletionBlockedError,
    );
    expect(readProject(handle.db).state).toBe("WAVES");

    insertNode(handle.db, "FDEP", "feature", { feature: "FDEP" });
    insertFeatureRuntime(handle.db, "FDEP", "PLANNED", 0);
    insertEdge(handle.db, "FACT", "depends_on", "FDEP");
    expect(() =>
      handle.repo.transitionFeatureState({
        feature: "FDEP",
        to: "DEFERRED",
        expectedEpoch: 0,
        rev: 3,
        now: 3,
        approved: true,
      }),
    ).toThrow();
    handle.db.prepare(`DELETE FROM edges WHERE src = 'FACT' AND dst = 'FDEP'`).run();
    handle.repo.transitionFeatureState({
      feature: "FDEP",
      to: "DEFERRED",
      expectedEpoch: 0,
      rev: 3,
      now: 3,
      approved: true,
    });
    expect(readFeatureState(handle.db, "FDEP").state).toBe("DEFERRED");

    insertEdge(handle.db, "FACT", "depends_on", "FDEP");
    try {
      handle.repo.transitionProjectState({ to: "COMPLETION", rev: 4, now: 4 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectCompletionBlockedError);
      const blockers = (error as ProjectCompletionBlockedError).blockers;
      expect(blockers).toEqual([
        { feature: "FACT", state: "IN_WAVE", reason: "active" },
        { feature: "FDEP", state: "DEFERRED", reason: "coupled" },
      ]);
    }
    handle.db.prepare(`DELETE FROM edges WHERE src = 'FACT' AND dst = 'FDEP'`).run();
    handle.db.prepare(`UPDATE feature_runtime SET state = 'DONE' WHERE feature = 'FACT'`).run();

    insertNode(handle.db, "FAB", "feature", { feature: "FAB" });
    handle.repo.initFeature({ feature: "FAB", planAuthor: "planner", rev: 5, now: 5 });
    handle.repo.transitionFeatureState({
      feature: "FAB",
      to: "ABANDONED",
      expectedEpoch: 0,
      rev: 6,
      now: 6,
      approved: true,
    });
    const done = handle.repo.transitionProjectState({ to: "COMPLETION", rev: 7, now: 7 });
    expect(done).toMatchObject({ from: "WAVES", to: "COMPLETION", currentWave: 2, paused: 0 });
  });

  it("does not treat a raw DEFERRED row without an approval event as excluded", () => {
    handle = openLifecycle();
    for (const to of ["SPEC_COMPLETE", "UPFRONT_DOCS", "PREVIEW", "PHASE0"] as const) {
      handle.repo.transitionProjectState({ to, rev: 1, now: 1 });
    }
    handle.repo.transitionProjectState({ to: "WAVES", rev: 1, now: 1, currentWave: 1 });
    insertNode(handle.db, "FRAW", "feature", { feature: "FRAW" });
    insertFeatureRuntime(handle.db, "FRAW", "DEFERRED", 1);
    try {
      handle.repo.transitionProjectState({ to: "COMPLETION", rev: 2, now: 2 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectCompletionBlockedError);
      expect((error as ProjectCompletionBlockedError).blockers).toEqual([
        { feature: "FRAW", state: "DEFERRED", reason: "not_approved" },
      ]);
    }
    expect(readProject(handle.db)).toMatchObject({ state: "WAVES", currentWave: 1 });
  });
});

describe("reopen holds downstream features", () => {
  it("moves a DONE or MERGED feature to REOPENED, records the change set, and holds dependents", () => {
    handle = openLifecycle();
    insertChangeSet(handle.db, "CS-REV", 4);
    seedGreenFeature(handle.db, { feature: "F1", runtimeState: "DONE", epoch: 3 });
    insertNode(handle.db, "F2", "feature", { feature: "F2" });
    insertFeatureRuntime(handle.db, "F2", "IN_WAVE", 1);
    insertNode(handle.db, "T2", "task", { feature: "F2", task_type: "leaf" });
    handle.db
      .prepare(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
         VALUES ('T2', 'F2', 'READY', 'Mid', 1, 1)`,
      )
      .run();
    insertNode(handle.db, "F3", "feature", { feature: "F3" });
    insertFeatureRuntime(handle.db, "F3", "PLANNED", 0);
    insertNode(handle.db, "F4", "feature", { feature: "F4" });
    insertFeatureRuntime(handle.db, "F4", "DONE", 2);
    insertEdge(handle.db, "F2", "depends_on", "F1");
    insertEdge(handle.db, "F3", "depends_on", "F2");
    insertEdge(handle.db, "F4", "depends_on", "F1");

    expect(() =>
      handle.repo.transitionFeatureState({
        feature: "F1",
        to: "REOPENED",
        expectedEpoch: 2,
        rev: 5,
        now: 5,
        changeSetId: "CS-REV",
      }),
    ).toThrow();
    expect(readFeatureState(handle.db, "F1").state).toBe("DONE");

    const reopened = handle.repo.transitionFeatureState({
      feature: "F1",
      to: "REOPENED",
      expectedEpoch: 3,
      rev: 5,
      now: 5,
      changeSetId: "CS-REV",
    });
    expect(reopened).toMatchObject({ from: "DONE", to: "REOPENED", epoch: 4 });
    expect(reopened.heldDownstream).toEqual(["F2", "F3", "F4"]);
    expect(readFeatureState(handle.db, "F2").state).toBe("BLOCKED");
    expect(readFeatureState(handle.db, "F3").state).toBe("PLANNED");
    expect(readFeatureState(handle.db, "F4")).toMatchObject({ state: "REOPENED", epoch: 3 });
    const hold = handle.db
      .prepare(`SELECT reason, source FROM task_holds WHERE task = 'T2'`)
      .get() as { reason: string; source: string };
    expect(hold).toEqual({ reason: "requirement_change", source: "CS-REV" });
    const primary = listOutbox(handle.db).find((event) => event.subject === "F1" && event.payload.to === "REOPENED");
    expect(primary?.payload.changeSetId).toBe("CS-REV");
    expect(primary?.payload.heldDownstream).toEqual(["F2", "F3", "F4"]);
  });
});
