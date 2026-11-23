import type { CanvasLayoutPersistencePort } from "./ports.js";
import type { LayoutPoint, SavedLayoutPosition, SemanticZoomLevel } from "./types.js";

export class SavedNodePositionStore {
  private readonly cache = new Map<string, SavedLayoutPosition>();

  constructor(private readonly persistence: CanvasLayoutPersistencePort) {}

  hydrate(viewLevel: SemanticZoomLevel): void {
    this.cache.clear();
    for (const row of this.persistence.loadAll(viewLevel)) {
      this.cache.set(this.key(row.nodeId, row.viewLevel), row);
    }
  }

  key(nodeId: string, viewLevel: SemanticZoomLevel): string {
    return `${nodeId}@${viewLevel}`;
  }

  getPinned(nodeId: string, viewLevel: SemanticZoomLevel): SavedLayoutPosition | null {
    const row = this.cache.get(this.key(nodeId, viewLevel));
    return row?.pinnedByUser ? row : null;
  }

  listPinned(viewLevel: SemanticZoomLevel): readonly SavedLayoutPosition[] {
    return [...this.cache.values()].filter((row) => row.viewLevel === viewLevel && row.pinnedByUser);
  }

  pinDragged(nodeId: string, viewLevel: SemanticZoomLevel, x: number, y: number): void {
    const row: SavedLayoutPosition = { nodeId, viewLevel, x, y, pinnedByUser: true };
    this.cache.set(this.key(nodeId, viewLevel), row);
    this.persistence.upsert(row);
  }

  applyLayout(points: readonly LayoutPoint[], viewLevel: SemanticZoomLevel): void {
    for (const point of points) {
      const existing = this.cache.get(this.key(point.nodeId, viewLevel));
      if (existing?.pinnedByUser) continue;
      const row: SavedLayoutPosition = {
        nodeId: point.nodeId,
        viewLevel,
        x: point.x,
        y: point.y,
        pinnedByUser: false,
      };
      this.cache.set(this.key(point.nodeId, viewLevel), row);
      this.persistence.upsert(row);
    }
  }

  resetAutoArrange(viewLevel: SemanticZoomLevel): void {
    for (const [key, row] of [...this.cache.entries()]) {
      if (row.viewLevel === viewLevel) this.cache.delete(key);
    }
    this.persistence.clearLevel(viewLevel);
  }

  positionFor(nodeId: string, viewLevel: SemanticZoomLevel): { x: number; y: number } | null {
    const row = this.cache.get(this.key(nodeId, viewLevel));
    return row ? { x: row.x, y: row.y } : null;
  }
}