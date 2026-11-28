import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";

const silentLog = {
  info(): void {},
  warn(): void {},
  error(): void {},
};

/** One migrated `state.db` for a unit that does not already hold the daemon writer. */
export function openPrivateProjectState(prefix: string): ProjectStateDb {
  const rootDir = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  const projectId = `${prefix}-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  return openProjectStateDb({
    projectId,
    rootDir,
    appVersion: "0.0.0",
    logger: silentLog,
  });
}
