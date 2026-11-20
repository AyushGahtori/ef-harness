import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ComponentName = "postgres" | "initdb" | "psql" | "mailpit" | "garnet" | "memurai";

const COMPONENT_RELATIVE: Record<ComponentName, string> = {
  postgres: path.join("postgres", "bin", "postgres.exe"),
  initdb: path.join("postgres", "bin", "initdb.exe"),
  psql: path.join("postgres", "bin", "psql.exe"),
  mailpit: path.join("mailpit", "mailpit.exe"),
  garnet: path.join("garnet", "GarnetServer.exe"),
  memurai: path.join("memurai", "memurai.exe"),
};

export function nodeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : "";
  }
  return "";
}

export function isEnoent(error: unknown): boolean {
  return nodeErrorCode(error) === "ENOENT";
}

export function efHarnessHome(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && localAppData.trim().length > 0) {
    return path.join(localAppData, "EFHarness");
  }
  return path.join(os.homedir(), "AppData", "Local", "EFHarness");
}

export function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!cleaned) throw new Error("path segment is empty");
  return cleaned;
}

export function projectServiceDir(home: string, projectId: string, leaf: string): string {
  return path.join(home, "projects", sanitizePathSegment(projectId), "envs", leaf);
}

export function componentBinary(name: ComponentName, home: string = efHarnessHome()): string {
  return path.join(home, "components", COMPONENT_RELATIVE[name]);
}

export function existingComponent(name: ComponentName, home: string = efHarnessHome()): string | null {
  const windowsPath = componentBinary(name, home);
  if (existsSync(windowsPath)) return windowsPath;
  if (windowsPath.endsWith(".exe")) {
    const bare = windowsPath.slice(0, -4);
    if (existsSync(bare)) return bare;
  }
  return null;
}

export function readRedisDecisionText(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, "spikes", "test-services-windows", "REDIS_DECISION.md");
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, "utf8");
      } catch (error) {
        if (isEnoent(error)) return null;
        throw error;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
