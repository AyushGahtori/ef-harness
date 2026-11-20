import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  CANONICAL_READ_MODEL_QUERIES,
  createMemoryLogger,
  InvalidSyncRequestError,
  openReadModelDatabase,
  RollupWriteForbiddenError,
  WaiverApprovalRequiredError,
  type ReadModelRepo,
} from "../../src/read-models/index.js";
import { openGraph, type OpenedGraph, type ProjectGraph } from "./fixture.js";

const opened: OpenedGraph[] = [];

function useGraph(logger = createMemoryLogger()): OpenedGraph & { logger: typeof logger } {
  const graph = openGraph({ logger });
  opened.push(graph);
  return { ...graph, logger };
}

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.repo.close();
  }
});

describe("read models", () => {
  it("runs canonical rollup, recompute, and traceability SQL from schema/queries.sql", () => {
    const { repo } = useGraph();
    const file = fs.readFileSync(canonicalAssetAbsolute("queriesSql"), "utf8");
    for (const name of CANONICAL_READ_MODEL_QUERIES) {
      const sql = repo.canonicalQuery(name);
      expect(sql.length).toBeGreaterThan(0);
      expect(file.replaceAll("\r\n", "\n")).toContain(sql);
    }
    expect(repo.canonicalQuery("requirement_status_recompute")).toContain(
      "cr.check_version = c.version",
    );
    expect(repo.canonicalQuery("requirement_status_recompute")).toContain(
      "ORDER BY cr.recorded_at DESC",
    );
    expect(repo.canonicalQuery("rollup_drift")).toContain("FULL OUTER JOIN");
  });

  it("keeps task rollups at zero drift across creates, transitions, and feature moves", () => {
    const { repo, graph } = useGraph();
    graph.addFeature("F12", "IN_WAVE");
    graph.addFeature("F13", "PLANNED");
    graph.addTask("T07", "F12");
    graph.addTask("T03", "F12");

    let board = repo.getBoardSummary();
    expect(board.features.map((feature) => feature.feature)).toEqual(["F12", "F13"]);
    expect(repo.getFeatureProgress("F12")).toMatchObject({
      featureState: "IN_WAVE",
      taskCounts: { READY: 2 },
      taskTotal: 2,
    });
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);

    graph.setTaskState("T07", "CODING");
    expect(repo.getFeatureProgress("F12").taskCounts).toEqual({ READY: 1, CODING: 1 });
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);

    graph.setTaskFeature("T07", "F13");
    expect(repo.getFeatureProgress("F12").taskCounts).toEqual({ READY: 1, CODING: 0 });
    expect(repo.getFeatureProgress("F13").taskCounts).toEqual({ CODING: 1 });
    expect(minimumRollup(repo)).toBeGreaterThanOrEqual(0);
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);
    expect(board.readRows).toBeLessThan(50);
    board = repo.getBoardSummary();
    expect(board.readRows).toBeLessThan(50);
  });

  it("recomputes requirement status from the latest current-version check result", () => {
    const { repo, graph } = useGraph();
    graph.addFeature("F12");
    graph.addTask("T03", "F12");
    graph.addRequirement("SI-212", "spec_item", { feature: "F12" });
    graph.addCheck("AC-31", "F12");
    graph.edge("AC-31", "verifies", "SI-212");
    graph.addAttempt("A1", "T03");
    graph.addAttempt("A2", "T03");

    repo.syncRequirementStatusForChecks({ checkIds: ["AC-31"], updatedRev: 1 });
    expect(repo.getRequirementStatus("SI-212")?.status).toBe("pending");

    graph.addCheckResult("AC-31", "A1", "fail", 10);
    repo.syncRequirementStatusForChecks({ checkIds: ["AC-31"], updatedRev: 2 });
    expect(repo.getRequirementStatus("SI-212")?.status).toBe("failing");

    graph.addCheckResult("AC-31", "A2", "pass", 20);
    repo.syncRequirementStatusForChecks({ checkIds: ["AC-31"], updatedRev: 3 });
    expect(repo.getRequirementStatus("SI-212")?.status).toBe("passing");
    expect(repo.getFeatureProgress("F12").requirementCounts.passing).toBe(1);
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);

    graph.reviseNode("AC-31");
    repo.syncRequirementStatusForChecks({ checkIds: ["AC-31"], updatedRev: 4 });
    expect(repo.getRequirementStatus("SI-212")?.status).toBe("pending");
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);
  });

  it("counts skip and missing check results as failing", () => {
    const { repo, graph } = useGraph();
    graph.addFeature("F12");
    graph.addTask("T03", "F12");
    seedChecked(graph, "R-skip", "C-pass", "C-skip");
    seedChecked(graph, "R-missing", "C-pass-2", "C-missing");
    graph.addAttempt("A1", "T03");
    graph.addCheckResult("C-pass", "A1", "pass", 1);
    graph.addCheckResult("C-skip", "A1", "skip", 2);
    graph.addCheckResult("C-pass-2", "A1", "pass", 3);
    graph.addCheckResult("C-missing", "A1", "missing", 4);
    repo.recomputeAllRequirementStatuses(1);
    expect(repo.getRequirementStatus("R-skip")?.status).toBe("failing");
    expect(repo.getRequirementStatus("R-missing")?.status).toBe("failing");
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);
  });

  it("breaks identical recorded_at ties by attempt id so the latest result is stable", () => {
    const { repo, graph } = useGraph();
    graph.addFeature("F12");
    graph.addTask("T03", "F12");
    graph.addRequirement("R1", "rule", { feature: "F12" });
    graph.addCheck("C1", "F12");
    graph.edge("C1", "verifies", "R1");
    graph.addAttempt("AT-1", "T03");
    graph.addAttempt("AT-2", "T03");
    graph.addCheckResult("C1", "AT-1", "fail", 5);
    graph.addCheckResult("C1", "AT-2", "pass", 5);

    const first = repo.syncRequirementStatusForChecks({ checkIds: ["C1"], updatedRev: 1 });
    expect(first.timestampsAdjusted).toBe(1);
    expect(repo.getRequirementStatus("R1")?.status).toBe("passing");
    const times = repo.database
      .prepare("SELECT attempt, recorded_at FROM check_results WHERE check_id = 'C1' ORDER BY attempt")
      .all()
      .map((row) => [row.attempt, row.recorded_at]);
    expect(times).toEqual([
      ["AT-1", 5],
      ["AT-2", 6],
    ]);

    const second = repo.syncRequirementStatusForChecks({ checkIds: ["C1"], updatedRev: 1 });
    expect(second.timestampsAdjusted).toBe(0);
    expect(repo.getRequirementStatus("R1")?.status).toBe("passing");
  });

  it("waives a failing requirement only when the waiver covers its risk", () => {
    const { repo, graph } = useGraph();
    graph.addFeature("F12");
    graph.addTask("T03", "F12");
    graph.addRequirement("R-high", "rule", { feature: "F12", risk: "critical" });
    graph.addRequirement("R-low", "rule", { feature: "F12", risk: "low" });
    graph.addCheck("C-high", "F12");
    graph.addCheck("C-low", "F12");
    graph.edge("C-high", "verifies", "R-high");
    graph.edge("C-low", "verifies", "R-low");
    graph.addAttempt("A1", "T03");
    graph.addCheckResult("C-high", "A1", "fail", 1);
    graph.addCheckResult("C-low", "A1", "fail", 2);
    repo.recomputeAllRequirementStatuses(1);
    expect(repo.getRequirementStatus("R-high")?.status).toBe("failing");

    graph.addWaiver("W-ok", "R-high", {
      reason: "developer accepted",
      approved_by: "developer",
      risk_max: "critical",
    });
    repo.syncRequirementStatusForChecks({ requirementIds: ["R-high"], updatedRev: 2 });
    expect(repo.getRequirementStatus("R-high")?.status).toBe("waived");
    expect(repo.listWaivers()).toEqual([
      expect.objectContaining({
        id: "W-ok",
        requirementId: "R-high",
        approvedBy: "developer",
        riskMax: "critical",
        requirementRisk: "critical",
        developerApproved: true,
        coversRequirement: true,
      }),
    ]);
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);

    graph.addWaiver("W-low", "R-low", { reason: "low risk", risk_max: "low" });
    repo.syncRequirementStatusForChecks({ requirementIds: ["R-low"], updatedRev: 3 });
    expect(repo.getRequirementStatus("R-low")?.status).toBe("waived");

    graph.addRequirement("R-silent", "rule", { feature: "F12", risk: "high" });
    graph.addCheck("C-silent", "F12");
    graph.edge("C-silent", "verifies", "R-silent");
    graph.addCheckResult("C-silent", "A1", "fail", 4);
    graph.addWaiver("W-silent", "R-silent", { reason: "agent skipped", risk_max: "high" });
    expect(() =>
      repo.syncRequirementStatusForChecks({ requirementIds: ["R-silent"], updatedRev: 4 }),
    ).toThrow(WaiverApprovalRequiredError);
    expect(repo.getRequirementStatus("R-silent")?.status).not.toBe("waived");

    graph.addRequirement("R-ceiling", "rule", { feature: "F12", risk: "critical" });
    graph.addCheck("C-ceiling", "F12");
    graph.edge("C-ceiling", "verifies", "R-ceiling");
    graph.addCheckResult("C-ceiling", "A1", "fail", 5);
    graph.addWaiver("W-ceiling", "R-ceiling", {
      reason: "too narrow",
      approved_by: "developer",
      risk_max: "low",
    });
    expect(() =>
      repo.syncRequirementStatusForChecks({ requirementIds: ["R-ceiling"], updatedRev: 5 }),
    ).toThrow(WaiverApprovalRequiredError);
    expect(repo.getRequirementStatus("R-ceiling")?.status).not.toBe("waived");
  });

  it("aggregates null-feature requirements on the trigger's empty feature key", () => {
    const { repo, graph } = useGraph();
    graph.addFeature("F12");
    graph.addRequirement("X-01", "rule", {});
    graph.addRequirement("X-02", "rule", {});
    graph.addRequirement("R-local", "rule", { feature: "F12" });
    repo.recomputeAllRequirementStatuses(1);

    expect(repo.getFeatureProgress("").requirementCounts.uncovered).toBe(2);
    expect(repo.getFeatureProgress("F12").requirementCounts.uncovered).toBe(1);
    expect(repo.getBoardSummary().features[0]?.feature).toBe("");
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);

    graph.reviseNode("R-local", {});
    repo.transaction(() => {
      repo.syncRequirementStatusInTx({ requirementIds: ["R-local"], updatedRev: 2 });
    });
    expect(repo.getFeatureProgress("").requirementCounts.uncovered).toBe(3);
    expect(repo.getFeatureProgress("F12").requirementCounts.uncovered).toBe(0);
    expect(minimumRollup(repo)).toBeGreaterThanOrEqual(0);
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);
  });

  it("removes a retired requirement from status and rollups in the same transaction", () => {
    const { repo, graph } = useGraph();
    graph.addFeature("F12");
    graph.addRequirement("R-gone", "rule", { feature: "F12" });
    repo.recomputeAllRequirementStatuses(1);
    expect(repo.getFeatureProgress("F12").uncovered).toBe(1);
    graph.retireNode("R-gone");
    const result = repo.syncRequirementStatusForChecks({
      requirementIds: ["R-gone"],
      updatedRev: 2,
    });
    expect(result.removed).toEqual(["R-gone"]);
    expect(repo.getRequirementStatus("R-gone")).toBeNull();
    expect(repo.getFeatureProgress("F12").requirementTotal).toBe(0);
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);
  });

  it("reports requirements without tasks, requirements without checks, and orphan tasks", () => {
    const { repo, graph } = useGraph();
    graph.addFeature("F12");
    graph.addRequirement("R-bare", "rule", { feature: "F12" });
    graph.addRequirement("R-tasked", "rule", { feature: "F12" });
    graph.addRequirement("R-full", "spec_item", { feature: "F12" });
    graph.addTask("T-linked", "F12");
    graph.addTask("T-orphan", "F12");
    graph.addCheck("C-full", "F12");
    graph.edge("T-linked", "obeys", "R-tasked");
    graph.edge("T-linked", "implements", "R-full");
    graph.edge("C-full", "verifies", "R-full");

    expect(repo.getTraceabilityGaps()).toEqual({
      requirementsWithoutTask: ["R-bare"],
      requirementsWithoutCheck: ["R-bare", "R-tasked"],
      tasksWithoutRequirement: ["T-orphan"],
    });
  });

  it("refuses direct application writes to rollup tables while triggers still maintain them", () => {
    const db = openReadModelDatabase();
    opened.push({ repo: { close: () => db.close() } as ReadModelRepo, db, graph: {} as ProjectGraph });
    expect(() => db.exec("UPDATE rollup_feature_tasks SET n = 1")).toThrow(RollupWriteForbiddenError);
    expect(() => db.exec("DELETE FROM rollup_feature_requirements")).toThrow(RollupWriteForbiddenError);
    expect(() =>
      db.prepare("INSERT INTO rollup_feature_tasks(feature, state, n) VALUES ('Z', 'READY', 1)"),
    ).toThrow(RollupWriteForbiddenError);

    const { repo, graph } = useGraph();
    graph.addFeature("F12");
    graph.addTask("T07", "F12");
    expect(repo.getFeatureProgress("F12").taskCounts.READY).toBe(1);
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);
  });

  it("requires an open transaction and a sync target", () => {
    const { repo } = useGraph();
    expect(() => repo.syncRequirementStatusInTx({ requirementIds: ["R1"] })).toThrow(
      /BEGIN IMMEDIATE/,
    );
    expect(() => repo.syncRequirementStatusForChecks({})).toThrow(InvalidSyncRequestError);
  });

  it("logs tampered task rollups and heals them back to zero drift", () => {
    const logger = createMemoryLogger();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef-read-models-"));
    const location = path.join(directory, "state.db");
    const openedGraph = openGraph({ location, logger });
    opened.push(openedGraph);
    const { repo, graph } = openedGraph;
    graph.addFeature("F12");
    graph.addTask("T07", "F12");
    repo.recomputeAllRequirementStatuses(1);

    const outsider = new DatabaseSync(location);
    outsider.exec("PRAGMA busy_timeout = 5000");
    outsider.prepare("UPDATE rollup_feature_tasks SET n = 7 WHERE feature = ? AND state = ?").run(
      "F12",
      "READY",
    );
    outsider.close();

    const healed = repo.runDriftCheckAndHeal();
    expect(healed.drifted).toBe(true);
    expect(healed.healed).toBe(true);
    expect(healed.taskRollup).toEqual([
      { feature: "F12", state: "READY", rollup_n: 7, actual_n: 1 },
    ]);
    expect(logger.alerts).toEqual([
      expect.objectContaining({
        severity: "error",
        event: "kernel_bug.read_model_drift",
        taskRollup: [{ feature: "F12", state: "READY", rollup_n: 7, actual_n: 1 }],
        requirementRollup: [],
        requirementStatus: [],
      }),
    ]);
    expect(repo.getFeatureProgress("F12").taskCounts.READY).toBe(1);
    const clean = repo.runDriftCheckAndHeal();
    expect(clean.drifted).toBe(false);
    expect(logger.alerts).toHaveLength(1);
    removeTemp(directory, repo);
  });

  it("heals tampered requirement rollups and requirement_status rows", () => {
    const logger = createMemoryLogger();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef-read-models-"));
    const location = path.join(directory, "state.db");
    const openedGraph = openGraph({ location, logger });
    opened.push(openedGraph);
    const { repo, graph } = openedGraph;
    graph.addFeature("F12");
    graph.addRequirement("R1", "rule", { feature: "F12" });
    graph.addCheck("C1", "F12");
    graph.edge("C1", "verifies", "R1");
    repo.recomputeAllRequirementStatuses(1);
    expect(repo.getRequirementStatus("R1")?.status).toBe("pending");

    const outsider = new DatabaseSync(location);
    outsider.exec("PRAGMA busy_timeout = 5000");
    outsider
      .prepare("UPDATE rollup_feature_requirements SET n = 4 WHERE feature = ? AND status = ?")
      .run("F12", "pending");
    outsider.close();

    const rollupHeal = repo.runDriftCheckAndHeal();
    expect(rollupHeal.requirementRollup).toEqual([
      { feature: "F12", status: "pending", rollup_n: 4, actual_n: 1 },
    ]);
    expect(rollupHeal.healed).toBe(true);
    expect(logger.alerts[0]?.requirementRollup).toEqual(rollupHeal.requirementRollup);

    repo.database
      .prepare("UPDATE requirement_status SET status = 'failing' WHERE requirement = ?")
      .run(["R1"]);
    const statusHeal = repo.runDriftCheckAndHeal();
    expect(statusHeal.requirementStatus).toEqual([
      {
        requirement: "R1",
        stored_feature: "F12",
        stored_status: "failing",
        recomputed_feature: "F12",
        recomputed_status: "pending",
      },
    ]);
    expect(statusHeal.healed).toBe(true);
    expect(repo.getRequirementStatus("R1")?.status).toBe("pending");
    expect(repo.runDriftCheckAndHeal().drifted).toBe(false);
    removeTemp(directory, repo);
  });
});

function removeTemp(directory: string, repo: ReadModelRepo): void {
  repo.close();
  fs.rmSync(directory, { recursive: true, force: true });
}

function seedChecked(graph: ProjectGraph, requirement: string, passCheck: string, otherCheck: string): void {
  graph.addRequirement(requirement, "rule", { feature: "F12" });
  graph.addCheck(passCheck, "F12");
  graph.addCheck(otherCheck, "F12");
  graph.edge(passCheck, "verifies", requirement);
  graph.edge(otherCheck, "verifies", requirement);
}

function minimumRollup(repo: ReadModelRepo): number {
  const row = repo.database.prepare("SELECT min(n) AS n FROM rollup_feature_tasks").get();
  return typeof row?.n === "number" ? row.n : 0;
}
