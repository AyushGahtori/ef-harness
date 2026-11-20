import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonicalStatePath } from "../../src/acceptance/coordinator.js";
import { EMPTY_SEARCH_RESULT_HASH } from "../../src/acceptance/search-hash.js";

export const TASK = "T07";
export const ATTEMPT = "A-T07-1";
export const EPOCH = 3;
export const FEATURE = "F12";
export const COMMIT = "abc066candidate";
export const DIGEST = "digest-066";
export const RECEIPT = "VR-7781";
export const REQUIREMENT = "SI-212";
export const CHECK = "AC-31";

export interface AcceptanceFixture {
  readonly db: DatabaseSync;
  rev: number;
}

export function openHarnessDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.function("ef_search_text", { deterministic: true }, (value: string | null) => splitWords(value));
  db.exec(fs.readFileSync(canonicalStatePath(), "utf8"));
  return db;
}

export function seedReadyCandidate(): AcceptanceFixture {
  const db = openHarnessDb();
  const rev = 1;
  db.prepare(
    `INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', ?, 'planner', 'test', 0)`,
  ).run(rev);
  db.prepare(`INSERT INTO meta(key, value) VALUES ('last_rev', ?)`).run(String(rev));
  const addNode = (id: string, kind: string, title: string, fields: Record<string, unknown> = {}): void => {
    db.prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, ?, 1, ?, ?, '', ?, 'CS-1', ?, ?)`,
    ).run(id, kind, `h-${id}-1`, title, JSON.stringify({ feature: FEATURE, ...fields }), rev, rev);
  };
  addNode("F12", "feature", "Kitchen print");
  addNode("R17", "rule", "Cutoff rule");
  addNode("SI-212", "spec_item", "Locked totals after cutoff");
  addNode("T07", "task", "Kitchen print page", { touches: ["route"] });
  addNode("AC-31", "check", "Totals grouped by dish");
  addNode("C-014", "contract", "kitchen-totals");
  addNode("C-EMPTY", "contract", "unused-contract");
  const addEdge = (src: string, type: string, dst: string): void => {
    db.prepare(
      `INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, 'CS-1', ?)`,
    ).run(src, type, dst, rev);
  };
  addEdge("T07", "implements", "SI-212");
  addEdge("AC-31", "verifies", "SI-212");
  addEdge("T07", "consumes_contract", "C-014");
  db.prepare(
    `INSERT INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
     VALUES ('T07', 'F12', 'CLEAN_VERIFY', 'Mid', ?, 1, ?)`,
  ).run(EPOCH, rev);
  db.prepare(
    `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
     VALUES ('A-T07-1', 'T07', 1, ?, 1, 'own', 'm', 'c', 'base-1', 'submitted', 1)`,
  ).run(EPOCH);
  db.prepare(`UPDATE task_runtime SET holder_attempt = 'A-T07-1' WHERE task = 'T07'`).run();
  db.prepare(
    `INSERT INTO candidates(id, task, attempt, epoch, commit_sha, payload, received_at)
     VALUES ('CAND-1', 'T07', 'A-T07-1', ?, ?, ?, 1)`,
  ).run(EPOCH, COMMIT, JSON.stringify(candidatePayload()));
  db.prepare(
    `INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)
     VALUES ('AC-31', 'A-T07-1', 1, ?, 'pass', ?, 10)`,
  ).run(DIGEST, RECEIPT);
  db.prepare(
    `INSERT INTO artifacts(id, hash, kind, bytes, retention, created_at) VALUES
      ('ART-DIGEST', ?, 'diff', 20, 'diagnostic', 1),
      ('VR-7781', 'receipt-hash', 'trace', 8, 'diagnostic', 1),
      ('ART-OTHER', 'other-hash', 'log', 4, 'diagnostic', 1)`,
  ).run(DIGEST);
  db.prepare(
    `INSERT INTO read_sets(attempt, node, version, hash, how) VALUES ('A-T07-1', 'R17', 1, 'hash-r17', 'pushed')`,
  ).run();
  db.prepare(
    `INSERT INTO edge_read_sets(attempt, node, dir, type, version)
     VALUES ('A-T07-1', 'C-EMPTY', 'in', 'consumes_contract', 0)`,
  ).run();
  db.prepare(
    `INSERT INTO search_reads(attempt, query_hash, query, result_hash, rev)
     VALUES ('A-T07-1', 'q-empty', ?, ?, 1)`,
  ).run(JSON.stringify({ query: "no-such-fact-066", filters: {} }), EMPTY_SEARCH_RESULT_HASH);
  return { db, rev };
}

export function candidatePayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "candidate@1",
    task: TASK,
    attempt: ATTEMPT,
    epoch: EPOCH,
    commit: COMMIT,
    changed_paths: ["src/kitchen/print.ts"],
    diffstat: { files: 1, insertions: 12, deletions: 0 },
    exports_changed: [{ symbol: "KitchenPage", kind: "added" }],
    dependency_intents: [],
    migration_intents: [],
    wiring_needs: [{ kind: "route", path: "/kitchen", component: "KitchenPage" }],
    contracts_verified: [{ id: "C-014", v: 1 }],
    detected_touches: [],
    ...extra,
  };
}

export function replacePayload(db: DatabaseSync, payload: Record<string, unknown>): void {
  db.prepare(`UPDATE candidates SET payload = ? WHERE id = 'CAND-1'`).run(JSON.stringify(payload));
}

export function nextChange(fx: AcceptanceFixture): { id: string; rev: number } {
  fx.rev += 1;
  const id = `CS-${fx.rev}`;
  fx.db
    .prepare(
      `INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'kernel', 'test', 0)`,
    )
    .run(id, fx.rev);
  fx.db
    .prepare(
      `INSERT INTO meta(key, value) VALUES ('last_rev', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(fx.rev));
  return { id, rev: fx.rev };
}

export function addNode(
  fx: AcceptanceFixture,
  id: string,
  kind: string,
  title: string,
  fields: Record<string, unknown> = {},
): void {
  const change = nextChange(fx);
  fx.db
    .prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, ?, 1, ?, ?, '', ?, ?, ?, ?)`,
    )
    .run(
      id,
      kind,
      `h-${id}-1`,
      title,
      JSON.stringify({ feature: FEATURE, ...fields }),
      change.id,
      change.rev,
      change.rev,
    );
}

export function bumpNode(
  fx: AcceptanceFixture,
  id: string,
  changeClass: "cosmetic" | "clarifying" | "compatible" | "breaking" | "retired",
  patch: { title?: string; text?: string; fields?: Record<string, unknown> } = {},
): number {
  const change = nextChange(fx);
  const current = fx.db
    .prepare(`SELECT version, title, text, fields FROM nodes WHERE id = ?`)
    .get(id) as { version: number; title: string; text: string; fields: string };
  const next = current.version + 1;
  const title = patch.title ?? current.title;
  const text = patch.text ?? `${current.text} ${changeClass}`;
  const fields = patch.fields ? JSON.stringify(patch.fields) : current.fields;
  fx.db
    .prepare(
      `UPDATE nodes
          SET version = ?, title = ?, text = ?, fields = ?, content_hash = ?, change_set = ?, updated_rev = ?
        WHERE id = ?`,
    )
    .run(next, title, text, fields, `h-${id}-${next}`, change.id, change.rev, id);
  fx.db
    .prepare(
      `INSERT INTO node_changes(change_set, id, old_version, new_version, class) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(change.id, id, current.version, next, changeClass);
  return next;
}

export function addEdge(fx: AcceptanceFixture, src: string, type: string, dst: string): void {
  const change = nextChange(fx);
  fx.db
    .prepare(
      `INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(src, type, dst, change.id, change.rev);
}

export function passCheck(
  db: DatabaseSync,
  checkId: string,
  status: "pass" | "fail" | "skip" | "missing" | "error" = "pass",
  version = 1,
): void {
  db.prepare(
    `INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)
     VALUES (?, 'A-T07-1', ?, ?, ?, 'VR-7781', 11)`,
  ).run(checkId, version, DIGEST, status);
}

export function addDependent(fx: AcceptanceFixture): void {
  addNode(fx, "T08", "task", "Depends on print", { touches: ["route"] });
  addEdge(fx, "T08", "depends_on", "T07");
  fx.db
    .prepare(
      `INSERT INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
       VALUES ('T08', 'F12', 'READY', 'Mid', 0, 0, ?)`,
    )
    .run(fx.rev);
}

export function countRows(db: DatabaseSync, sql: string, ...params: (string | number)[]): number {
  const row = db.prepare(sql).get(...params) as { n: number };
  return row.n;
}

function splitWords(value: string | null): string {
  if (!value) return "";
  const extra = String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}
