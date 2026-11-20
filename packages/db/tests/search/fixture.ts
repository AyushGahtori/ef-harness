import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { splitSearchText } from "../../src/search/canonical.js";
import { asSqliteConnection } from "../../src/search/connection.js";
import { KnowledgeSearchService } from "../../src/search/service.js";
import type { KnowledgeSearchOptions, SqliteConnection } from "../../src/search/types.js";

const SCHEMA_PATH = fileURLToPath(new URL("../../../../schema/state.sql", import.meta.url));

export interface NodeDraft {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text?: string;
  readonly fields?: Record<string, unknown>;
}

export interface SearchFixture {
  readonly db: DatabaseSync;
  readonly connection: SqliteConnection;
  readonly service: KnowledgeSearchService;
  readonly file: string | null;
  addNodes(nodes: readonly NodeDraft[]): number;
  updateText(id: string, text: string): void;
  retire(id: string): void;
  attemptFor(taskId: string): string;
  release(): void;
  close(): void;
}

export function openMemory(options?: Partial<Pick<KnowledgeSearchOptions, "snippetChars" | "tokenBudget">>): SearchFixture {
  return openDatabase(new DatabaseSync(":memory:"), null, options);
}

export function openFile(
  options?: Partial<Pick<KnowledgeSearchOptions, "snippetChars" | "tokenBudget">>,
): SearchFixture {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ef-search-"));
  const file = path.join(directory, "state.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  return openDatabase(db, file, options);
}

export function seedKitchen(fixture: SearchFixture): void {
  fixture.addNodes([
    { id: "F12", kind: "feature", title: "Kitchen print", fields: { feature: "F12" } },
    {
      id: "R17",
      kind: "rule",
      title: "Cutoff rule",
      text: "Orders close at 10:45 Europe/Berlin",
      fields: { feature: "F12", tags: ["cutoff"] },
    },
    { id: "C-014", kind: "contract", title: "kitchen-totals", fields: { feature: "F12" } },
    { id: "SI-212", kind: "spec_item", title: "Locked totals after cutoff", fields: { feature: "F12" } },
    {
      id: "T03",
      kind: "task",
      title: "Map totals with toPrintRows",
      fields: { feature: "F12" },
    },
    {
      id: "T07",
      kind: "task",
      title: "Kitchen print page",
      fields: { feature: "F12" },
    },
    {
      id: "X1",
      kind: "rule",
      title: "Export naming",
      text: "see cutoff_rule before export",
      fields: { feature: "F12", basis: "derived" },
    },
    {
      id: "H1",
      kind: "check",
      title: "Hidden oracle",
      text: "secret webhook oracle",
      fields: { feature: "F12", hidden_check: true, sealed_oracle: true },
    },
    {
      id: "F99",
      kind: "feature",
      title: "Other feature",
      fields: { feature: "F99" },
    },
  ]);
}

function openDatabase(
  db: DatabaseSync,
  file: string | null,
  options?: Partial<Pick<KnowledgeSearchOptions, "snippetChars" | "tokenBudget">>,
): SearchFixture {
  db.exec("PRAGMA foreign_keys = ON");
  db.function("ef_search_text", { deterministic: true }, (value) => splitSearchText(value ?? ""));
  db.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const connection = asSqliteConnection(db);
  const service = new KnowledgeSearchService({
    reader: connection,
    writer: connection,
    ...(options?.snippetChars === undefined ? {} : { snippetChars: options.snippetChars }),
    ...(options?.tokenBudget === undefined ? {} : { tokenBudget: options.tokenBudget }),
  });
  let rev = 0;
  let released = false;

  const changeSet = (): { id: string; rev: number } => {
    rev += 1;
    const id = `CS-${rev}`;
    db.prepare(
      "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'planner', 'search-test', 0)",
    ).run(id, rev);
    return { id, rev };
  };

  return {
    db,
    connection,
    service,
    file,
    addNodes(nodes) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const cs = changeSet();
        const insert = db.prepare(
          `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const node of nodes) {
          const fields = { basis: "explicit", ...(node.fields ?? {}) };
          insert.run(
            node.id,
            node.kind,
            `h-${node.id}-1`,
            node.title,
            node.text ?? "",
            JSON.stringify(fields),
            cs.id,
            cs.rev,
            cs.rev,
          );
        }
        db.exec("COMMIT");
        return cs.rev;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    updateText(id, text) {
      const cs = changeSet();
      db.prepare(
        `UPDATE nodes
            SET version = version + 1, content_hash = ?, text = ?, change_set = ?, updated_rev = ?
          WHERE id = ?`,
      ).run(`h-${id}-${cs.rev}`, text, cs.id, cs.rev, id);
    },
    retire(id) {
      const cs = changeSet();
      db.prepare(
        `UPDATE nodes
            SET version = version + 1, status = 'retired', content_hash = ?, change_set = ?, updated_rev = ?
          WHERE id = ?`,
      ).run(`h-${id}-retired-${cs.rev}`, cs.id, cs.rev, id);
    },
    attemptFor(taskId) {
      const row = db.prepare("SELECT feature AS feature FROM nodes WHERE id = ?").get(taskId) as
        | { feature: string | null }
        | undefined;
      if (!row) throw new Error(`missing task node ${taskId}`);
      const feature = row.feature ?? "F0";
      const runtime = db.prepare("SELECT task FROM task_runtime WHERE task = ?").get(taskId);
      if (!runtime) {
        db.prepare(
          "INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, ?, 'READY', 'Mid', 1)",
        ).run(taskId, feature);
      }
      const attempt = `A-${taskId}`;
      const existing = db.prepare("SELECT id FROM attempts WHERE id = ?").get(attempt);
      if (!existing) {
        db.prepare(
          `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
           VALUES (?, ?, 1, 1, 1, 'own', 'm', 'c', 'abc', 'running', 0)`,
        ).run(attempt, taskId);
      }
      return attempt;
    },
    release() {
      if (released) return;
      released = true;
      db.close();
    },
    close() {
      if (!released) {
        released = true;
        db.close();
      }
      if (file) fs.rmSync(path.dirname(file), { recursive: true, force: true });
    },
  };
}
