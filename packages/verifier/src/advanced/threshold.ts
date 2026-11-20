export interface ProductQualityDecisionNode {
  readonly id: string;
  readonly version: number;
  readonly minPassed: number;
  readonly total: number;
  readonly maxCriticalFailures: number;
}

export function assertThreshold(node: ProductQualityDecisionNode): void {
  if (!Number.isInteger(node.version) || node.version < 1) {
    throw new Error("quality threshold version must be a positive integer");
  }
  if (!Number.isInteger(node.total) || node.total < 10 || node.total > 30) {
    throw new Error("quality threshold total must be an integer from 10 to 30");
  }
  if (!Number.isInteger(node.minPassed) || node.minPassed < 0 || node.minPassed > node.total) {
    throw new Error("quality threshold minPassed must sit inside the eval set");
  }
  if (!Number.isInteger(node.maxCriticalFailures) || node.maxCriticalFailures < 0) {
    throw new Error("quality threshold maxCriticalFailures must be a non-negative integer");
  }
}
