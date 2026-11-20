import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  bindDatabaseSync,
  HintLadderController,
  type CandidateExampleRunner,
  type CandidateProbeRequest,
  type HiddenExample,
  type PropertyExampleGenerator,
} from "../../src/hint-ladder/index.js";

export const RULE_TEXT = "Orders close at 10:45 Europe/Berlin";

export function example(checkId: string, token: string): HiddenExample {
  return {
    checkId,
    input: { token: `INPUT_${token}` },
    expectedOutput: { token: `EXPECTED_${token}` },
  };
}

export const POOL: readonly HiddenExample[] = [
  example("H1", "ORANGE"),
  example("H2", "BLUE"),
  example("H3", "RED"),
  example("H4", "GOLD"),
];

export interface OpenedDb {
  readonly db: DatabaseSync;
  readonly controller: HintLadderController;
  readonly calls: CandidateProbeRequest[];
  readonly clock: () => number;
}

export function createClock(start = 1000): () => number {
  let value = start;
  return () => {
    value += 1;
    return value;
  };
}

export function openHarness(options?: {
  readonly file?: string;
  readonly bootstrap?: boolean;
  readonly clock?: () => number;
  readonly runner?: CandidateExampleRunner;
  readonly generator?: PropertyExampleGenerator;
}): OpenedDb {
  const file = options?.file ?? ":memory:";
  const bootstrap = options?.bootstrap ?? file === ":memory:";
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  registerSearch(db);
  if (bootstrap) {
    db.exec(readFileSync(canonicalAssetAbsolute("stateSql"), "utf8"));
    seed(db);
  }
  const calls: CandidateProbeRequest[] = [];
  const runner = options?.runner ?? {
    run(request: CandidateProbeRequest): unknown {
      calls.push(request);
      return { token: "ACTUAL_OUTPUT_GREEN_2" };
    },
  };
  const clock = options?.clock ?? createClock();
  const controller = new HintLadderController({
    db: bindDatabaseSync(db),
    now: clock,
    runner,
    ...(options?.generator ? { generator: options.generator } : {}),
  });
  return { db, controller, calls, clock };
}

export function temporaryFile(): { file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "hint-ladder-"));
  return {
    file: path.join(dir, "state.db"),
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function arm(db: DatabaseSync, attemptId = "A1"): void {
  db.prepare(
    `UPDATE task_runtime
        SET state = 'CLEAN_VERIFY', submission_pending = 1, holder_attempt = ?
      WHERE task = 'T07'`,
  ).run(attemptId);
}

export function textCell(row: Record<string, SQLOutputValue> | undefined, key: string): string {
  const value = required(row, key);
  if (typeof value !== "string") throw new Error(`${key} is not text`);
  return value;
}

export function numberCell(row: Record<string, SQLOutputValue> | undefined, key: string): number {
  const value = required(row, key);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`${key} is not a number`);
}

export function nullableText(row: Record<string, SQLOutputValue>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${key} is not text`);
  return value;
}

function required(row: Record<string, SQLOutputValue> | undefined, key: string): SQLOutputValue {
  if (!row) throw new Error(`missing row for ${key}`);
  const value = row[key];
  if (value === undefined) throw new Error(`missing ${key}`);
  return value;
}

function registerSearch(db: DatabaseSync): void {
  db.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) => {
    if (typeof value !== "string" || value.length === 0) return "";
    const extra = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
    return `${value} ${extra}`;
  });
}

function seed(db: DatabaseSync): void {
  const insertNode = db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES (?, ?, 1, ?, ?, ?, ?, 'CS-1', 1, 1)`,
  );
  db.exec("BEGIN IMMEDIATE");
  db.prepare(
    `INSERT INTO change_sets(id, rev, origin, author, created_at)
     VALUES ('CS-1', 1, 'planner', 'test', 1)`,
  ).run();
  insertNode.run("F12", "feature", "h-F12", "Kitchen print", "", JSON.stringify({ feature: "F12" }));
  insertNode.run("R17", "rule", "h-R17", "Cutoff rule", RULE_TEXT, JSON.stringify({ feature: "F12" }));
  insertNode.run(
    "SI-212",
    "spec_item",
    "h-SI-212",
    "Locked totals after cutoff",
    "",
    JSON.stringify({ feature: "F12" }),
  );
  insertNode.run(
    "T07",
    "task",
    "h-T07",
    "Kitchen print page",
    "",
    JSON.stringify({ feature: "F12" }),
  );
  for (const id of ["AC-31", "H1", "H2", "H3", "H4"]) {
    insertNode.run(
      id,
      "check",
      `h-${id}`,
      id,
      "",
      JSON.stringify({ feature: "F12", rule_id: "R17" }),
    );
  }
  const edge = db.prepare(
    `INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, 'CS-1', 1)`,
  );
  edge.run("T07", "obeys", "R17");
  edge.run("SI-212", "derived_from", "R17");
  for (const id of ["AC-31", "H1", "H2", "H3", "H4"]) edge.run(id, "verifies", "SI-212");
  db.prepare(
    `INSERT INTO task_runtime(task, feature, state, level, epoch, holder_attempt, submission_pending, updated_rev)
     VALUES ('T07', 'F12', 'CLEAN_VERIFY', 'Junior', 1, NULL, 1, 1)`,
  ).run();
  const attempt = db.prepare(
    `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
     VALUES (?, 'T07', ?, 1, 1, 'own', ?, 'c', 'abc', 'running', 1)`,
  );
  attempt.run("A1", 1, "mid-model");
  attempt.run("A2", 2, "senior-model");
  db.prepare(`UPDATE task_runtime SET holder_attempt = 'A1' WHERE task = 'T07'`).run();
  db.exec("COMMIT");
}
