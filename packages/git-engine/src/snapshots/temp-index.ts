import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const TEMP_FILE = /^snapshot-[0-9a-f-]{36}\.(index|message)(\.lock)?$/i;

export function defaultHarnessTmp(env: NodeJS.ProcessEnv = process.env): string {
  const localAppData = env.LOCALAPPDATA;
  if (typeof localAppData === "string" && localAppData.trim()) {
    return path.join(localAppData, "EFHarness", "tmp");
  }
  return path.join(os.tmpdir(), "EFHarness", "tmp");
}

export function allocateTempIndex(harnessTmp: string): { indexFile: string; messageFile: string } {
  const id = randomUUID();
  return {
    indexFile: path.join(harnessTmp, `snapshot-${id}.index`),
    messageFile: path.join(harnessTmp, `snapshot-${id}.message`),
  };
}

/**
 * Removes leftover temporary index files from a previous process.
 * Fresh files younger than `maxAgeMs` stay so a concurrent snapshot is left alone.
 */
export async function sweepStaleTempIndexes(harnessTmp: string, maxAgeMs: number): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(harnessTmp);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return [];
    throw error;
  }
  const removed: string[] = [];
  const now = Date.now();
  for (const name of names) {
    if (!TEMP_FILE.test(name)) continue;
    const full = path.join(harnessTmp, name);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) continue;
    if (now - info.mtimeMs < maxAgeMs) continue;
    await rm(full, { force: true });
    removed.push(full);
  }
  return removed;
}

export async function makeHarnessTmp(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "ef-harness-snap-"));
}
