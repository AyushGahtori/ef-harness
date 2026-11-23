import type { DriftChoice } from "./types.js";

export interface DriftView {
  readonly nodeId: string;
  readonly title: string;
  readonly baseRevision: number;
  readonly currentDbRevision: number;
  readonly baseValue: string;
  readonly currentValue: string;
  readonly draftValue: string;
  readonly source: string;
}

export class RevisionDriftConflictPrompt {
  readonly message: string;
  readonly diff: {
    readonly baseRevision: number;
    readonly currentDbRevision: number;
    readonly baseValue: string;
    readonly currentValue: string;
    readonly draftValue: string;
  };

  private settled = false;

  constructor(
    readonly id: string,
    readonly view: DriftView,
    private readonly onChoose: (choice: DriftChoice) => void,
  ) {
    this.message = driftMessage(view);
    this.diff = {
      baseRevision: view.baseRevision,
      currentDbRevision: view.currentDbRevision,
      baseValue: view.baseValue,
      currentValue: view.currentValue,
      draftValue: view.draftValue,
    };
  }

  choose(choice: DriftChoice): void {
    if (this.settled) return;
    this.settled = true;
    this.onChoose(choice);
  }
}

export function driftMessage(view: DriftView): string {
  return `${view.title} changed while you were writing (was '${view.baseValue}', now '${view.currentValue}' from ${view.source}) — Apply your edit ('${view.draftValue}') anyway, Keep '${view.currentValue}', or Edit again?`;
}
