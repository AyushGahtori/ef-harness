import fs from "node:fs/promises";
import path from "node:path";
import type { SlotKind, SlotStatus } from "./types.js";

export interface SlotRecord {
  slotId: string;
  kind: SlotKind;
  slotPath: string;
  status: SlotStatus;
  taskId: string | null;
  attempt: string | null;
  branch: string | null;
  baseCommit: string;
  lockfileHash: string | null;
  failedAt: number | null;
  purpose: string | null;
  taskPaths: string[];
  sparsePaths: string[];
  preserveIgnored: string[];
  allowlistedConfigFiles: string[];
  vaultNames: string[];
  configSourceRoot: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface IntegrationLeaseRecord {
  holderId: string;
  epoch: number;
}

export interface ProjectState {
  projectId: string;
  projectShortId: string;
  mainRepoPath: string;
  integrationLease: IntegrationLeaseRecord | null;
  slots: SlotRecord[];
}

export function registryPath(projectDir: string): string {
  return path.join(projectDir, "registry.json");
}

export async function readProjectState(projectDir: string): Promise<ProjectState | null> {
  const file = registryPath(projectDir);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`invalid slot registry at ${file}`);
  return parseProjectState(parsed);
}

export async function writeProjectState(projectDir: string, state: ProjectState): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  const file = registryPath(projectDir);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rm(file, { force: true });
  await fs.rename(tmp, file);
}

function parseProjectState(value: Record<string, unknown>): ProjectState {
  if (typeof value.projectId !== "string" || typeof value.projectShortId !== "string") {
    throw new Error("slot registry is missing project identity");
  }
  if (typeof value.mainRepoPath !== "string") throw new Error("slot registry is missing mainRepoPath");
  if (!Array.isArray(value.slots)) throw new Error("slot registry slots must be an array");
  return {
    projectId: value.projectId,
    projectShortId: value.projectShortId,
    mainRepoPath: value.mainRepoPath,
    integrationLease: parseLease(value.integrationLease),
    slots: value.slots.map(parseSlot),
  };
}

function parseLease(value: unknown): IntegrationLeaseRecord | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || typeof value.holderId !== "string" || typeof value.epoch !== "number") {
    throw new Error("slot registry integration lease is invalid");
  }
  return { holderId: value.holderId, epoch: value.epoch };
}

function parseSlot(value: unknown): SlotRecord {
  if (!isRecord(value)) throw new Error("slot registry entry is invalid");
  if (typeof value.slotId !== "string" || typeof value.slotPath !== "string" || typeof value.baseCommit !== "string") {
    throw new Error("slot registry entry is missing identity");
  }
  if (!isSlotKind(value.kind) || !isSlotStatus(value.status)) {
    throw new Error(`slot registry entry ${value.slotId} has an invalid kind or status`);
  }
  return {
    slotId: value.slotId,
    kind: value.kind,
    slotPath: value.slotPath,
    status: value.status,
    taskId: nullableString(value.taskId),
    attempt: nullableString(value.attempt),
    branch: nullableString(value.branch),
    baseCommit: value.baseCommit,
    lockfileHash: nullableString(value.lockfileHash),
    failedAt: typeof value.failedAt === "number" ? value.failedAt : null,
    purpose: nullableString(value.purpose),
    taskPaths: stringArray(value.taskPaths),
    sparsePaths: stringArray(value.sparsePaths),
    preserveIgnored: stringArray(value.preserveIgnored),
    allowlistedConfigFiles: stringArray(value.allowlistedConfigFiles),
    vaultNames: stringArray(value.vaultNames),
    configSourceRoot: nullableString(value.configSourceRoot),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

function stringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("slot registry list field must be an array of strings");
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("slot registry list field must be an array of strings");
    items.push(item);
  }
  return items;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("slot registry field must be a string or null");
  return value;
}

function isSlotKind(value: unknown): value is SlotRecord["kind"] {
  return value === "attempt" || value === "integration" || value === "merge";
}

function isSlotStatus(value: unknown): value is SlotRecord["status"] {
  return value === "active" || value === "free" || value === "failed" || value === "abandoned";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
