export const packageName = "@ef-harness/daemon" as const;
export const layer = 5 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  FrameChannelError,
  FrameCodec,
  FrameTooLargeError,
  HarnessDaemon,
  PipeInUseError,
  TASK_PIPELINE,
  buildDetachedHarnessdSpawn,
  createHarnessDaemon,
  defaultPipePath,
  defaultProfileDir,
  generateSessionToken,
  harnessdEntryPath,
  installShutdownSignals,
  optionsFromEnv,
  profileFromLocalAppData,
  readSessionToken,
  resolveDaemonRuntime,
  sanitizeUser,
  spawnDetachedHarnessd,
  startHarnessd,
  timingSafeTokenEqual,
  userPipePath,
  writeSessionToken,
} from "./bootstrap/index.js";
export type {
  DetachedSpawn,
  HarnessdOptions,
  M1View,
  ShutdownReceipt,
} from "./bootstrap/index.js";
export { explainCockpit } from "./cockpit/explain.js";
export type { CockpitExplainResult } from "./cockpit/explain.js";
export { readBoardProjection } from "./cockpit/board-projection.js";
export type { BoardProjection, StateDbBoardRow, ThreePoolCapacitySnapshot } from "./cockpit/board-projection.js";
export { recordHealthMetric } from "./cockpit/telemetry.js";
export { createLivePreviewDaemonRunner } from "./preview/index.js";
export type { CreateLivePreviewOptions } from "./preview/index.js";
export { routeDaemonVisualSteer } from "./preview/visual-steer-service.js";
export type { DaemonVisualSteerRequest, DaemonVisualSteerResult } from "./preview/visual-steer-service.js";
