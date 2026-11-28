import {
  AttemptCheckpointRepo,
  GlobalBrokerDb,
  MigrationRunner,
  connectGlobalBrokerDb,
  openProjectStateDb,
  productionMigrations,
  type AttemptCheckpointWrite,
  type ProjectStateDb,
} from "@ef-harness/db";
import { CheckpointSchemaUpcasterRegistry } from "./checkpoint-schema-upcaster-registry.js";
import type { CheckpointRecord, CheckpointStorePort, MigrationAndRebuildEnginePort, StateDbBackupSnapshot } from "./ports.js";

class LiveAttemptCheckpointStore implements CheckpointStorePort {
  repo: AttemptCheckpointRepo | null = null;

  write(record: CheckpointRecord): void {
    const repo = this.repo;
    if (!repo) throw new Error("attempt checkpoint store is closed");
    repo.write(toAttemptCheckpoint(record));
  }
}

class MigrationCheckpointEngine implements MigrationAndRebuildEnginePort {
  constructor(
    private readonly profileDir: string,
    private readonly appVersion: string,
    private readonly store: LiveAttemptCheckpointStore,
  ) {}

  async createVerifiedBackup(): Promise<StateDbBackupSnapshot> {
    const stateDbPath = projectPath(this.profileDir, this.appVersion);
    const broker = GlobalBrokerDb.open({ root: this.profileDir });
    const globalDbPath = broker.filePath;
    broker.close();
    const globalDb = connectGlobalBrokerDb(globalDbPath);
    const runner = new MigrationRunner({
      globalDbPath,
      globalDb,
      migrations: productionMigrations,
      appVersion: this.appVersion,
      readers: { drainAndClose() {} },
    });
    const outcome = await runner.migrateProject({ id: "m1", stateDbPath });
    if (!outcome.ok) return { verified: false, snapshotPath: outcome.backupPath };
    return { verified: true, snapshotPath: outcome.backupPath ?? stateDbPath };
  }

  async runBackupProtectedTransaction<T>(work: () => Promise<T> | T): Promise<T> {
    const project = openProjectStateDb({
      projectId: "m1",
      rootDir: this.profileDir,
      appVersion: this.appVersion,
    });
    this.store.repo = new AttemptCheckpointRepo(project.writer);
    try {
      return await work();
    } finally {
      this.store.repo = null;
      project.close();
    }
  }
}

export function bindCheckpointUpcaster(profileDir: string, appVersion: string): CheckpointSchemaUpcasterRegistry {
  const store = new LiveAttemptCheckpointStore();
  return new CheckpointSchemaUpcasterRegistry(
    new MigrationCheckpointEngine(profileDir, appVersion, store),
    store,
  );
}

export function createVerifiedCheckpointBackup(
  profileDir: string,
  appVersion: string,
): Promise<StateDbBackupSnapshot> {
  const store = new LiveAttemptCheckpointStore();
  return new MigrationCheckpointEngine(profileDir, appVersion, store).createVerifiedBackup();
}

function projectPath(profileDir: string, appVersion: string): string {
  const project: ProjectStateDb = openProjectStateDb({
    projectId: "m1",
    rootDir: profileDir,
    appVersion,
  });
  try {
    return project.databasePath;
  } finally {
    project.close();
  }
}

function toAttemptCheckpoint(record: CheckpointRecord): AttemptCheckpointWrite {
  const payload = record.payload;
  return {
    attemptId: record.id,
    step: Number.isSafeInteger(record.schemaVersion) && record.schemaVersion >= 0 ? record.schemaVersion : 0,
    wipRef: textOrNull(payload.wipRef),
    sessionRef: textOrNull(payload.sessionRef),
    contractVersions: contractVersions(payload.contractVersions),
    pendingEffects: [],
    handoffArtifact: textOrNull(payload.handoffNote),
    updatedAt: Date.now(),
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function contractVersions(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const versions: Record<string, number> = {};
  for (const [key, version] of Object.entries(value)) {
    versions[key] = typeof version === "number" && Number.isSafeInteger(version) ? version : 0;
  }
  return versions;
}
