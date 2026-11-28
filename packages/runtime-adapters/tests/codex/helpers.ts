import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nodeSpawn, signalProcess, type SpawnRequest } from "../../src/codex/process.js";
import type { CodexConnection } from "../../src/codex/types.js";

export const appServerScript = fileURLToPath(new URL("./fake-app-server.mjs", import.meta.url));
export const acpScript = fileURLToPath(new URL("./fake-codex-acp.mjs", import.meta.url));

export interface SpawnRecord {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly pid: number;
}

export function siwc(expiresAtMs = Date.now() + 3_600_000): CodexConnection {
  return {
    kind: "sign_in_with_chatgpt",
    connectionId: "chatgpt-plus",
    accessToken: "siwc-access-1",
    expiresAtMs,
  };
}

export function apiKeyConnection(): CodexConnection {
  return {
    kind: "openai_api_key",
    connectionId: "openai-api",
    apiKey: "api-key-1",
  };
}

export function makeWorkspace(): {
  root: string;
  userHome: string;
  codexHomeRoot: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "ef-codex-wt-"));
  const userHome = mkdtempSync(path.join(os.tmpdir(), "ef-codex-user-"));
  const codexHomeRoot = mkdtempSync(path.join(os.tmpdir(), "ef-codex-home-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "ok.ts"), "export const value = 1;\n");
  const personal = path.join(userHome, ".codex");
  mkdirSync(personal, { recursive: true });
  writeFileSync(path.join(personal, "config.toml"), "personal = true\n");
  writeFileSync(path.join(personal, "auth.json"), "personal-auth\n");
  return {
    root,
    userHome,
    codexHomeRoot,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(userHome, { recursive: true, force: true });
      rmSync(codexHomeRoot, { recursive: true, force: true });
    },
  };
}

export function recordingSpawn(
  records: SpawnRecord[],
  extra: (input: SpawnRequest) => NodeJS.ProcessEnv,
): (input: SpawnRequest) => ReturnType<typeof nodeSpawn> {
  return (input) => {
    const proc = nodeSpawn({
      ...input,
      env: { ...input.env, ...extra(input) },
    });
    records.push({
      command: input.command,
      args: input.args,
      env: { ...input.env },
      cwd: input.cwd,
      pid: proc.pid,
    });
    return proc;
  };
}

export function killRecords(records: readonly SpawnRecord[]): void {
  for (const record of records) signalProcess(record.pid);
}

export function killPidFile(file: string): void {
  if (!existsSync(file)) return;
  const pid = Number(readFileSync(file, "utf8").trim());
  if (Number.isInteger(pid) && pid > 0) signalProcess(pid);
}

export async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for the fake codex process");
    await new Promise((resolve) => {
      setTimeout(resolve, 15);
    });
  }
}

export function readLog(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : "";
    return code !== "ESRCH" && code !== "EINVAL";
  }
}
