export const packageName = "@ef-harness/desktop" as const;
export const layer = 5 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  ELECTRON_SECURITY_DEFAULTS,
  M1_CONTENT_SECURITY_POLICY,
  M1_PRELOAD_CONTRACT,
  PRELOAD_CJS,
  PRELOAD_EXPOSES,
  callDaemon,
  ensureHarnessd,
  launchDetached,
  probeDaemon,
  startDesktopMain,
} from "./bootstrap/index.js";
export type {
  DaemonProbe,
  DesktopOptions,
  DesktopRuntime,
  DetachedLaunch,
  ElectronHost,
  EnsureHarnessdDeps,
  M1PreloadContract,
} from "./bootstrap/index.js";
