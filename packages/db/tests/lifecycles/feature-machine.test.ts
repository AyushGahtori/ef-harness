import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FEATURE_STATES,
  FEATURE_STATE_TRANSITIONS,
  IllegalFeatureTransitionError,
  PROJECT_STATES,
  canonicalStateSqlPath,
  isFeatureState,
  isLegalFeatureTransition,
  loadCanonicalQueries,
} from "../../src/lifecycles/index.js";
import {
  countEvent,
  insertChangeSet,
  listOutbox,
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

describe("feature lifecycle vocabulary", () => {
  it("matches the 13 feature states and 10 project states seeded in schema/state.sql", () => {
    const sql = readFileSync(canonicalStateSqlPath(), "utf8");
    const featureBody = insertBody(sql, "feature_states");
    const projectBody = insertBody(sql, "project_states");
    const featureRows = [...featureBody.matchAll(/\('([A-Z_]+)',\s*([01])\)/g)].map((match) => ({
      state: match[1] ?? "",
      terminal: match[2] === "1",
    }));
    const projectRows = [...projectBody.matchAll(/\('([A-Z0-9_]+)'\)/g)].map((match) => match[1] ?? "");
    expect(featureRows).toEqual(FEATURE_STATES.map((row) => ({ state: row.state, terminal: row.terminal })));
    expect(projectRows).toEqual([...PROJECT_STATES]);
    expect(FEATURE_STATES).toHaveLength(13);
    expect(PROJECT_STATES).toHaveLength(10);
  });

  it("rejects legacy completion spellings in the lifecycle sources and the state set", () => {
    const leaves = ["LEAVES", "ACCEPTED"].join("_");
    const featureDone = ["FEATURE", "DONE"].join("_");
    const complete = ["COMP", "LETE"].join("");
    expect(isFeatureState(leaves)).toBe(false);
    expect(isFeatureState(featureDone)).toBe(false);
    expect(isFeatureState(complete)).toBe(false);
    expect(isLegalFeatureTransition("IN_WAVE", "LEAVES_MERGED")).toBe(false);
    const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/lifecycles");
    const pattern = new RegExp(`\\b(?:${leaves}|${featureDone}|${complete})\\b`);
    for (const file of readdirSync(sourceDir)) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(path.join(sourceDir, file), "utf8");
      expect(pattern.test(text), file).toBe(false);
    }
  });
});

describe("feature state machine", () => {
  it("visits all 13 states and emits FeatureCompleted only when DONE is verified", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db, { insertRuntime: false, wiringState: "DRAFTED" });
    const seen = new Set<string>();
    const init = handle.repo.initFeature({
      feature: ids.feature,
      planAuthor: "planner",
      rev: 2,
      now: 2,
    });
    expect(init).toMatchObject({
      state: "PLANNED",
      epoch: 0,
      integrationHolder: "planner",
      branch: "harness/f/F1",
    });
    seen.add(init.state);

    const step = (to: "JIT_READY" | "IN_WAVE" | "WIRED" | "JOURNEY_PASSED" | "QUEUED_FOR_MERGE" | "MERGED") => {
      const result = handle.repo.transitionFeatureState({
        feature: ids.feature,
        to,
        expectedEpoch: 0,
        rev: 3,
        now: 3,
      });
      expect(result.to).toBe(to);
      seen.add(to);
    };
    step("JIT_READY");
    step("IN_WAVE");
    const advanced = handle.repo.advanceFeatureLeavesMerged({
      feature: ids.feature,
      expectedEpoch: 0,
      rev: 4,
      now: 4,
    });
    expect(advanced).toMatchObject({ ok: true, state: "LEAVES_MERGED", reason: "advanced" });
    seen.add("LEAVES_MERGED");
    handle.db.prepare(`UPDATE task_runtime SET state = 'CANCELLED' WHERE task = ?`).run(ids.wiring);
    step("WIRED");
    step("JOURNEY_PASSED");
    step("QUEUED_FOR_MERGE");
    step("MERGED");
    const done = handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "DONE",
      expectedEpoch: 0,
      rev: 5,
      now: 5,
      evidence: passingEvidence(ids.feature),
    });
    expect(done.to).toBe("DONE");
    seen.add("DONE");
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(1);
    insertChangeSet(handle.db, "CS-REV", 2);
    const reopened = handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "REOPENED",
      expectedEpoch: 0,
      rev: 6,
      now: 6,
      changeSetId: "CS-REV",
    });
    expect(reopened).toMatchObject({ from: "DONE", to: "REOPENED", epoch: 1 });
    seen.add("REOPENED");
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(1);

    for (const [id, to] of [
      ["FB", "BLOCKED"],
      ["FD", "DEFERRED"],
      ["FA", "ABANDONED"],
    ] as const) {
      seedGreenFeature(handle.db, { feature: id, insertRuntime: false });
      handle.repo.initFeature({ feature: id, planAuthor: "planner", rev: 7, now: 7 });
      handle.repo.transitionFeatureState({
        feature: id,
        to,
        expectedEpoch: 0,
        rev: 8,
        now: 8,
        approved: true,
      });
      seen.add(to);
    }

    expect([...seen].sort()).toEqual(FEATURE_STATES.map((row) => row.state).sort());
    for (const event of listOutbox(handle.db)) {
      expect(event.consumers).toEqual(["exporter", "scheduler", "ui_projection"]);
    }
    const completed = listOutbox(handle.db).filter((event) => event.type === "FeatureCompleted");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.payload.feature).toBe(ids.feature);
  });

  it("refuses edges that are not in the graph, including a direct jump to LEAVES_MERGED", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db, { insertRuntime: false, wiringState: "DRAFTED" });
    handle.repo.initFeature({ feature: ids.feature, planAuthor: "planner", rev: 2, now: 2 });
    expect(() =>
      handle.repo.transitionFeatureState({
        feature: ids.feature,
        to: "DONE",
        expectedEpoch: 0,
        rev: 3,
        now: 3,
        evidence: passingEvidence(ids.feature),
      }),
    ).toThrow(IllegalFeatureTransitionError);
    expect(readFeatureState(handle.db, ids.feature).state).toBe("PLANNED");
    handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "JIT_READY",
      expectedEpoch: 0,
      rev: 3,
      now: 3,
    });
    handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "IN_WAVE",
      expectedEpoch: 0,
      rev: 3,
      now: 3,
    });
    expect(() =>
      handle.repo.transitionFeatureState({
        feature: ids.feature,
        to: "LEAVES_MERGED",
        expectedEpoch: 0,
        rev: 4,
        now: 4,
      }),
    ).toThrow(IllegalFeatureTransitionError);
    expect(readFeatureState(handle.db, ids.feature).state).toBe("IN_WAVE");
    expect(countEvent(handle.db, "FeatureCompleted")).toBe(0);
    expect(FEATURE_STATE_TRANSITIONS.ABANDONED).toEqual([]);
    expect(FEATURE_STATE_TRANSITIONS.DONE).toEqual(["REOPENED"]);
  });

  it("resumes a BLOCKED feature only to its recorded pre-block state", () => {
    handle = openLifecycle();
    const ids = seedGreenFeature(handle.db, { insertRuntime: false });
    handle.repo.initFeature({ feature: ids.feature, planAuthor: "planner", rev: 2, now: 2 });
    handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "JIT_READY",
      expectedEpoch: 0,
      rev: 3,
      now: 3,
    });
    handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "BLOCKED",
      expectedEpoch: 0,
      rev: 4,
      now: 4,
    });
    expect(() =>
      handle.repo.transitionFeatureState({
        feature: ids.feature,
        to: "IN_WAVE",
        expectedEpoch: 0,
        rev: 5,
        now: 5,
      }),
    ).toThrow(IllegalFeatureTransitionError);
    const resumed = handle.repo.transitionFeatureState({
      feature: ids.feature,
      to: "JIT_READY",
      expectedEpoch: 0,
      rev: 5,
      now: 5,
    });
    expect(resumed).toMatchObject({ from: "BLOCKED", to: "JIT_READY" });
    const stored = handle.db
      .prepare(`SELECT value FROM meta WHERE key = ?`)
      .get(`feature_pre_block_state:${ids.feature}`);
    expect(stored).toBeUndefined();
  });
});

function insertBody(sql: string, table: string): string {
  const marker = `INSERT INTO ${table} VALUES`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`missing ${table}`);
  const rest = sql.slice(start + marker.length);
  const end = rest.indexOf(";");
  return rest.slice(0, end);
}

describe("canonical lifecycle queries", () => {
  it("loads advance_feature_leaves_merged and requirement_status_recompute from schema/queries.sql", () => {
    const queries = loadCanonicalQueries();
    const advance = queries.get("advance_feature_leaves_merged") ?? "";
    const recompute = queries.get("requirement_status_recompute") ?? "";
    expect(advance).toContain("SET state = 'LEAVES_MERGED'");
    expect(advance).toContain("MERGED_TO_FEATURE");
    expect(advance).toContain("CANCELLED");
    expect(advance).toContain("SUPERSEDED");
    expect(advance).toContain("task_type");
    expect(advance).toContain("EXISTS (SELECT 1 FROM task_runtime");
    expect(recompute).toContain("cr.check_version = c.version");
    expect(queries.get("register_delivery")).toContain("outbox_deliveries");
  });
});
