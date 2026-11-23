import type { WorkItemPersistencePort } from "./contracts.js";
import type { BrownfieldWorkItemRow, BrownfieldWorkKind, WorkItemDbKind } from "./types.js";

export class InMemoryWorkItemStore implements WorkItemPersistencePort {
  private readonly rows: BrownfieldWorkItemRow[] = [];

  insertWorkItem(row: {
    readonly id: string;
    readonly dbKind: WorkItemDbKind;
    readonly kind: BrownfieldWorkKind;
    readonly title: string;
    readonly status: "discovering";
    readonly createdAtMs: number;
  }): void {
    this.rows.push({
      id: row.id,
      dbKind: row.dbKind,
      kind: row.kind,
      title: row.title,
      status: row.status,
      createdAtMs: row.createdAtMs,
    });
  }

  listWorkItems(): readonly BrownfieldWorkItemRow[] {
    return [...this.rows].sort(
      (a, b) => a.createdAtMs - b.createdAtMs || a.title.localeCompare(b.title),
    );
  }
}