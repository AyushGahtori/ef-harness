import type { SqliteConnection } from "../driver/types.js";

export type CanvasLayoutSql = Pick<SqliteConnection, "all" | "run">;

export interface CanvasLayoutRow {
  readonly nodeId: string;
  readonly viewLevel: 1 | 2 | 3 | 4;
  readonly x: number;
  readonly y: number;
  readonly pinnedByUser: boolean;
}

export class CanvasLayoutNodeMissingError extends Error {
  constructor(readonly nodeId: string) {
    super(`canvas_layout node is not in state.db: ${nodeId}`);
    this.name = "CanvasLayoutNodeMissingError";
  }
}

export class CanvasLayoutInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasLayoutInputError";
  }
}

/**
 * Reads and writes the landed `state.db.canvas_layout` rows.
 * The primary key is `(node_id, view_level)` and `view_level` is an integer 1–4.
 */
export class CanvasLayoutRepo {
  constructor(private readonly db: CanvasLayoutSql) {}

  loadAll(viewLevel: number): readonly CanvasLayoutRow[] {
    const level = viewLevelOf(viewLevel);
    const rows = this.db.all(
      `SELECT node_id, view_level, x, y, pinned_by_user
         FROM canvas_layout
        WHERE view_level = :view_level
        ORDER BY node_id`,
      { view_level: level },
    );
    return rows.map(readRow);
  }

  upsert(row: CanvasLayoutRow): void {
    const level = viewLevelOf(row.viewLevel);
    if (!Number.isFinite(row.x) || !Number.isFinite(row.y)) {
      throw new CanvasLayoutInputError("canvas coordinates must be finite");
    }
    try {
      this.db.run(
        `INSERT INTO canvas_layout (node_id, view_level, x, y, pinned_by_user)
         VALUES (:node_id, :view_level, :x, :y, :pinned_by_user)
         ON CONFLICT (node_id, view_level) DO UPDATE SET
           x = excluded.x,
           y = excluded.y,
           pinned_by_user = excluded.pinned_by_user`,
        {
          node_id: row.nodeId,
          view_level: level,
          x: row.x,
          y: row.y,
          pinned_by_user: row.pinnedByUser ? 1 : 0,
        },
      );
    } catch (error) {
      if (isForeignKey(error)) throw new CanvasLayoutNodeMissingError(row.nodeId);
      throw error;
    }
  }

  clearUnpinned(viewLevel: number): void {
    const level = viewLevelOf(viewLevel);
    this.db.run(
      `DELETE FROM canvas_layout WHERE view_level = :view_level AND pinned_by_user = 0`,
      { view_level: level },
    );
  }

  clearLevel(viewLevel: number): void {
    const level = viewLevelOf(viewLevel);
    this.db.run(`DELETE FROM canvas_layout WHERE view_level = :view_level`, { view_level: level });
  }
}

export function viewLevelOf(value: number): 1 | 2 | 3 | 4 {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new CanvasLayoutInputError("view_level must be an integer from 1 to 4");
}

function readRow(value: unknown): CanvasLayoutRow {
  if (!isRecord(value)) throw new CanvasLayoutInputError("canvas_layout row was not an object");
  const nodeId = value.node_id;
  const viewLevel = value.view_level;
  const x = value.x;
  const y = value.y;
  const pinned = value.pinned_by_user;
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    throw new CanvasLayoutInputError("canvas_layout node_id is missing");
  }
  if (typeof viewLevel !== "number" || typeof x !== "number" || typeof y !== "number") {
    throw new CanvasLayoutInputError("canvas_layout coordinates are missing");
  }
  return {
    nodeId,
    viewLevel: viewLevelOf(viewLevel),
    x,
    y,
    pinnedByUser: pinned === 1 || pinned === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isForeignKey(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /FOREIGN KEY/i.test(message);
}
