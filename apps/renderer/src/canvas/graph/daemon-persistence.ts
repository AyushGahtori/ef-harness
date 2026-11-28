import type { CanvasLayoutPersistencePort } from "./ports.js";
import type { SavedLayoutPosition, SemanticZoomLevel } from "./types.js";

export interface CanvasDaemonDispatch {
  (method: string, params: Record<string, unknown>): unknown;
}

export class DaemonCanvasLayoutPersistence implements CanvasLayoutPersistencePort {
  constructor(private readonly dispatch: CanvasDaemonDispatch) {}

  loadAll(viewLevel: number): readonly SavedLayoutPosition[] {
    return readRows(this.dispatch("canvas.layout.load", { viewLevel }));
  }

  upsert(row: SavedLayoutPosition): void {
    this.dispatch("canvas.layout.upsert", {
      nodeId: row.nodeId,
      viewLevel: row.viewLevel,
      x: row.x,
      y: row.y,
      pinnedByUser: row.pinnedByUser,
    });
  }

  clearUnpinned(viewLevel: number): void {
    this.dispatch("canvas.layout.clearUnpinned", { viewLevel });
  }

  clearLevel(viewLevel: number): void {
    this.dispatch("canvas.layout.clearLevel", { viewLevel });
  }
}

function readRows(result: unknown): readonly SavedLayoutPosition[] {
  if (!isRecord(result) || !Array.isArray(result.rows)) return [];
  const rows: SavedLayoutPosition[] = [];
  for (const value of result.rows) {
    const row = readRow(value);
    if (row) rows.push(row);
  }
  return rows;
}

function readRow(value: unknown): SavedLayoutPosition | null {
  if (!isRecord(value)) return null;
  const nodeId = value.nodeId;
  const viewLevel = value.viewLevel;
  const x = value.x;
  const y = value.y;
  if (typeof nodeId !== "string" || typeof x !== "number" || typeof y !== "number") return null;
  if (viewLevel !== 1 && viewLevel !== 2 && viewLevel !== 3 && viewLevel !== 4) return null;
  const level: SemanticZoomLevel = viewLevel;
  return {
    nodeId,
    viewLevel: level,
    x,
    y,
    pinnedByUser: value.pinnedByUser === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
