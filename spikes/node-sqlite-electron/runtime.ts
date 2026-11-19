import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalAssetAbsolute, repositoryRoot, type CanonicalAssetKey } from "@ef-harness/shared-contracts";

export function spikeDirectory(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function spikeFile(name: string): string {
  return path.join(spikeDirectory(), name);
}

export function repoRoot(): string {
  return repositoryRoot(import.meta.resolve("@ef-harness/shared-contracts"));
}

export function canonicalAsset(key: CanonicalAssetKey): string {
  return canonicalAssetAbsolute(key, import.meta.resolve("@ef-harness/shared-contracts"));
}

export function electronBinary(): string {
  const exe = process.platform === "win32" ? "electron.exe" : "electron";
  const candidate = path.join(repoRoot(), "node_modules", "electron", "dist", exe);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Electron 42+ executable is missing at ${candidate}`);
  }
  return candidate;
}

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function removeDirectorySync(dir: string): void {
  let last: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      last = error;
      sleepSync(25);
    }
  }
  const message = last instanceof Error ? last.message : String(last);
  throw new Error(`failed to remove ${dir}: ${message}`);
}

export interface SpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runProcess(command: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): SpawnResult {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`,
  };
}

export function sqliteAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string) => value.split(".").map((part) => Number(part));
  const left = parse(version);
  const right = parse(minimum);
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SqliteFailure {
  readonly message: string;
  readonly code: string;
  readonly errcode: number;
  readonly errstr: string | undefined;
}

export function readSqliteFailure(error: unknown): SqliteFailure | undefined {
  if (!(error instanceof Error)) return undefined;
  if (!("errcode" in error) || typeof error.errcode !== "number") return undefined;
  if (!("code" in error) || typeof error.code !== "string") return undefined;
  const errstr = "errstr" in error && typeof error.errstr === "string" ? error.errstr : undefined;
  return { message: error.message, code: error.code, errcode: error.errcode, errstr };
}

export function quoteSqlPath(file: string): string {
  return file.replaceAll("\\", "/").replaceAll("'", "''");
}
