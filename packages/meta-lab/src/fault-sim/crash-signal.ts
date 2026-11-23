import type { TxBoundaryHook } from "./types.js";

export type CrashFaultPoint = TxBoundaryHook;

/** Simulated power-loss / SIGKILL at a transaction boundary. */
export class CrashSignal extends Error {
  readonly point: TxBoundaryHook;

  constructor(point: TxBoundaryHook) {
    super(`crash:${point}`);
    this.name = "CrashSignal";
    this.point = point;
  }
}