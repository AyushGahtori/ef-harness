import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Phase0Error } from "./errors.js";
import type { ActionCard, FoundationManifest, Gate0Receipt, Phase0Plan, TaskStatus } from "./types.js";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS phase0_runs (
  project_id TEXT PRIMARY KEY,
  plan_json TEXT NOT NULL,
  project_kind TEXT NOT NULL,
  registry_offline INTEGER NOT NULL,
  playwright_browser INTEGER NOT NULL,
  status TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS phase0_execution_tasks (
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  integration_sha TEXT,
  unmerged_sha TEXT,
  attempt INTEGER NOT NULL,
  worktree_path TEXT,
  branch TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, task_id)
) STRICT;

CREATE TABLE IF NOT EXISTS phase0_foundation_manifests (
  project_id TEXT PRIMARY KEY,
  gate0_commit_sha TEXT NOT NULL,
  installed_dependencies_hash TEXT NOT NULL,
  template_db_hash TEXT NOT NULL,
  exposed_exports_json TEXT NOT NULL,
  screenshot_cas_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS phase0_gate0_receipts (
  project_id TEXT NOT NULL,
  integration_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, integration_sha, recorded_at)
) STRICT;

CREATE TABLE IF NOT EXISTS phase0_quarantine (
  project_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (project_id, test_id)
) STRICT;

CREATE TABLE IF NOT EXISTS phase0_action_cards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS phase0_artifacts (
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  cas_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, kind, cas_id)
) STRICT;

CREATE TABLE IF NOT EXISTS phase0_install_receipts (
  project_id TEXT PRIMARY KEY,
  lockfile_hash TEXT NOT NULL
) STRICT;
`;

export interface StoredTask {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly integrationSha: string | null;
  readonly unmergedSha: string | null;
  readonly attempt: number;
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

export interface StoredRun {
  readonly projectId: string;
  readonly plan: Phase0Plan;
  readonly projectKind: Phase0Plan["projectKind"];
  readonly registryOffline: boolean;
  readonly playwrightBrowserAvailable: boolean;
  readonly status: string;
}

interface TaskRow {
  task_id: string;
  status: string;
  integration_sha: string | null;
  unmerged_sha: string | null;
  attempt: number;
  worktree_path: string | null;
  branch: string | null;
}

/**
 * Runtime tables for Phase 0 completion, the Gate 0 receipt, and the
 * foundation manifest. `schema/state.sql` is frozen, so these tables are
 * created in the project `state.db` until the integrator folds them in.
 */
export class Phase0StateStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(file: string): Phase0StateStore {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(MIGRATION);
    return new Phase0StateStore(db);
  }

  close(): void {
    this.db.close();
  }

  saveRun(run: StoredRun): void {
    this.db
      .prepare(
        `INSERT INTO phase0_runs (project_id, plan_json, project_kind, registry_offline, playwright_browser, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           plan_json = excluded.plan_json,
           project_kind = excluded.project_kind,
           registry_offline = excluded.registry_offline,
           playwright_browser = excluded.playwright_browser,
           status = excluded.status`,
      )
      .run(
        run.projectId,
        JSON.stringify(run.plan),
        run.projectKind,
        run.registryOffline ? 1 : 0,
        run.playwrightBrowserAvailable ? 1 : 0,
        run.status,
      );
  }

  readRun(projectId: string): StoredRun | null {
    const row = this.db
      .prepare(
        `SELECT project_id, plan_json, project_kind, registry_offline, playwright_browser, status
         FROM phase0_runs WHERE project_id = ?`,
      )
      .get(projectId) as
      | {
          project_id: string;
          plan_json: string;
          project_kind: StoredRun["projectKind"];
          registry_offline: number;
          playwright_browser: number;
          status: string;
        }
      | undefined;
    if (!row) return null;
    return {
      projectId: row.project_id,
      plan: JSON.parse(row.plan_json) as Phase0Plan,
      projectKind: row.project_kind,
      registryOffline: row.registry_offline === 1,
      playwrightBrowserAvailable: row.playwright_browser === 1,
      status: row.status,
    };
  }

  queueIfAbsent(projectId: string, taskId: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO phase0_execution_tasks
           (project_id, task_id, status, integration_sha, unmerged_sha, attempt, worktree_path, branch, updated_at)
         VALUES (?, ?, 'queued', NULL, NULL, 1, NULL, NULL, ?)
         ON CONFLICT(project_id, task_id) DO NOTHING`,
      )
      .run(projectId, taskId, now);
  }

  mark(projectId: string, task: StoredTask, now: number): void {
    this.db
      .prepare(
        `INSERT INTO phase0_execution_tasks
           (project_id, task_id, status, integration_sha, unmerged_sha, attempt, worktree_path, branch, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, task_id) DO UPDATE SET
           status = excluded.status,
           integration_sha = excluded.integration_sha,
           unmerged_sha = excluded.unmerged_sha,
           attempt = excluded.attempt,
           worktree_path = excluded.worktree_path,
           branch = excluded.branch,
           updated_at = excluded.updated_at`,
      )
      .run(
        projectId,
        task.taskId,
        task.status,
        task.integrationSha,
        task.unmergedSha,
        task.attempt,
        task.worktreePath,
        task.branch,
        now,
      );
  }

  getTask(projectId: string, taskId: string): StoredTask | null {
    const row = this.db
      .prepare(
        `SELECT task_id, status, integration_sha, unmerged_sha, attempt, worktree_path, branch
         FROM phase0_execution_tasks WHERE project_id = ? AND task_id = ?`,
      )
      .get(projectId, taskId) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  listTasks(projectId: string): StoredTask[] {
    const rows = this.db
      .prepare(
        `SELECT task_id, status, integration_sha, unmerged_sha, attempt, worktree_path, branch
         FROM phase0_execution_tasks WHERE project_id = ? ORDER BY task_id`,
      )
      .all(projectId) as unknown as TaskRow[];
    return rows.map((row) => mapTask(row));
  }

  saveInstallHash(projectId: string, lockfileHash: string): void {
    this.db
      .prepare(
        `INSERT INTO phase0_install_receipts (project_id, lockfile_hash) VALUES (?, ?)
         ON CONFLICT(project_id) DO UPDATE SET lockfile_hash = excluded.lockfile_hash`,
      )
      .run(projectId, lockfileHash);
  }

  installHash(projectId: string): string | null {
    const row = this.db.prepare(`SELECT lockfile_hash FROM phase0_install_receipts WHERE project_id = ?`).get(projectId) as
      | { lockfile_hash: string }
      | undefined;
    return row?.lockfile_hash ?? null;
  }

  replaceQuarantine(projectId: string, testIds: readonly string[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`DELETE FROM phase0_quarantine WHERE project_id = ?`).run(projectId);
      const insert = this.db.prepare(`INSERT INTO phase0_quarantine (project_id, test_id, reason) VALUES (?, ?, ?)`);
      for (const testId of testIds) insert.run(projectId, testId, "pre_existing_baseline");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  quarantine(projectId: string): string[] {
    const rows = this.db.prepare(`SELECT test_id FROM phase0_quarantine WHERE project_id = ? ORDER BY test_id`).all(projectId) as unknown as {
      test_id: string;
    }[];
    return rows.map((row) => row.test_id);
  }

  saveActionCard(projectId: string, card: ActionCard, now: number): void {
    this.db
      .prepare(`INSERT INTO phase0_action_cards (id, project_id, task_id, message, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(card.id, projectId, card.taskId, card.message, now);
  }

  actionCards(projectId: string): ActionCard[] {
    const rows = this.db
      .prepare(`SELECT id, task_id, message FROM phase0_action_cards WHERE project_id = ? ORDER BY created_at`)
      .all(projectId) as unknown as { id: string; task_id: string; message: string }[];
    return rows.map((row) => ({
      id: row.id,
      kind: "kernel_installer_error",
      taskId: row.task_id,
      message: row.message,
      blocksStage0B: true,
    }));
  }

  saveReceipt(receipt: Gate0Receipt): void {
    const payload = JSON.stringify(receipt);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO phase0_gate0_receipts (project_id, integration_sha, status, payload_json, recorded_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(receipt.projectId, receipt.integrationSha, receipt.status, payload, receipt.recordedAt);
      this.db
        .prepare(
          `INSERT INTO phase0_artifacts (project_id, kind, cas_id, payload_json, created_at)
           VALUES (?, 'gate0_receipt', ?, ?, ?)
           ON CONFLICT(project_id, kind, cas_id) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at`,
        )
        .run(receipt.projectId, receipt.integrationSha, payload, receipt.recordedAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  latestReceipt(projectId: string, integrationSha?: string): Gate0Receipt | null {
    const row = integrationSha
      ? (this.db
          .prepare(
            `SELECT payload_json FROM phase0_gate0_receipts
             WHERE project_id = ? AND integration_sha = ?
             ORDER BY recorded_at DESC LIMIT 1`,
          )
          .get(projectId, integrationSha) as { payload_json: string } | undefined)
      : (this.db
          .prepare(
            `SELECT payload_json FROM phase0_gate0_receipts
             WHERE project_id = ? ORDER BY recorded_at DESC LIMIT 1`,
          )
          .get(projectId) as { payload_json: string } | undefined);
    if (!row) return null;
    return JSON.parse(row.payload_json) as Gate0Receipt;
  }

  saveManifest(projectId: string, manifest: FoundationManifest, now: number): void {
    this.db
      .prepare(
        `INSERT INTO phase0_foundation_manifests
           (project_id, gate0_commit_sha, installed_dependencies_hash, template_db_hash, exposed_exports_json, screenshot_cas_json, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           gate0_commit_sha = excluded.gate0_commit_sha,
           installed_dependencies_hash = excluded.installed_dependencies_hash,
           template_db_hash = excluded.template_db_hash,
           exposed_exports_json = excluded.exposed_exports_json,
           screenshot_cas_json = excluded.screenshot_cas_json,
           recorded_at = excluded.recorded_at`,
      )
      .run(
        projectId,
        manifest.gate0CommitSha,
        manifest.installedDependenciesHash,
        manifest.templateDbHash,
        JSON.stringify(manifest.exposedExportsMap),
        JSON.stringify(manifest.styleguideScreenshotCasIds),
        now,
      );
  }

  manifest(projectId: string): FoundationManifest | null {
    const row = this.db
      .prepare(
        `SELECT gate0_commit_sha, installed_dependencies_hash, template_db_hash, exposed_exports_json, screenshot_cas_json
         FROM phase0_foundation_manifests WHERE project_id = ?`,
      )
      .get(projectId) as
      | {
          gate0_commit_sha: string;
          installed_dependencies_hash: string;
          template_db_hash: string;
          exposed_exports_json: string;
          screenshot_cas_json: string;
        }
      | undefined;
    if (!row) return null;
    return {
      gate0CommitSha: row.gate0_commit_sha,
      installedDependenciesHash: row.installed_dependencies_hash,
      templateDbHash: row.template_db_hash,
      exposedExportsMap: JSON.parse(row.exposed_exports_json) as FoundationManifest["exposedExportsMap"],
      styleguideScreenshotCasIds: JSON.parse(row.screenshot_cas_json) as string[],
    };
  }
}

function mapTask(row: TaskRow): StoredTask {
  if (!isStatus(row.status)) {
    throw new Phase0Error("task_status", `Unknown Phase 0 status ${row.status}`);
  }
  return {
    taskId: row.task_id,
    status: row.status,
    integrationSha: row.integration_sha,
    unmergedSha: row.unmerged_sha,
    attempt: row.attempt,
    worktreePath: row.worktree_path,
    branch: row.branch,
  };
}

function isStatus(value: string): value is TaskStatus {
  return value === "queued" || value === "running" || value === "done" || value === "failed" || value === "blocked";
}
