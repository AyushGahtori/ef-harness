import type { WorkspaceSurface } from "./types.js";

export interface SelectionSnapshot {
  readonly featureId: string | null;
  readonly requirementId: string | null;
  readonly taskId: string | null;
  readonly conflictId: string | null;
  readonly cellId: string | null;
  readonly decisionId: string | null;
  readonly activeTab: WorkspaceSurface;
}

export interface SelectionUpdate {
  readonly featureId?: string | null;
  readonly requirementId?: string | null;
  readonly taskId?: string | null;
  readonly conflictId?: string | null;
  readonly cellId?: string | null;
  readonly decisionId?: string | null;
  readonly tab?: WorkspaceSurface;
}

export class CrossTabSelectionContext {
  featureId: string | null = null;
  requirementId: string | null = null;
  taskId: string | null = null;
  conflictId: string | null = null;
  cellId: string | null = null;
  decisionId: string | null = null;
  activeTab: WorkspaceSurface = "spec";

  select(update: SelectionUpdate): void {
    if (update.featureId !== undefined) this.featureId = update.featureId;
    if (update.requirementId !== undefined) this.requirementId = update.requirementId;
    if (update.taskId !== undefined) this.taskId = update.taskId;
    if (update.conflictId !== undefined) this.conflictId = update.conflictId;
    if (update.cellId !== undefined) this.cellId = update.cellId;
    if (update.decisionId !== undefined) this.decisionId = update.decisionId;
    if (update.tab !== undefined) this.activeTab = update.tab;
  }

  switchTab(tab: WorkspaceSurface): void {
    this.activeTab = tab;
  }

  snapshot(): SelectionSnapshot {
    return {
      featureId: this.featureId,
      requirementId: this.requirementId,
      taskId: this.taskId,
      conflictId: this.conflictId,
      cellId: this.cellId,
      decisionId: this.decisionId,
      activeTab: this.activeTab,
    };
  }
}
