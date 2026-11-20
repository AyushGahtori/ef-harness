import { asNumber, asRecord, asStringArray } from "./sql.js";
import type {
  MergeContractVerified,
  MergeDiffstat,
  MergeExportChange,
  MergeInstructionsV1,
} from "./types.js";

export interface MergeInstructionsInput {
  readonly task: string;
  readonly commit: string;
  readonly payload: unknown;
  readonly receipt: string;
  readonly contractsVerified: readonly MergeContractVerified[];
}

export class MergeInstructionsBuilder {
  build(input: MergeInstructionsInput): MergeInstructionsV1 {
    return buildMergeInstructions(input);
  }
}

export function buildMergeInstructions(input: MergeInstructionsInput): MergeInstructionsV1 {
  if (!input.task) throw new Error("merge instructions require a task");
  if (!input.commit) throw new Error("merge instructions require a commit");
  if (!input.receipt) throw new Error("merge instructions require a receipt");
  const payload = asRecord(input.payload);
  const packet: MergeInstructionsV1 = {
    schema: "merge-instructions@1",
    task: input.task,
    commit: input.commit,
    diffstat: readDiffstat(payload),
    exports_changed: readExports(payload),
    dependency_intents: readUnknownArray(payload, "dependency_intents"),
    migration_intents: readUnknownArray(payload, "migration_intents"),
    wiring_needs: readUnknownArray(payload, "wiring_needs"),
    contracts_verified:
      input.contractsVerified.length > 0
        ? input.contractsVerified
        : readContracts(payload),
    receipt: input.receipt,
  };
  assertMergeInstructions(packet);
  return packet;
}

export function assertMergeInstructions(packet: MergeInstructionsV1): void {
  if (packet.schema !== "merge-instructions@1") {
    throw new Error("merge instructions schema must be merge-instructions@1");
  }
  if (!Number.isInteger(packet.diffstat.files) || packet.diffstat.files < 0) {
    throw new Error("merge instructions diffstat.files must be a non-negative integer");
  }
  if (!Number.isInteger(packet.diffstat.insertions) || packet.diffstat.insertions < 0) {
    throw new Error("merge instructions diffstat.insertions must be a non-negative integer");
  }
  if (!Number.isInteger(packet.diffstat.deletions) || packet.diffstat.deletions < 0) {
    throw new Error("merge instructions diffstat.deletions must be a non-negative integer");
  }
  for (const change of packet.exports_changed) {
    if (!change.symbol || !change.kind) {
      throw new Error("merge instructions exports_changed entries require symbol and kind");
    }
  }
  for (const contract of packet.contracts_verified) {
    if (!contract.id || !Number.isInteger(contract.v) || contract.v < 1) {
      throw new Error("merge instructions contracts_verified entries require id and version");
    }
  }
}

function readDiffstat(payload: Record<string, unknown> | null): MergeDiffstat {
  const diffstat = asRecord(payload?.diffstat);
  const changedPaths = asStringArray(payload?.changed_paths);
  const files = integerOr(diffstat?.files, changedPaths.length);
  const insertions = integerOr(diffstat?.insertions, 0);
  const deletions = integerOr(diffstat?.deletions, 0);
  return { files, insertions, deletions };
}

function integerOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return fallback;
}

function readExports(payload: Record<string, unknown> | null): MergeExportChange[] {
  const value = payload?.exports_changed;
  if (!Array.isArray(value)) return [];
  const exportsChanged: MergeExportChange[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const symbol = typeof record.symbol === "string" ? record.symbol : "";
    const kind = typeof record.kind === "string" ? record.kind : "";
    if (!symbol || !kind) continue;
    exportsChanged.push({ symbol, kind });
  }
  return exportsChanged;
}

function readUnknownArray(payload: Record<string, unknown> | null, key: string): unknown[] {
  const value = payload?.[key];
  return Array.isArray(value) ? [...value] : [];
}

function readContracts(payload: Record<string, unknown> | null): MergeContractVerified[] {
  const value = payload?.contracts_verified;
  if (!Array.isArray(value)) return [];
  const contracts: MergeContractVerified[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string") continue;
    const version = record.v;
    if (typeof version !== "number" || !Number.isInteger(version)) continue;
    contracts.push({ id: record.id, v: asNumber(version, "contracts_verified.v") });
  }
  return contracts;
}

export function receiptFromResults(
  receipts: readonly (string | null)[],
  explicit: string | undefined,
  attempt: string,
): string {
  if (explicit) return explicit;
  const distinct = [...new Set(receipts.filter((item): item is string => Boolean(item)))].sort();
  if (distinct.length === 1) return distinct[0] ?? `VR-${attempt}`;
  return `VR-${attempt}`;
}
