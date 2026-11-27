import path from "node:path";
import {
  bindCoordinatorWriteQueue,
  bindOutbox,
  ensureHarnessDataLayout,
  GlobalBrokerDb,
  openDatabase,
  openProjectStateDb,
  TelemetryDb,
  type CoordinatorWriteQueue,
  type OutboxRepo,
  type ProjectStateDb,
  type SqliteConnection,
  type SqlValue,
} from "@ef-harness/db";

export interface WalCheckpoint {
  readonly busy: number;
  readonly log: number;
  readonly checkpointed: number;
}

export interface SqlStatement {
  run(...params: readonly unknown[]): void;
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
}

export interface SqlDb {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
}

export interface ReaderSet {
  closeAll(): number;
  readonly size: number;
}

export interface OpenDatabases {
  readonly globalDb: SqlDb;
  readonly stateDb: SqlDb;
  readonly readers: ReaderSet;
  readonly globalPath: string;
  readonly statePath: string;
  readonly queue: CoordinatorWriteQueue;
  readonly outbox: OutboxRepo;
  readonly project: ProjectStateDb;
  readonly broker: GlobalBrokerDb;
  readonly telemetry: TelemetryDb;
  readonly globalWriter: SqliteConnection;
  readonly stateWriter: SqliteConnection;
}

const silentLogger = {
  info(): void {},
  warn(): void {},
  error(): void {},
};

export function openHarnessDatabases(globalPath: string, statePath: string, appVersion: string): OpenDatabases {
  const profile = path.dirname(globalPath);
  const layout = ensureHarnessDataLayout({ root: profile });
  const broker = GlobalBrokerDb.open({ root: profile });
  const project = openProjectStateDb({
    projectId: "m1",
    rootDir: profile,
    appVersion,
    logger: silentLogger,
  });
  const telemetry = TelemetryDb.open({ filePath: layout.projectTelemetryPath("m1") });
  if (path.resolve(project.databasePath) !== path.resolve(statePath)) {
    project.close();
    broker.close();
    telemetry.close();
    throw new Error(`state.db opened at ${project.databasePath}`);
  }
  const readers = new AttachedReaders();
  readers.open(broker.layout.globalDbPath, "global");
  readers.open(project.databasePath, "state");
  return {
    globalDb: wrapConnection(broker.writer),
    stateDb: wrapConnection(project.writer),
    readers,
    globalPath: broker.layout.globalDbPath,
    statePath: project.databasePath,
    queue: bindCoordinatorWriteQueue(project, { pruneIntervalMs: 86_400_000 }),
    outbox: bindOutbox(project),
    project,
    broker,
    telemetry,
    globalWriter: broker.writer,
    stateWriter: project.writer,
  };
}

export function checkpointTruncate(db: SqliteConnection): WalCheckpoint {
  const row: unknown = db.pragma("wal_checkpoint(TRUNCATE)");
  return readCheckpoint(row);
}

function readCheckpoint(row: unknown): WalCheckpoint {
  if (!row || typeof row !== "object") return { busy: -1, log: -1, checkpointed: -1 };
  const record = row as Record<string, unknown>;
  return {
    busy: Number(record.busy ?? 0),
    log: Number(record.log ?? 0),
    checkpointed: Number(record.checkpointed ?? 0),
  };
}

class AttachedReaders implements ReaderSet {
  private readonly handles: SqliteConnection[] = [];

  open(file: string, role: "global" | "state"): void {
    this.handles.push(openDatabase({ location: file, role, access: "readonly" }));
  }

  closeAll(): number {
    const count = this.handles.length;
    while (this.handles.length > 0) {
      const db = this.handles.pop();
      if (db) db.close();
    }
    return count;
  }

  get size(): number {
    return this.handles.length;
  }
}

function wrapConnection(conn: SqliteConnection): SqlDb {
  return {
    exec(sql: string): void {
      conn.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      const statement = conn.prepare(sql);
      return {
        run(...params: readonly unknown[]): void {
          const bound = bindParams(params);
          if (bound === undefined) statement.run();
          else statement.run(bound);
        },
        get(...params: readonly unknown[]): unknown {
          const bound = bindParams(params);
          if (bound === undefined) return statement.get();
          return statement.get(bound);
        },
        all(...params: readonly unknown[]): unknown[] {
          const bound = bindParams(params);
          if (bound === undefined) return statement.all();
          return statement.all(bound);
        },
      };
    },
  };
}

function bindParams(params: readonly unknown[]): Record<string, SqlValue> | readonly SqlValue[] | undefined {
  if (params.length === 0) return undefined;
  const first = params[0];
  if (
    params.length === 1 &&
    first !== null &&
    typeof first === "object" &&
    !Array.isArray(first) &&
    !(first instanceof Uint8Array)
  ) {
    const named: Record<string, SqlValue> = {};
    for (const key of Object.keys(first)) {
      named[key] = asSqlValue(Reflect.get(first, key));
    }
    return named;
  }
  return params.map((item) => asSqlValue(item));
}

function asSqlValue(value: unknown): SqlValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array) return value;
  return null;
}
