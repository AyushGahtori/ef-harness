import { DatabaseSync } from "node:sqlite";
import { percentile } from "./stats.js";
import {
  applyMemoryPragmas,
  emptyStateTemplate,
  registerSearch,
} from "./schema-cache.js";

export interface PerfResult {
  writeP99Ms: number;
  boardQueryMs: number;
  writeSamples: number;
  tasks: number;
  requirements: number;
}

function openState(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyMemoryPragmas(db);
  registerSearch(db);
  db.deserialize(emptyStateTemplate());
  applyMemoryPragmas(db);
  registerSearch(db);
  return db;
}

/** Fifty simulated single-writer transactions. p99 must stay under 50 ms. */
export function measureWriteLatency(): { p99Ms: number; samples: number[] } {
  const db = openState();
  try {
    db.exec("INSERT INTO meta(key, value) VALUES ('write_probe', '0')");
    const update = db.prepare("UPDATE meta SET value = ? WHERE key = 'write_probe'");
    const samples: number[] = [];
    for (let worker = 0; worker < 50; worker += 1) {
      const started = globalThis.performance.now();
      db.exec("BEGIN IMMEDIATE");
      update.run(String(worker));
      db.exec("COMMIT");
      samples.push(globalThis.performance.now() - started);
    }
    return { p99Ms: percentile(samples, 99), samples };
  } finally {
    db.close();
  }
}

/**
 * 500 tasks and 5,000 requirements. The Board reads trigger-maintained rollups,
 * which must return in under 10 ms.
 */
export function measureBoardQuery(): { queryMs: number; tasks: number; requirements: number } {
  const db = openState();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-BOARD', 1, 'kernel', 'sim', 0)").run();
    const node = db.prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, ?, 1, ?, ?, '', ?, 'CS-BOARD', 1, 1)`,
    );
    const task = db.prepare(
      "INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, ?, 'READY', 'Mid', 1)",
    );
    const requirement = db.prepare(
      "INSERT INTO requirement_status(requirement, feature, status, updated_rev) VALUES (?, ?, 'pending', 1)",
    );
    for (let feature = 0; feature < 25; feature += 1) {
      const featureId = `F${feature}`;
      node.run(featureId, "feature", `${featureId}-h`, `Feature ${feature}`, JSON.stringify({ feature: featureId }));
    }
    for (let index = 0; index < 500; index += 1) {
      const featureId = `F${index % 25}`;
      const id = `T${index}`;
      node.run(id, "task", `${id}-h`, `Task ${index}`, JSON.stringify({ feature: featureId }));
      task.run(id, featureId);
    }
    for (let index = 0; index < 5_000; index += 1) {
      const featureId = `F${index % 25}`;
      const id = `R${index}`;
      node.run(id, "spec_item", `${id}-h`, `Requirement ${index}`, JSON.stringify({ feature: featureId }));
      requirement.run(id, featureId);
    }
    db.exec("COMMIT");
    const taskRollup = db.prepare("SELECT feature, state, n FROM rollup_feature_tasks ORDER BY feature, state");
    const requirementRollup = db.prepare(
      "SELECT feature, status, n FROM rollup_feature_requirements ORDER BY feature, status",
    );
    taskRollup.all();
    requirementRollup.all();
    const started = globalThis.performance.now();
    const tasks = taskRollup.all();
    const requirements = requirementRollup.all();
    const queryMs = globalThis.performance.now() - started;
    if (tasks.length === 0 || requirements.length === 0) {
      throw new Error("board rollups were empty");
    }
    return { queryMs, tasks: 500, requirements: 5_000 };
  } finally {
    db.close();
  }
}

export function measureM0Performance(): PerfResult {
  const writes = measureWriteLatency();
  const board = measureBoardQuery();
  return {
    writeP99Ms: writes.p99Ms,
    boardQueryMs: board.queryMs,
    writeSamples: writes.samples.length,
    tasks: board.tasks,
    requirements: board.requirements,
  };
}
