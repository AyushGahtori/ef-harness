import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDesktopMain, type ElectronHost } from "./main.js";

function repositoryRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("EF Harness repository root was not found");
}

function loadHost(): ElectronHost {
  const require = createRequire(import.meta.url);
  const loaded: unknown = require("electron");
  if (typeof loaded !== "object" || loaded === null) {
    throw new Error("Launch the M1 viewer with Electron. Plain Node only returns the executable path.");
  }
  return loaded as ElectronHost;
}

function text(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

function numberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const root = repositoryRoot(path.dirname(fileURLToPath(import.meta.url)));
const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const user = os.userInfo().username.replace(/[^A-Za-z0-9._-]/g, "_") || "user";

void startDesktopMain(loadHost(), {
  appVersion: text(process.env.EF_HARNESS_APP_VERSION, "0.0.0"),
  appName: text(process.env.EF_HARNESS_APP_NAME, "EF Harness"),
  profileDir: text(process.env.EF_HARNESS_PROFILE, path.join(local, "EFHarness")),
  pipePath: text(process.env.EF_HARNESS_PIPE, `\\\\.\\pipe\\efharness-${user}`),
  viewerRoot: path.join(root, "apps", "renderer", "src", "m1-viewer"),
  daemonScript: path.join(root, "apps", "daemon", "dist", "bootstrap", "harnessd-main.js"),
  execPath: process.execPath,
  idleMs: numberEnv(process.env.EF_HARNESS_IDLE_MS, 60_000),
  simStepMs: numberEnv(process.env.EF_HARNESS_SIM_STEP_MS, 80),
  sandboxTier: text(process.env.EF_HARNESS_SANDBOX_TIER, "C"),
  diffNote: text(process.env.EF_HARNESS_DIFF_NOTE, "worker note: grouped print rows"),
  simTask: process.env.EF_HARNESS_SIM_TASK !== "0",
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : "M1 viewer failed";
  const profile = process.env.EF_HARNESS_PROFILE;
  const target = profile
    ? path.join(profile, "viewer-fatal.log")
    : path.join(os.tmpdir(), "ef-m1-viewer-fatal.log");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, message);
  process.exitCode = 1;
});
