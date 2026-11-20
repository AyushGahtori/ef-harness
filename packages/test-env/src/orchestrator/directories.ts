import fs from "node:fs/promises";
import path from "node:path";
import { ENV_DIRECTORY_NAME, type EnvironmentDirectories } from "./types.js";

const RETRYABLE = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

export function environmentDirectories(
  worktreePath: string,
  environmentId: string,
): EnvironmentDirectories {
  const root = path.join(worktreePath, ENV_DIRECTORY_NAME, environmentId);
  return {
    root,
    temp: path.join(root, "temp"),
    upload: path.join(root, "upload"),
    buildOutput: path.join(root, "build-output"),
  };
}

export async function createEnvironmentDirectories(
  directories: EnvironmentDirectories,
  marker: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly createdAt: number;
  },
): Promise<void> {
  await fs.mkdir(directories.temp, { recursive: true });
  await fs.mkdir(directories.upload, { recursive: true });
  await fs.mkdir(directories.buildOutput, { recursive: true });
  await fs.writeFile(
    path.join(directories.root, "owned.json"),
    `${JSON.stringify(marker)}\n`,
    "utf8",
  );
}

export async function removeDirectoryWithBusyRetry(
  directory: string,
  options?: {
    readonly attempts?: number;
    readonly delayMs?: number;
    readonly remove?: (directory: string) => Promise<void>;
  },
): Promise<void> {
  const attempts = options?.attempts ?? 8;
  const baseDelay = options?.delayMs ?? 25;
  const remove =
    options?.remove ?? ((target: string) => fs.rm(target, { recursive: true, force: true }));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await remove(directory);
      return;
    } catch (error) {
      lastError = error;
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (!RETRYABLE.has(code) || attempt === attempts - 1) throw error;
      await delay(baseDelay * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("failed to remove directory");
}

export async function removeStaleEnvironmentDirectories(
  workspaceRoots: readonly string[],
  liveEnvironmentIds: ReadonlySet<string>,
): Promise<string[]> {
  const removed: string[] = [];
  for (const root of workspaceRoots) {
    const parent = path.join(root, ENV_DIRECTORY_NAME);
    let entries: string[];
    try {
      entries = await fs.readdir(parent);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const directory = path.join(parent, entry);
      const environmentId = await readOwnedEnvironmentId(directory);
      if (environmentId === null || liveEnvironmentIds.has(environmentId)) continue;
      await removeDirectoryWithBusyRetry(directory);
      removed.push(directory);
    }
  }
  return removed;
}

async function readOwnedEnvironmentId(directory: string): Promise<string | null> {
  try {
    const text = await fs.readFile(path.join(directory, "owned.json"), "utf8");
    const parsed = JSON.parse(text) as { environmentId?: unknown };
    return typeof parsed.environmentId === "string" ? parsed.environmentId : null;
  } catch (error) {
    if (error instanceof Error) return null;
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
