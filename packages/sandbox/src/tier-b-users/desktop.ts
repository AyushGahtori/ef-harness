import type { DesktopIsolationPlan } from "./types.js";

export function buildDesktopIsolation(platform: NodeJS.Platform = process.platform): DesktopIsolationPlan {
  if (platform !== "win32") {
    return {
      supported: false,
      applied: false,
      interactive: false,
      windowStation: null,
      desktop: null,
      lpDesktop: null,
      blocksSendInput: false,
      reason: "window_station_requires_windows",
    };
  }
  const windowStation = "EFHarnessSandboxWinSta";
  const desktop = "EFHarnessSandboxDesktop";
  return {
    supported: true,
    applied: true,
    interactive: false,
    windowStation,
    desktop,
    lpDesktop: `${windowStation}\\${desktop}`,
    blocksSendInput: true,
    reason: null,
  };
}
