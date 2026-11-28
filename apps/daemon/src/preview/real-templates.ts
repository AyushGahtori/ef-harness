import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WindowsJobObjectManager } from "@ef-harness/sandbox";
import {
  ServiceProviderRegistry,
  TemplateDatabaseManager,
  TestEnvOrchestrator,
  type CreateJobRequest,
  type EnvProcessStore,
  type JobAccounting,
  type EnvProcessRecord,
  type JobHandle,
  type OrphanReconcileReport,
  type PortLeaseRecord,
  type PortLeaseStore,
  type WindowsJobManager,
} from "@ef-harness/test-env";
import type { TemplateCloneResult, TemplateDbSeeder, TestEnvOrchestrator as PreviewTestEnv } from "./ports.js";

const SEED_SQL = `
CREATE TABLE demo_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO demo_meta (key, value) VALUES ('seed', 'functional');
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  note TEXT NOT NULL
);
CREATE TABLE _ef_preview_migrations (
  id TEXT PRIMARY KEY,
  sql TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL
);
`;

export class RealPreviewTemplates implements TemplateDbSeeder, PreviewTestEnv {
  private readonly manager: TemplateDatabaseManager;
  private readonly orchestrator: TestEnvOrchestrator;

  constructor(
    private readonly root: string,
    projectId: string,
  ) {
    if (process.getMaxListeners() < 64) process.setMaxListeners(64);
    this.manager = new TemplateDatabaseManager({
      projectId,
      rootDir: path.join(root, "template-manager"),
      dialect: "sqlite",
    });
    const jobs = new WindowsJobObjectManager({
      stateDbPath: path.join(root, "template-jobs.sqlite"),
    });
    this.orchestrator = new TestEnvOrchestrator({
      projectId,
      portLeases: new MemoryPortLeaseStore(),
      envProcesses: new MemoryEnvProcessStore(),
      jobs: new ReconcileJobBridge(jobs),
      providers: new ServiceProviderRegistry(),
    });
    void this.manager
      .ensureTemplate({
        migrations: [SEED_SQL],
        seedRecipe: {},
        schema: { dialect: "sqlite", tables: [] },
      })
      .catch(() => undefined);
    void this.orchestrator
      .reconcileOnStartup({ liveEnvironmentIds: [], workspaceRoots: [] })
      .catch(() => undefined);
  }

  snapshotPath(projectId: string): string {
    this.manager.stats();
    return path.join(this.root, "seed-snapshots", projectId, "functional.sqlite");
  }

  cloneFunctionalSeed(projectId: string, destPath: string): TemplateCloneResult {
    const snapshotPath = this.snapshotPath(projectId);
    if (path.resolve(snapshotPath) === path.resolve(destPath)) {
      throw new Error("refusing to clone a seed snapshot onto itself");
    }
    if (!fs.existsSync(snapshotPath)) writeSeedFile(snapshotPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(snapshotPath, destPath);
    return { snapshotId: `${projectId}:functional`, snapshotPath };
  }

  templateDatabasePath(projectId: string): string {
    return path.join(this.root, "test-templates", projectId, "tpl_functional.sqlite");
  }

  ensureTemplate(projectId: string): string {
    const file = this.templateDatabasePath(projectId);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "test-template-not-preview\n", "utf8");
    }
    return file;
  }
}

class ReconcileJobBridge implements WindowsJobManager {
  constructor(private readonly jobs: WindowsJobObjectManager) {}

  createJob(request: CreateJobRequest): never {
    void request;
    throw new Error("preview template reconcile does not create a nested job");
  }

  assignProcess(job: JobHandle, pid: number): void {
    void job;
    void pid;
  }

  queryJobAccounting(job: JobHandle): JobAccounting {
    void job;
    throw new Error("preview template reconcile does not read job accounting");
  }

  async terminateJob(job: JobHandle): Promise<void> {
    void job;
  }

  async reconcileOrphanedProcesses(): Promise<OrphanReconcileReport> {
    await this.jobs.reconcileOrphanedProcesses();
    return { terminated: [], skipped: [] };
  }
}

class MemoryPortLeaseStore implements PortLeaseStore {
  leaseNext(input: Parameters<PortLeaseStore["leaseNext"]>[0]): number | null {
    void input;
    return null;
  }

  release(): boolean {
    return false;
  }

  releaseEnvironment(): number[] {
    return [];
  }

  list(): PortLeaseRecord[] {
    return [];
  }

  releaseLeasesForDeadEnvironments(): number[] {
    return [];
  }
}

class MemoryEnvProcessStore implements EnvProcessStore {
  insert(): void {
    return undefined;
  }

  delete(): void {
    return undefined;
  }

  deleteEnvironment(): void {
    return undefined;
  }

  list(): EnvProcessRecord[] {
    return [];
  }

  listByEnvironment(): EnvProcessRecord[] {
    return [];
  }
}

function writeSeedFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec(SEED_SQL);
  db.close();
}
