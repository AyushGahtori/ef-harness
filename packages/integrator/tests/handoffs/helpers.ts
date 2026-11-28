import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PutHandoffInput } from "../../src/handoffs/index.js";

export const BASE = "a".repeat(40);
export const SLICE = "b".repeat(64);
export const BASE_NEXT = "c".repeat(40);
export const SLICE_NEXT = "d".repeat(64);

export function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "ef-handoff-")), "state.db");
}

export function clock(start = 1_700_000_000_000): {
  now(): number;
  set(value: number): void;
  advance(ms: number): void;
} {
  let current = start;
  return {
    now() {
      return current;
    },
    set(value: number) {
      current = value;
    },
    advance(ms: number) {
      current += ms;
    },
  };
}

export function handoffInput(handoffId: string, patch: Partial<PutHandoffInput> = {}): PutHandoffInput {
  return {
    handoffId,
    fromRole: "planner",
    toRole: "worker:T-1",
    fromTaskId: "planner-task",
    toTaskId: "T-1",
    artifactType: "planner_to_worker",
    pinnedBaseCommitSha: BASE,
    pinnedSliceSha256: SLICE,
    schemaVersion: 1,
    summary: { headline: "order totals" },
    payload: Buffer.from("totals-v1"),
    ...patch,
  };
}

export function trace(bytes: number): Uint8Array {
  const payload = new Uint8Array(bytes);
  for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
  return payload;
}
