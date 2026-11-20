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
