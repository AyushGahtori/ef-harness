import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function sanitizeUser(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "user";
}

/** `\\.\pipe\efharness-<user>` — one pipe per Windows user. */
export function userPipePath(user: string): string {
  return `\\\\.\\pipe\\efharness-${sanitizeUser(user)}`;
}

export function profileFromLocalAppData(localAppData: string): string {
  return path.join(localAppData, "EFHarness");
}

export function defaultProfileDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.EF_HARNESS_PROFILE;
  if (override && override.length > 0) return override;
  const local = env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return profileFromLocalAppData(local);
}

export function defaultPipePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.EF_HARNESS_PIPE;
  if (override && override.length > 0) return override;
  return userPipePath(os.userInfo().username);
}

export function sessionTokenPath(profileDir: string): string {
  return path.join(profileDir, "session.token");
}

export function readyFilePath(profileDir: string): string {
  return path.join(profileDir, "harnessd.ready.json");
}

export function shutdownReceiptPath(profileDir: string): string {
  return path.join(profileDir, "harnessd.shutdown.json");
}

export function lockFilePath(profileDir: string): string {
  return path.join(profileDir, "daemon.lock");
}

export function logFilePath(profileDir: string): string {
  return path.join(profileDir, "logs", "harnessd.jsonl");
}

export function globalDatabasePath(profileDir: string): string {
  return path.join(profileDir, "global.db");
}

export function stateDatabasePath(profileDir: string): string {
  return path.join(profileDir, "projects", "m1", "state.db");
}

export function repositoryRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("EF Harness repository root was not found");
}
