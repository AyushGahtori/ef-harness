import { describe, expect, it } from "vitest";
import type { ReadModelConnection } from "../../src/read-models/index.js";
import { openGraph } from "./fixture.js";

describe("read model scale", () => {
  it("reads the board in under 10ms at 500 tasks and 5,000 requirements", { timeout: 180_000 }, () => {
    const opened = openGraph();
    const { repo, db } = opened;
    try {
      repo.transaction(() => {
        seedScale(db);
        repo.recomputeAllRequirementStatuses(1);
      });

      const checks = db.prepare("SELECT count(*) AS n FROM nodes WHERE kind = 'check'").get();
      const requirements = db
        .prepare("SELECT count(*) AS n FROM nodes WHERE kind = 'spec_item'")
        .get();
      const tasks = db.prepare("SELECT count(*) AS n FROM task_runtime").get();
      expect(checks?.n).toBe(5000);
      expect(requirements?.n).toBe(5000);
      expect(tasks?.n).toBe(500);

      const drift = repo.runDriftCheckAndHeal();
      expect(drift.drifted).toBe(false);
      expect(drift.taskRollup).toEqual([]);
      expect(drift.requirementRollup).toEqual([]);
      expect(drift.requirementStatus).toEqual([]);

      repo.getBoardSummary();
      const started = performance.now();
      const board = repo.getBoardSummary();
      const elapsed = performance.now() - started;

      expect(elapsed).toBeLessThan(10);
      expect(board.features).toHaveLength(20);
      expect(board.readRows).toBeLessThan(1000);
      const taskTotal = board.features.reduce((sum, feature) => sum + feature.taskTotal, 0);
      const requirementTotal = board.features.reduce(
        (sum, feature) => sum + feature.requirementTotal,
        0,
      );
      expect(taskTotal).toBe(500);
      expect(requirementTotal).toBe(5000);
      expect(board.features.every((feature) => feature.pending === feature.requirementTotal)).toBe(
        true,
      );
    } finally {
      repo.close();
    }
  });
});

function seedScale(db: ReadModelConnection): void {
  const features = Array.from({ length: 20 }, (_unused, index) =>
    `F${String(index + 1).padStart(2, "0")}`,
  );
  db.prepare(
    `INSERT INTO change_sets(id, rev, origin, author, created_at)
     VALUES ('CS-scale', 1, 'kernel', 'scale', 0)`,
  ).run();
  const node = db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES (?, ?, 1, ?, ?, '', ?, 'CS-scale', 1, 1)`,
  );
  const featureRuntime = db.prepare(
    "INSERT INTO feature_runtime(feature, state, updated_rev) VALUES (?, 'IN_WAVE', 1)",
  );
  const taskRuntime = db.prepare(
    "INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, ?, 'READY', 'Mid', 1)",
  );
  const edge = db.prepare(
    "INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, 'CS-scale', 1)",
  );
  for (const feature of features) {
    node.run([feature, "feature", `h-${feature}`, feature, "{}"]);
    featureRuntime.run([feature]);
  }
  for (let index = 1; index <= 500; index += 1) {
    const feature = features[(index - 1) % features.length] ?? "F01";
    const task = `T${String(index).padStart(4, "0")}`;
    node.run([task, "task", `h-${task}`, task, JSON.stringify({ feature })]);
    taskRuntime.run([task, feature]);
  }
  for (let index = 1; index <= 5000; index += 1) {
    const feature = features[(index - 1) % features.length] ?? "F01";
    const requirement = `R${String(index).padStart(4, "0")}`;
    const check = `C${String(index).padStart(4, "0")}`;
    const task = `T${String((index % 500) + 1).padStart(4, "0")}`;
    node.run([requirement, "spec_item", `h-${requirement}`, requirement, JSON.stringify({ feature })]);
    node.run([check, "check", `h-${check}`, check, JSON.stringify({ feature })]);
    edge.run([check, "verifies", requirement]);
    edge.run([task, "implements", requirement]);
  }
}
