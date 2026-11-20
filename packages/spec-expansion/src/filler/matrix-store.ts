import type { MatrixCellDraft, OpenCell, PersistedFill } from "./types.js";

/**
 * Local port of Task 079 `MatrixCellPersistenceRepo`.
 * Cell skeletons stay here until the generator package is on this base.
 * Requirement nodes themselves are written to state.db by `FillerStateDb`.
 */
export class MemoryMatrixCellStore {
  private readonly cells = new Map<string, MatrixCellDraft>();

  upsertCell(cell: OpenCell): void {
    const current = this.cells.get(cell.id);
    this.cells.set(cell.id, {
      ...cell,
      fill: current?.fill ?? null,
    });
  }

  saveFill(cellId: string, fill: PersistedFill): void {
    const current = this.cells.get(cellId);
    if (!current) throw new Error(`unknown matrix cell ${cellId}`);
    this.cells.set(cellId, { ...current, fill });
  }

  getCell(cellId: string): MatrixCellDraft | null {
    return this.cells.get(cellId) ?? null;
  }

  listCells(featureId?: string): readonly MatrixCellDraft[] {
    return [...this.cells.values()]
      .filter((cell) => featureId === undefined || cell.featureId === featureId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}

export interface MatrixCellPersistencePort {
  upsertCell(cell: OpenCell): void;
  saveFill(cellId: string, fill: PersistedFill): void;
  getCell(cellId: string): MatrixCellDraft | null;
  listCells(featureId?: string): readonly MatrixCellDraft[];
}
