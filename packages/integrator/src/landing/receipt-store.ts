import { randomUUID } from "node:crypto";
import type { LandingReceipt } from "./types.js";

const memory = new Map<string, LandingReceipt>();
const byBranch = new Map<string, string>();

export function persistLandingReceipt(
  partial: Omit<LandingReceipt, "landingId" | "landedAt">,
): LandingReceipt {
  const receipt: LandingReceipt = {
    landingId: randomUUID(),
    landedAt: new Date().toISOString(),
    ...partial,
  };
  memory.set(receipt.landingId, receipt);
  byBranch.set(receipt.targetBranch, receipt.landingId);
  return receipt;
}

export function getLandingReceipt(landingId: string): LandingReceipt | undefined {
  return memory.get(landingId);
}

export function getLatestLandingReceiptForBranch(branch: string): LandingReceipt | undefined {
  const id = byBranch.get(branch);
  return id ? memory.get(id) : undefined;
}

export function clearLandingReceiptStore(): void {
  memory.clear();
  byBranch.clear();
}