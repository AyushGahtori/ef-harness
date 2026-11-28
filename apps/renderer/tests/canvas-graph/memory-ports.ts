import type { CanvasLayoutPersistencePort, ShellLayoutContextPort } from "../../src/canvas/graph/ports.js";
import type {
  CanvasFilterState,
  CanvasViewportState,
  SavedLayoutPosition,
  ShellLayoutCanvasSlice,
} from "../../src/canvas/graph/types.js";

export class FixtureCanvasLayoutPersistence implements CanvasLayoutPersistencePort {
  private rows: SavedLayoutPosition[] = [];

  loadAll(viewLevel: number): readonly SavedLayoutPosition[] {
    return this.rows.filter((row) => row.viewLevel === viewLevel);
  }

  upsert(row: SavedLayoutPosition): void {
    const idx = this.rows.findIndex((item) => item.nodeId === row.nodeId && item.viewLevel === row.viewLevel);
    if (idx >= 0) this.rows[idx] = row;
    else this.rows.push(row);
  }

  clearUnpinned(viewLevel: number): void {
    this.rows = this.rows.filter((row) => row.viewLevel !== viewLevel || row.pinnedByUser);
  }

  clearLevel(viewLevel: number): void {
    this.rows = this.rows.filter((row) => row.viewLevel !== viewLevel);
  }
}

export class FixtureShellLayoutContext implements ShellLayoutContextPort {
  private saved = false;
  private slice: ShellLayoutCanvasSlice = {
    viewport: { x: 0, y: 0, zoom: 1 },
    filters: {
      status: "all",
      nodeType: "all",
      brownfieldLayer: "both",
      searchQuery: "",
      phase: "all",
    },
  };

  readCanvas(): ShellLayoutCanvasSlice {
    return this.slice;
  }

  writeCanvas(next: Partial<ShellLayoutCanvasSlice>): void {
    this.saved = true;
    if (next.viewport) this.slice = { ...this.slice, viewport: next.viewport };
    if (next.filters) this.slice = { ...this.slice, filters: { ...this.slice.filters, ...next.filters } };
  }

  hasSavedSession(): boolean {
    return this.saved;
  }
}

export function emptyFilters(): CanvasFilterState {
  return {
    status: "all",
    nodeType: "all",
    brownfieldLayer: "both",
    searchQuery: "",
    phase: "all",
  };
}

export function emptyViewport(): CanvasViewportState {
  return { x: 0, y: 0, zoom: 1 };
}
