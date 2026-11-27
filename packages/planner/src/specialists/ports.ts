import { BUDGET_PRESSURE_RATIO } from "./types.js";
import type {
  ReviewerDefectHint,
  StaticAuditReceiptView,
  TasteScreenshot,
} from "./types.js";

/** Local port of Task 059's hint ladder until that branch is wired. */
export interface VerificationHintLadder {
  readonly source: string;
  pushReviewerDefect(defect: ReviewerDefectHint): {
    readonly recorded: true;
    readonly ladderStep: number;
  };
}

/** Local port of the STATIC_AUDIT receipt reader (Tasks 054 and 058/059). */
export interface StaticAuditGate {
  readonly source: string;
  readReceipt(taskId: string): StaticAuditReceiptView | null;
}

/** Local port of Task 057. Task 094 styleguide shots use kind `styleguide`. */
export interface UiPlaywrightContractVerifier {
  readonly source: string;
  captureScreens(screenIds: readonly string[]): readonly TasteScreenshot[];
}

export class MemoryReviewRejectionStore {
  private readonly counts = new Map<string, number>();

  count(taskId: string): number {
    return this.counts.get(taskId) ?? 0;
  }

  record(taskId: string): number {
    const next = this.count(taskId) + 1;
    this.counts.set(taskId, next);
    return next;
  }
}

export class MemoryHintLadder implements VerificationHintLadder {
  readonly source = "local-port:VerificationHintLadder:Task-059";
  readonly pushes: ReviewerDefectHint[] = [];

  pushReviewerDefect(defect: ReviewerDefectHint): { readonly recorded: true; readonly ladderStep: number } {
    this.pushes.push(defect);
    return { recorded: true, ladderStep: this.pushes.length };
  }
}

export class MemoryStaticAuditGate implements StaticAuditGate {
  readonly source = "local-port:StaticAuditGate:Task-054";
  private readonly receipts = new Map<string, StaticAuditReceiptView>();

  put(receipt: StaticAuditReceiptView): void {
    this.receipts.set(receipt.taskId, receipt);
  }

  readReceipt(taskId: string): StaticAuditReceiptView | null {
    return this.receipts.get(taskId) ?? null;
  }
}

export class MemoryUiPlaywrightVerifier implements UiPlaywrightContractVerifier {
  readonly source = "local-port:UiPlaywrightContractVerifier:Task-057";
  readonly shots: TasteScreenshot[] = [];

  captureScreens(screenIds: readonly string[]): readonly TasteScreenshot[] {
    const wanted = new Set(screenIds);
    return this.shots.filter((shot) => wanted.size === 0 || wanted.has(shot.screenId));
  }
}

export type BudgetPressure = "normal" | "high" | "exhausted";

export function budgetPressure(limitUnits: number, spentUnits: number): BudgetPressure {
  if (limitUnits <= 0 || spentUnits >= limitUnits) return "exhausted";
  if (spentUnits / limitUnits >= BUDGET_PRESSURE_RATIO) return "high";
  return "normal";
}

export class MemoryReviewEnvelope {
  spentUnits: number;

  constructor(
    readonly limitUnits: number,
    spentUnits = 0,
  ) {
    this.spentUnits = spentUnits;
  }

  pressure(): BudgetPressure {
    return budgetPressure(this.limitUnits, this.spentUnits);
  }

  charge(units: number): void {
    if (units > 0) this.spentUnits += units;
  }
}
