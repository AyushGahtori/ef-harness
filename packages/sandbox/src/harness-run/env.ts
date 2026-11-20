import fs from "node:fs";
import path from "node:path";

const SAFE_PARENT_KEYS = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "SYSTEMDRIVE",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
] as const;

export function buildScrubbedEnv(
  parent: NodeJS.ProcessEnv,
  attemptTemp: string,
): Record<string, string> {
  const tempDir = path.join(attemptTemp, "tmp");
  const cacheDir = path.join(attemptTemp, "cache");
  const configDir = path.join(attemptTemp, "config");
  const appData = path.join(attemptTemp, "appdata");
  const localAppData = path.join(attemptTemp, "localappdata");
  for (const dir of [attemptTemp, tempDir, cacheDir, configDir, appData, localAppData]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const env: Record<string, string> = {};
  for (const key of SAFE_PARENT_KEYS) {
    const value = parent[key];
    if (typeof value === "string" && value.length > 0 && !value.includes("\0")) {
      env[key] = value;
    }
  }
  const parsed = path.parse(attemptTemp);
  const homeDrive = parsed.root.replace(/\\$/, "") || parsed.root;
  let homePath = attemptTemp.slice(parsed.root.length);
  if (!homePath.startsWith("\\") && !homePath.startsWith("/")) {
    homePath = `${path.sep}${homePath}`;
  }
  env.HOME = attemptTemp;
  env.USERPROFILE = attemptTemp;
  env.HOMEDRIVE = homeDrive;
  env.HOMEPATH = homePath;
  env.TEMP = tempDir;
  env.TMP = tempDir;
  env.XDG_CACHE_HOME = cacheDir;
  env.XDG_CONFIG_HOME = configDir;
  env.APPDATA = appData;
  env.LOCALAPPDATA = localAppData;
  return env;
}

export function envEntries(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter((entry) => !entry[1].includes("\0") && !entry[0].includes("="))
    .map(([key, value]) => `${key}=${value.replaceAll("\r", "").replaceAll("\n", " ")}`);
}

export function markNodeModulesReadOnly(worktreePath: string): void {
  const nodeModules = path.join(worktreePath, "node_modules");
  if (!fs.existsSync(nodeModules)) return;
  try {
    fs.chmodSync(nodeModules, 0o555);
  } catch {
    // The tier provider owns the real ACL. The binding still reports read-only.
  }
}
