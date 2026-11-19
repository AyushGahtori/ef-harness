import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { scrubbedEnv, spawnCollect } from "./process-run.js";
import { redactPreview } from "./secret-rules.js";
import { DEFAULT_COMMAND_TIMEOUT_MS } from "./types.js";
import type { GitleaksRunStatus, VaultSecret } from "./types.js";

export interface GitleaksHit {
  readonly file: string;
  readonly line: number;
  readonly ruleId: string;
  readonly preview: string;
  readonly suppressible: boolean;
}

export interface GitleaksExecution {
  readonly status: GitleaksRunStatus;
  readonly hits: readonly GitleaksHit[];
}

function joined(...parts: readonly string[]): string {
  return parts.join("");
}

export function absentGitleaks(): GitleaksRunStatus {
  return {
    available: false,
    exitCode: null,
    outcome: "absent",
    repairSignal: false,
    timedOut: false,
  };
}

export function cleanGitleaks(available: boolean, exitCode: number | null = 0): GitleaksRunStatus {
  return {
    available,
    exitCode,
    outcome: "clean",
    repairSignal: false,
    timedOut: false,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveGitleaksBinary(explicit?: string): Promise<string | undefined> {
  if (explicit !== undefined) {
    return explicit.length > 0 && (await exists(explicit)) ? explicit : undefined;
  }
  const names = process.platform === "win32" ? ["gitleaks.exe"] : ["gitleaks"];
  const candidates: string[] = [];
  const fromEnv = process.env.EF_HARNESS_GITLEAKS;
  if (typeof fromEnv === "string" && fromEnv.length > 0) candidates.push(fromEnv);
  const resources = electronResourcesPath();
  if (resources) {
    for (const name of names) {
      candidates.push(path.join(resources, "gitleaks", name));
      candidates.push(path.join(resources, name));
    }
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

function electronResourcesPath(): string | undefined {
  const candidate = process as NodeJS.Process & { resourcesPath?: string };
  return typeof candidate.resourcesPath === "string" ? candidate.resourcesPath : undefined;
}

function livePrefix(): string {
  return joined("sk", "_live_");
}

function readField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readLine(record: Record<string, unknown>): number {
  const value = record.StartLine ?? record.startLine ?? record.Line;
  const line = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(line) || line < 1) return 1;
  return Math.floor(line);
}

function asRecords(parsed: unknown): readonly Record<string, unknown>[] | undefined {
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const nested = record.findings ?? record.Leaks ?? record.leaks;
  if (!Array.isArray(nested)) return undefined;
  return nested.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

function hitFromRecord(
  record: Record<string, unknown>,
  vaultSecrets: readonly VaultSecret[],
  pathMap: ReadonlyMap<string, string>,
): GitleaksHit | undefined {
  const rawFile = readField(record, "File") || readField(record, "file");
  const mapped = pathMap.get(rawFile) ?? pathMap.get(path.normalize(rawFile)) ?? rawFile;
  const file = mapped.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!file) return undefined;
  const secret = readField(record, "Secret") || readField(record, "Match") || readField(record, "secret");
  const rule = readField(record, "RuleID") || readField(record, "rule") || "gitleaks";
  const vault = vaultSecrets.some((item) => item.value.length >= 8 && secret.includes(item.value));
  const live = secret.startsWith(livePrefix());
  const preview = secret.length > 0 ? redactPreview(secret) : "****...****";
  return {
    file,
    line: readLine(record),
    ruleId: rule.startsWith("gitleaks:") ? rule : `gitleaks:${rule}`,
    preview,
    suppressible: !live && !vault,
  };
}

export async function runGitleaksDetect(input: {
  readonly command: string;
  readonly argsPrefix?: readonly string[];
  readonly source: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly vaultSecrets?: readonly VaultSecret[];
  readonly pathMap?: ReadonlyMap<string, string>;
}): Promise<GitleaksExecution> {
  const reportPath = path.join(
    tmpdir(),
    `ef-gitleaks-${process.pid}-${randomBytes(8).toString("hex")}.json`,
  );
  const args = [
    ...(input.argsPrefix ?? []),
    "detect",
    "--no-git",
    "--source",
    input.source,
    "--report-format",
    "json",
    "--report-path",
    reportPath,
  ];
  try {
    const result = await spawnCollect(input.command, args, {
      cwd: tmpdir(),
      timeoutMs: input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      env: scrubbedEnv(input.env),
    });
    if (result.timedOut || result.exitCode === null || result.exitCode > 1) {
      return {
        status: {
          available: true,
          exitCode: result.exitCode,
          outcome: "crashed",
          repairSignal: true,
          timedOut: result.timedOut,
        },
        hits: [],
      };
    }
    if (result.exitCode === 0) {
      return { status: cleanGitleaks(true, 0), hits: [] };
    }
    let parsed: unknown;
    try {
      const text = await readFile(reportPath, "utf8");
      parsed = JSON.parse(text) as unknown;
    } catch {
      return {
        status: {
          available: true,
          exitCode: result.exitCode,
          outcome: "crashed",
          repairSignal: true,
          timedOut: false,
        },
        hits: [],
      };
    }
    const records = asRecords(parsed);
    if (!records) {
      return {
        status: {
          available: true,
          exitCode: result.exitCode,
          outcome: "crashed",
          repairSignal: true,
          timedOut: false,
        },
        hits: [],
      };
    }
    const pathMap = input.pathMap ?? new Map<string, string>();
    const hits: GitleaksHit[] = [];
    for (const record of records) {
      const hit = hitFromRecord(record, input.vaultSecrets ?? [], pathMap);
      if (hit) hits.push(hit);
    }
    return {
      status: {
        available: true,
        exitCode: 1,
        outcome: hits.length > 0 ? "findings" : "clean",
        repairSignal: false,
        timedOut: false,
      },
      hits,
    };
  } finally {
    await rm(reportPath, { force: true });
  }
}

export async function stageFiles(input: {
  readonly root: string;
  readonly relativeFiles: readonly string[];
}): Promise<{ readonly directory: string; readonly pathMap: Map<string, string>; readonly cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), "ef-gitleaks-stage-"));
  const pathMap = new Map<string, string>();
  for (const relative of input.relativeFiles) {
    const from = path.join(input.root, relative);
    const to = path.join(directory, relative);
    await mkdir(path.dirname(to), { recursive: true });
    try {
      await symlink(from, to, "file");
    } catch {
      await copyFile(from, to);
    }
    pathMap.set(to, relative.replaceAll("\\", "/"));
    pathMap.set(path.resolve(to), relative.replaceAll("\\", "/"));
    pathMap.set(relative.replaceAll("\\", "/"), relative.replaceAll("\\", "/"));
  }
  return {
    directory,
    pathMap,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function writeDiffStage(
  files: readonly { readonly path: string; readonly text: string }[],
): Promise<{ readonly directory: string; readonly pathMap: Map<string, string>; readonly cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), "ef-gitleaks-diff-"));
  const pathMap = new Map<string, string>();
  for (const file of files) {
    const relative = file.path.replaceAll("\\", "/");
    const to = path.join(directory, relative);
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, file.text, "utf8");
    pathMap.set(to, relative);
    pathMap.set(path.resolve(to), relative);
    pathMap.set(relative, relative);
  }
  return {
    directory,
    pathMap,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
