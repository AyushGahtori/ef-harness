export const LISTENS_ON_LOCALHOST = false;
export const SHUTDOWN_PATH = "/lifecycle/shutdown";
export const POWER_PATH = "/lifecycle/power";
export const DRAIN_BUDGET_MS = 10_000;
export const IDLE_DRAIN_BUDGET_MS = 1_000;

export type ShutdownMode = "drain_and_exit" | "detach_ui_keep_running";
export type WalCheckpointMode = "PASSIVE" | "TRUNCATE";

export interface WalCheckpointResult {
  readonly busy: number;
  readonly log: number;
  readonly checkpointed: number;
}

export interface LifecycleShutdownRequest {
  readonly mode: ShutdownMode;
  readonly reason: string;
  readonly deadlineMs?: number;
  readonly idle?: boolean;
}

export interface LifecycleShutdownResponse {
  readonly ok: true;
  readonly mode: ShutdownMode;
  readonly exited: boolean;
  readonly daemonKeptRunning: boolean;
  readonly orphanedProcesses: 0;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
  readonly stateDbIntact: true;
  readonly walModes: readonly WalCheckpointMode[];
  readonly buildsInterrupted: boolean;
  readonly uiDetached: boolean;
}

export type LifecyclePowerEvent =
  | { readonly type: "suspend"; readonly at: number }
  | {
      readonly type: "resume";
      readonly at: number;
      readonly sleepDurationMs: number;
      readonly resumeClaiming: boolean;
    }
  | { readonly type: "shutdown"; readonly at: number }
  | {
      readonly type: "on-battery";
      readonly batteryPercent: number | null;
      readonly ecoOnBattery: boolean;
    }
  | { readonly type: "on-ac"; readonly ecoOnBattery: boolean }
  | { readonly type: "lock-screen"; readonly at: number }
  | { readonly type: "unlock-screen"; readonly at: number };

export interface LifecycleRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

export type LifecycleRouteResult =
  | { readonly status: 200; readonly body: LifecycleShutdownResponse | { readonly ok: true } }
  | { readonly status: 400 | 404 | 405; readonly body: { readonly ok: false; readonly error: string } };
