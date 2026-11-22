import type { ReceiptDetail, RouteNumber, WrongRouteChoice } from "./types.js";

export interface RouteDispatchResult {
  readonly receipt: MidBuildRouteReceipt;
  readonly route: RouteNumber;
  readonly msgSeq: string;
}

export class MidBuildRouteReceipt {
  readonly wrongRouteLabel = "Wrong route?" as const;

  constructor(
    readonly id: string,
    readonly route: RouteNumber,
    readonly msgSeq: string,
    readonly pill: string,
    readonly detail: ReceiptDetail,
    private readonly onWrongRoute: (choice: WrongRouteChoice) => RouteDispatchResult,
  ) {}

  wrongRoute(targetId: string): RouteDispatchResult {
    return this.onWrongRoute({ receiptId: this.id, route: 2, targetId });
  }
}

export function pauseFeaturePill(title: string, held: number, othersRunning: number): string {
  const workerWord = held === 1 ? "worker" : "workers";
  return `Paused only '${title}' (${held.toString()} ${workerWord} held; ${othersRunning.toString()} others still running)`;
}

export function addedFeaturePill(title: string): string {
  return `Added '${title}' to mini-discovery — build continuing`;
}

export function revivalPill(status: "deferred" | "undone", featureId: string): string {
  return `Reviving ${status} feature ${featureId}`;
}
