export const packageName = "@ef-harness/governor" as const;
export const layer = 3 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export * as telemetry from "./telemetry/index.js";
export * as admission from "./admission/index.js";
export * as capacityPools from "./capacity-pools/index.js";
export * as vault from "./vault/index.js";
export * as humanSteps from "./human-steps/index.js";

export {
  DiskHeadroomGuard,
  GpuWhisperPriorityArbiter,
  HeavyLaneSemaphore,
  LearnedFootprintStore,
  PressureHysteresisStateMachine,
  openGlobalBrokerPort,
} from "./admission/index.js";
export type { WorkloadFootprintEstimate } from "./admission/index.js";
export {
  WindowsResourceTelemetryCollector,
  openWindowsResourceTelemetryCollector,
} from "./telemetry/index.js";
export { ThreePoolCapacityScheduler } from "./capacity-pools/index.js";
export { applyGovernorPressure } from "./chain.js";
export type { GovernorPressureSinks, GovernorPressureStep } from "./chain.js";
export {
  LiveKeyTestRefusalGuard,
  RuntimeOnlyEnvInjector,
  WindowsDpapiSecretsVault,
} from "./vault/index.js";
export { AttestedVsVerifiedBadgePolicy, HumanStepProbeRegistry, HumanStepStateStore } from "./human-steps/index.js";
