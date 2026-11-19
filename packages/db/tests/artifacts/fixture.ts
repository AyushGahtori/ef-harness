import fs from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  ArtifactManager,
  type ArtifactLogEvent,
  type ArtifactLogger,
} from "../../src/artifacts/artifact-manager.js";
import type { DatabaseSync as StateDb } from "node:sqlite";
import { SqliteCasBlobStore } from "./sqlite-cas-blob-store.js";

export interface Fixture {
  readonly state: DatabaseSync;
  readonly globalDb: DatabaseSync;
  readonly cas: SqliteCasBlobStore;
  readonly logs: ArtifactLogEvent[];
  readonly logger: ArtifactLogger;
  manager: ArtifactManager;
  clock: number;
  seedAttempt(id: string, attemptState: string, endedAt: number | null): void;
  close(): void;
}

export function openFixture(options?: { readonly storageCapBytes?: number }): Fixture {
  const state = new DatabaseSync(":memory:");
  state.exec("PRAGMA foreign_keys = ON");
  state.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) => {
    if (value === null || value === undefined) return "";
    return String(value);
  });
  state.exec(fs.readFileSync(canonicalAssetAbsolute("stateSql"), "utf8"));
  const globalDb = new DatabaseSync(":memory:");
  globalDb.exec("PRAGMA foreign_keys = ON");
  globalDb.exec(fs.readFileSync(canonicalAssetAbsolute("globalSql"), "utf8"));
  const cas = new SqliteCasBlobStore(globalDb);
  const logs: ArtifactLogEvent[] = [];
  const logger: ArtifactLogger = { log(event) { logs.push(event); } };
  const fixture = {
    state,
    globalDb,
    cas,
    logs,
    logger,
    clock: 1_700_000_000_000,
    rev: 0,
    manager: undefined as unknown as ArtifactManager,
    seedAttempt(id: string, attemptState: string, endedAt: number | null): void {
      this.rev += 1;
      const rev = this.rev;
      const changeSet = `CS-${id}`;
      const task = `TASK-${id}`;
      state.exec("BEGIN IMMEDIATE");
      try {
        state
          .prepare(
            "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'kernel', 'task-029', 0)",
          )
          .run(changeSet, rev);
        state
          .prepare(
            `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
             VALUES (?, 'task', 1, ?, ?, '', '{}', ?, ?, ?)`,
          )
          .run(task, `hash-${task}`, `Task ${id}`, changeSet, rev, rev);
        state
          .prepare(
            "INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, 'F1', 'READY', 'Mid', ?)",
          )
          .run(task, rev);
        state
          .prepare(
            `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at, ended_at)
             VALUES (?, ?, 1, 1, 1, 'test', 'test-model', 'local', 'abc123', ?, 1, ?)`,
          )
          .run(id, task, attemptState, endedAt);
        state.exec("COMMIT");
      } catch (error) {
        if (state.isTransaction) state.exec("ROLLBACK");
        throw error;
      }
    },
    close(): void {
      state.close();
      globalDb.close();
    },
  };
  fixture.manager = new ArtifactManager({
    stateDb: state,
    globalDb,
    cas,
    projectId: "P-029",
    logger,
    now: () => fixture.clock,
    ...(options?.storageCapBytes !== undefined ? { storageCapBytes: options.storageCapBytes } : {}),
  });
  return fixture;
}

export function countPins(globalDb: StateDb, hash: string): number {
  const row = globalDb.prepare("SELECT count(*) AS c FROM cas_pins WHERE hash = ?").get(hash);
  return typeof row?.c === "number" ? row.c : Number(row?.c ?? 0);
}

export function retentionOf(state: StateDb, artifactId: string): string | null {
  const row = state.prepare("SELECT retention FROM artifacts WHERE id = ?").get(artifactId);
  return typeof row?.retention === "string" ? row.retention : null;
}
