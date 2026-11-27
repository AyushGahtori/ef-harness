import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";

/** Stable project id for a planner root so a reopened path sees the same `state.db`. */
export function plannerProjectId(rootDir: string): string {
  return `p${createHash("sha256").update(rootDir).digest("hex").slice(0, 24)}`;
}

export function openPlannerState(rootDir: string): ProjectStateDb {
  mkdirSync(rootDir, { recursive: true });
  return openProjectStateDb({ projectId: plannerProjectId(rootDir), rootDir });
}

export function tempPlannerRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
