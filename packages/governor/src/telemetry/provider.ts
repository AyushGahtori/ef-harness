import type { ActiveJobSlot, CollectorCadence, HardwareSnapshot, UiLatencySample } from "./types.js";

export interface TelemetrySampleRequest {
  readonly sampledAtMs: number;
  readonly cadence: CollectorCadence;
  readonly workspacePath: string;
  readonly appDataPath: string;
  readonly jobs: readonly ActiveJobSlot[];
  readonly ui: UiLatencySample;
}

export interface ResourceTelemetryProvider {
  readonly kind: "win32" | "posix" | "synthetic";
  sample(request: TelemetrySampleRequest): Promise<HardwareSnapshot>;
  close(): Promise<void>;
}
