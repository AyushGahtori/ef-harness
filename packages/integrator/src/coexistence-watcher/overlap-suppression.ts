import type { OverlapChoice } from "./constants.js";

export interface OverlapSuppressionKey {
  readonly filePath: string;
  readonly taskId: string;
}

export class OverlapSuppressionCache {
  private readonly decisions = new Map<string, OverlapChoice>();

  private key(filePath: string, taskId: string): string {
    return `${filePath}\0${taskId}`;
  }

  remember(filePath: string, taskId: string, choice: OverlapChoice): void {
    if (choice === "take_over") return;
    this.decisions.set(this.key(filePath, taskId), choice);
  }

  isSuppressed(filePath: string, taskId: string): boolean {
    const choice = this.decisions.get(this.key(filePath, taskId));
    return choice === "keep_both" || choice === "ignore";
  }
}