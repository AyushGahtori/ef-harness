import { openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import type { WorkItemPersistencePort } from "./contracts.js";
import type { BrownfieldWorkItemRow, BrownfieldWorkKind, WorkItemDbKind } from "./types.js";

const META_KEY = "brownfield.work_items";

export interface SqliteWorkItemStoreOptions {
  readonly projectId: string;
  readonly rootDir: string;
}

export class SqliteWorkItemStore implements WorkItemPersistencePort {
  private readonly stateDb: ProjectStateDb;

  constructor(options: SqliteWorkItemStoreOptions) {
    this.stateDb = openProjectStateDb(options);
  }

  static reopen(options: SqliteWorkItemStoreOptions): SqliteWorkItemStore {
    return new SqliteWorkItemStore(options);
  }

  insertWorkItem(row: {
    readonly id: string;
    readonly dbKind: WorkItemDbKind;
    readonly kind: BrownfieldWorkKind;
    readonly title: string;
    readonly status: "discovering";
    readonly createdAtMs: number;
  }): void {
    this.stateDb.writer.run(
      `INSERT INTO work_items (id, kind, title, status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.dbKind, row.title, row.status, row.createdAtMs],
    );
    const rows = this.readRows().filter((existing) => existing.id !== row.id);
    rows.push({
      id: row.id,
      dbKind: row.dbKind,
      kind: row.kind,
      title: row.title,
      status: row.status,
      createdAtMs: row.createdAtMs,
    });
    this.stateDb.setMeta(META_KEY, JSON.stringify(rows));
  }

  listWorkItems(): readonly BrownfieldWorkItemRow[] {
    return this.readRows().sort(
      (a, b) => a.createdAtMs - b.createdAtMs || a.title.localeCompare(b.title),
    );
  }

  close(): void {
    this.stateDb.close();
  }

  private readRows(): BrownfieldWorkItemRow[] {
    const raw = this.stateDb.getMeta(META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BrownfieldWorkItemRow[];
    return parsed;
  }
}
