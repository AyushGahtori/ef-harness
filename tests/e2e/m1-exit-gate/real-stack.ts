import path from "node:path";
import {
  bindCoordinatorWriteQueue,
  bindOutbox,
  GlobalBrokerDb,
  openProjectStateDb,
  type CoordinatorWriteQueue,
  type OutboxRepo,
  type ProjectStateDb,
  type SqliteConnection,
  type SqlValue,
} from "@ef-harness/db";
import { NamedPipeServer, SessionTokenStore } from "@ef-harness/ipc";
import { WorktreeSlotManager as GitWorktreeSlotManager } from "@ef-harness/git-engine";
import { CommandDeniedError, HarnessRunEngine, WindowsJobManager } from "@ef-harness/sandbox";
import {
  ServiceProviderRegistry,
  SqliteEnvProcessStore,
  SqlitePortLeaseStore,
  TestEnvOrchestrator,
  type WindowsJobManager as EnvJobManager,
} from "@ef-harness/test-env";
import { AttemptMcpServer } from "@ef-harness/mcp-server";
import { NativeWorkerLoop, type NativeWorkerLoopDependencies } from "@ef-harness/worker-loop";
import { createCompletenessGateRunner } from "@ef-harness/completeness-gate";
import {
  CandidateAcceptanceCoordinator,
  CleanVerifierRunner,
  type CleanVerifierDeps,
} from "@ef-harness/verifier";
import { createHarnessDaemon } from "@ef-harness/daemon";

export interface KitchenStatement {
  run(...args: readonly unknown[]): unknown;
  get(...args: readonly unknown[]): unknown;
  all(...args: readonly unknown[]): unknown[];
}

export interface KitchenSql {
  prepare(sql: string): KitchenStatement;
  exec(sql: string): void;
  close(): Promise<void>;
}

interface KitchenState extends KitchenSql {
  readonly queue: CoordinatorWriteQueue;
  readonly outbox: OutboxRepo;
  readonly project: ProjectStateDb;
}

const silentLogger = {
  info(): void {},
  warn(): void {},
  error(): void {},
};

let projectSeq = 0;

export function openKitchenState(file: string): KitchenSql {
  projectSeq += 1;
  const projectId = `k${projectSeq}`;
  const rootDir = path.dirname(file);
  const project = openProjectStateDb({
    projectId,
    rootDir,
    appVersion: "0.0.0",
    logger: silentLogger,
  });
  const queue = bindCoordinatorWriteQueue(project, { pruneIntervalMs: 86_400_000 });
  const outbox = bindOutbox(project);
  const sql = wrap(project.writer);
  const handle: KitchenState = {
    prepare: (statement) => sql.prepare(statement),
    exec: (statement) => sql.exec(statement),
    queue,
    outbox,
    project,
    async close(): Promise<void> {
      await queue.drainAndClose();
      project.close();
    },
  };
  states.set(handle, handle);
  return handle;
}

export function openKitchenGlobal(file: string, projectPath: string): KitchenSql {
  const root = path.join(path.dirname(file), "global-root");
  const broker = GlobalBrokerDb.open({ root });
  const sql = wrap(broker.writer);
  sql
    .prepare(
      "INSERT INTO projects (id, path, display_name, schema_version, status, last_opened_at) VALUES (?, ?, ?, 1, 'ok', ?)",
    )
    .run("P-kitchen", projectPath, "Kitchen Lunch", 1_767_225_600_000);
  return {
    prepare: (statement) => sql.prepare(statement),
    exec: (statement) => sql.exec(statement),
    async close(): Promise<void> {
      broker.close();
    },
  };
}

const states = new WeakMap<KitchenSql, KitchenState>();

export function appendTaskAccepted(state: KitchenSql, task: string, rev: number): void {
  const handle = states.get(state);
  if (!handle) throw new Error("kitchen state is not a ProjectStateDb");
  handle.queue.submitOperationSync({
    opId: `accept-${task}`,
    kind: "task_accepted",
    request: { task, rev },
    execute: () => {
      handle.outbox.appendEvent(
        {
          id: `EV-${task}`,
          type: "TaskAccepted",
          subject: task,
          rev,
          payload: { schema: "event@1", type: "TaskAccepted", subject: task },
          createdAt: 1_767_225_700_000,
        },
        ["ui_projection"],
      );
      return { task };
    },
  });
}

export async function exerciseRealM1(temp: string, state: KitchenSql): Promise<void> {
  const handle = states.get(state);
  if (!handle) throw new Error("kitchen state is not a ProjectStateDb");
  const slots = new GitWorktreeSlotManager({ wtRoot: path.join(temp, "real-slots") });
  if (!slots.diskLane) throw new Error("worktree slot manager did not open a disk lane");
  const audit = createCompletenessGateRunner().runLeafStaticAudit({
    taskId: "K01",
    featureId: "F12",
    actor: "worker",
    baseRef: "base",
    candidateRef: "candidate",
    files: [{ path: "src/print.mjs", status: "added", beforeText: "", afterText: "export function print() { return []; }\n" }],
    produces: [],
    schemaFields: [],
    staticData: [],
    approvedDeferralIds: [],
    excludedGeneratedPaths: [],
    seedFixturePaths: [],
    protectedTestPaths: ["tests/**"],
    protectedTestConfigPaths: ["vitest.config.ts"],
    lockedSnapshotPaths: ["**/__snapshots__/**"],
    verificationScopeGrant: false,
    writeScope: ["src/**"],
    integratorConflictHunks: [],
    declaredSharedFiles: [],
    errorHandlingRequiresSurface: true,
    entryPoints: [],
    registeredAssets: [],
    publicFiles: [],
    assetModuleSources: [],
    visibleExampleLiterals: [],
    deletionDeclared: false,
    justifiedTaskNotes: [],
    registry: { names: [] },
    vaultSecrets: [],
  });
  if (typeof audit.passed !== "boolean") throw new Error("completeness gate did not return a decision");
  const coordinator = new CandidateAcceptanceCoordinator({
    db: writerDatabase(handle.project.writer),
    preview: true,
  });
  if (typeof coordinator.finalizeCandidateAcceptance !== "function") {
    throw new Error("candidate acceptance coordinator is not bound");
  }
  const verifier = new CleanVerifierRunner(unused<CleanVerifierDeps>());
  verifier.registerSurfaceVerifier({
    id: "m1-kitchen",
    supports: () => false,
    collect: () => Promise.resolve([]),
  });
  const engine = new HarnessRunEngine({
    artifactRoot: path.join(temp, "run-artifacts"),
    telemetryDbPath: path.join(temp, "run-telemetry.db"),
  });
  try {
    await engine.executeSandboxedCommand({
      attemptId: "m1-kitchen-probe",
      projectId: "kitchen",
      taskId: "K01",
      worktreePath: temp,
      command: ["node", "-e", "process.stdout.write('visible-self-check')"],
    });
  } catch (error) {
    if (!(error instanceof CommandDeniedError)) throw error;
  } finally {
    engine.close();
  }
  const loop = new NativeWorkerLoop(unused<NativeWorkerLoopDependencies>());
  if (typeof loop.pauseAtBoundary !== "function") throw new Error("native worker loop is not constructed");
  const mcp = new AttemptMcpServer({
    lease: {
      projectId: "kitchen",
      taskId: "K01",
      attemptId: "A-K01-1",
      epoch: 1,
      bearerToken: ["m1", "lease", "bearer"].join("-"),
      worktreePath: temp,
      baseCommit: "seed",
    },
    packet: {
      schema: "task-packet@1",
      task: "K01",
      attempt: "A-K01-1",
      epoch: 1,
      brief_version: 1,
      base: { branch: "harness/f/F12", commit: "seed" },
      goal: "Print the lunch list",
      write_scope: ["src/**"],
      tools: ["kb.get"],
    },
    dependencies: unused<AttemptMcpServer["dependencies"]>(),
  });
  if (!mcp.registeredToolNames().includes("kb.get")) throw new Error("attempt mcp server did not register kb.get");
  const jobs = new WindowsJobManager({ stateDbPath: path.join(temp, "job-registry.db") });
  try {
    const broker = GlobalBrokerDb.open({ root: path.join(temp, "env-broker") });
    try {
      const orchestrator = new TestEnvOrchestrator({
        projectId: "kitchen",
        portLeases: new SqlitePortLeaseStore(broker),
        envProcesses: new SqliteEnvProcessStore(handle.project),
        jobs: jobs as unknown as EnvJobManager,
        providers: new ServiceProviderRegistry(),
      });
      if (typeof orchestrator.create !== "function") throw new Error("test env orchestrator is not constructed");
    } finally {
      broker.close();
    }
  } finally {
    await jobs.abandon();
  }
  const profile = path.join(temp, "daemon-profile");
  const daemon = createHarnessDaemon({
    profileDir: profile,
    pipePath: path.join(profile, "harnessd.sock"),
    daemonVersion: "0.0.0",
    sandboxTier: "C",
    idleMs: 60_000,
    handshakeMs: 5_000,
    simTask: false,
    simStepMs: 50,
    diffNote: "worker note: grouped print rows",
    largeDiffBytes: 0,
  });
  await daemon.start();
  await daemon.shutdown("rpc");
  const tokenStore = new SessionTokenStore({ directory: path.join(temp, "ipc-token") });
  const pipe = new NamedPipeServer({
    pipePath: path.join(temp, "ipc.sock"),
    tokenStore,
    daemonVersion: "0.0.0",
  });
  await pipe.listen();
  await pipe.close();
}

function unused<T>(): T {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return () => {
          throw new Error(`${String(prop)} is not used by the kitchen binder`);
        };
      },
    },
  ) as unknown as T;
}

function writerDatabase(writer: SqliteConnection) {
  return {
    exec(sql: string): void {
      writer.exec(sql);
    },
    prepare(sql: string) {
      const statement = writer.prepare(sql);
      return {
        run(params?: Record<string, string | number | bigint | null>) {
          const result = params === undefined ? statement.run() : statement.run(params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        get(params?: Record<string, string | number | bigint | null>) {
          const row = params === undefined ? statement.get() : statement.get(params);
          if (!row || typeof row !== "object") return undefined;
          return row as Record<string, unknown>;
        },
        all(params?: Record<string, string | number | bigint | null>) {
          const rows = params === undefined ? statement.all() : statement.all(params);
          return rows.map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : {}));
        },
      };
    },
    close(): void {},
  };
}

function wrap(conn: SqliteConnection): { prepare(sql: string): KitchenStatement; exec(sql: string): void } {
  return {
    exec(sql: string): void {
      conn.exec(sql);
    },
    prepare(sql: string): KitchenStatement {
      const statement = conn.prepare(sql);
      return {
        run(...args: readonly unknown[]): unknown {
          const bound = bindParams(args);
          if (bound === undefined) return statement.run();
          return statement.run(bound);
        },
        get(...args: readonly unknown[]): unknown {
          const bound = bindParams(args);
          if (bound === undefined) return statement.get();
          return statement.get(bound);
        },
        all(...args: readonly unknown[]): unknown[] {
          const bound = bindParams(args);
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
