import os from "node:os";
import path from "node:path";

export function defaultHarnessHome(): string {
  const configured = process.env.EF_HARNESS_HOME;
  if (configured && configured.trim().length > 0) return path.resolve(configured);
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && localAppData.trim().length > 0) {
    return path.join(localAppData, "EFHarness");
  }
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Local", "EFHarness");
  }
  return path.join(os.homedir(), ".ef-harness");
}

export function defaultLogDirectory(): string {
  return path.join(defaultHarnessHome(), "logs");
}

export function defaultTraceDirectory(): string {
  return path.join(defaultLogDirectory(), "traces");
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
