import { randomUUID } from "node:crypto";
import { openSharedStateFile } from "../shared-state.js";
import type { LandingReceipt } from "./types.js";

let boundStateFile: string | null = null;

export function bindLandingReceiptState(stateFile: string): void {
  boundStateFile = stateFile;
}

export function persistLandingReceipt(
  partial: Omit<LandingReceipt, "landingId" | "landedAt">,
  stateFile: string,
): LandingReceipt {
  bindLandingReceiptState(stateFile);
  const receipt: LandingReceipt = {
    landingId: randomUUID(),
    landedAt: new Date().toISOString(),
    ...partial,
  };
  const db = openSharedStateFile(stateFile);
  try {
    db.prepare(
      `INSERT INTO landing_receipts(
         landing_id, target_branch, pre_land_sha, landed_sha, safety_ref, strategy,
         overlapping_files_json, landed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      receipt.landingId,
      receipt.targetBranch,
      receipt.preLandSha,
      receipt.landedSha,
      receipt.safetyRef,
      receipt.strategy,
      JSON.stringify(receipt.overlappingFilesHandled),
      receipt.landedAt,
    );
  } finally {
    db.close();
  }
  return receipt;
}

export function getLandingReceipt(landingId: string): LandingReceipt | undefined {
  if (!boundStateFile) return undefined;
  return readReceipt(
    `SELECT landing_id, target_branch, pre_land_sha, landed_sha, safety_ref, strategy,
            overlapping_files_json, landed_at
       FROM landing_receipts WHERE landing_id = ?`,
    [landingId],
  );
}

export function getLatestLandingReceiptForBranch(branch: string): LandingReceipt | undefined {
  if (!boundStateFile) return undefined;
  return readReceipt(
    `SELECT landing_id, target_branch, pre_land_sha, landed_sha, safety_ref, strategy,
            overlapping_files_json, landed_at
       FROM landing_receipts
      WHERE target_branch = ?
      ORDER BY landed_at DESC
      LIMIT 1`,
    [branch],
  );
}

export function clearLandingReceiptStore(): void {
  if (!boundStateFile) return;
  const db = openSharedStateFile(boundStateFile);
  try {
    db.prepare("DELETE FROM landing_receipts").run();
  } finally {
    db.close();
  }
}

function readReceipt(sql: string, params: readonly string[]): LandingReceipt | undefined {
  if (!boundStateFile) return undefined;
  const db = openSharedStateFile(boundStateFile);
  try {
    const row = db.prepare(sql).get(...params);
    if (!row || typeof row !== "object") return undefined;
    return rowToReceipt(row as Record<string, unknown>);
  } finally {
    db.close();
  }
}

function rowToReceipt(row: Record<string, unknown>): LandingReceipt {
  return {
    landingId: requiredText(row, "landing_id"),
    targetBranch: requiredText(row, "target_branch"),
    preLandSha: requiredText(row, "pre_land_sha"),
    landedSha: requiredText(row, "landed_sha"),
    safetyRef: requiredText(row, "safety_ref"),
    strategy: requiredText(row, "strategy"),
    overlappingFilesHandled: parsePaths(row.overlapping_files_json),
    landedAt: requiredText(row, "landed_at"),
  };
}

function requiredText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`landing receipt column ${key} is not text`);
  return value;
}

function parsePaths(raw: unknown): readonly string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}
