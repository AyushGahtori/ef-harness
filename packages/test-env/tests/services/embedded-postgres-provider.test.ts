import { afterEach, describe, expect, it } from "vitest";
import {
  EmbeddedPostgresProvider,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME,
  ManualClock,
  ServiceStartFailedError,
  UnsupportedPostgresExtensionError,
  buildDropDatabaseCommands,
  postgresDatabaseName,
  type JobHandle,
  type PostgresClusterLauncher,
  type PostgresClusterRuntime,
  type PostgresLaunchRequest,
  type ProcessExitEvent,
  type SqlCommand,
} from "../../src/services/index.js";
import { envRequest, makeTemp, removeTemp } from "./helpers.js";

class RecordingPostgresLauncher implements PostgresClusterLauncher {
  starts = 0;
  stops = 0;
  readonly commands: SqlCommand[] = [];
  readonly jobs: JobHandle[] = [];
  failWith: string | null = null;
  liveExtensions = true;
  latest: FakePostgresRuntime | null = null;

  async launch(request: PostgresLaunchRequest): Promise<PostgresClusterRuntime> {
    this.jobs.push(request.job);
    if (this.failWith) throw new Error(this.failWith);
    this.starts += 1;
    const runtime = new FakePostgresRuntime(this);
    this.latest = runtime;
    return runtime;
  }
}

class FakePostgresRuntime implements PostgresClusterRuntime {
  readonly port = 54329;
  readonly pid = 4242;
  private stderrText = "";
  private readonly listeners: Array<(event: ProcessExitEvent) => void> = [];

  constructor(private readonly owner: RecordingPostgresLauncher) {}

  stderr(): string {
    return this.stderrText;
  }

  onExit(listener: (event: ProcessExitEvent) => void): void {
    this.listeners.push(listener);
  }

  async stop(): Promise<void> {
    this.owner.stops += 1;
    this.emit(true);
  }

  crash(stderr: string): void {
    this.stderrText = stderr;
    this.emit(false);
  }

  async connect() {
    const owner = this.owner;
    return {
      async query(sql: string, params: readonly unknown[] = []) {
        owner.commands.push({ sql, params });
        if (sql.includes("pg_available_extensions")) {
          const name = params[0];
          if (owner.liveExtensions && typeof name === "string") return [{ name }];
          return [];
        }
        return [];
      },
      async close() {
        return undefined;
      },
    };
  }

  private emit(intentional: boolean): void {
    const event: ProcessExitEvent = { intentional, stderr: this.stderrText, code: intentional ? 0 : 1 };
    for (const listener of this.listeners) listener(event);
  }
}

describe("EmbeddedPostgresProvider", () => {
  const dirs: string[] = [];
  const providers: EmbeddedPostgresProvider[] = [];

  afterEach(async () => {
    for (const provider of providers) await provider.closeProject("project-a");
    providers.length = 0;
    for (const dir of dirs) await removeTemp(dir);
    dirs.length = 0;
  });

  it("creates an isolated database, applies statement_timeout, and drops it after terminating backends", async () => {
    const root = await makeTemp("pg-sql-");
    dirs.push(root);
    const launcher = new RecordingPostgresLauncher();
    const provider = new EmbeddedPostgresProvider({ launcher, home: root, idleGraceMs: 0 });
    providers.push(provider);
    expect(postgresDatabaseName("91")).toBe("env_91");
    const created = await provider.create(
      envRequest(root, "91", { templateDatabase: "tpl_abc", extensions: ["plpgsql"] }),
    );
    expect(launcher.starts).toBe(1);
    expect(launcher.jobs[0]?.limits.killOnJobClose).toBe(true);
    expect(launcher.jobs[0]?.killOnCloseFlag).toBe(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME);
    expect(created.database).toBe("env_91");
    expect(created.statementTimeoutMs).toBe(30_000);
    expect(created.statementTimeoutOption).toBe("-c statement_timeout=30000");
    expect(new URL(created.connectionString).searchParams.get("options")).toBe("-c statement_timeout=30000");
    const createSql = launcher.commands.map((command) => command.sql).join("\n");
    expect(createSql).toContain('CREATE DATABASE "env_91" TEMPLATE "tpl_abc" OWNER "env_91"');
    expect(createSql).toContain(`statement_timeout = '30000'`);
    const marked = launcher.commands.length;
    await provider.destroy("91");
    const dropped = launcher.commands.slice(marked);
    const sql = dropped.map((command) => command.sql);
    const revoke = sql.findIndex((line) => line.startsWith("REVOKE CONNECT"));
    const terminate = sql.findIndex((line) => line.includes("pg_terminate_backend"));
    const drop = sql.findIndex((line) => line.startsWith("DROP DATABASE"));
    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(terminate).toBeGreaterThan(revoke);
    expect(drop).toBeGreaterThan(terminate);
    expect(sql[terminate]).toContain("datname = $1");
    expect(dropped[terminate]?.params).toEqual(["env_91"]);
    expect(buildDropDatabaseCommands("env_91")[2]?.params).toEqual(["env_91"]);
    await provider.destroy("91");
  });

  it("uses a configurable statement timeout and does not drop a sibling database", async () => {
    const root = await makeTemp("pg-iso-");
    dirs.push(root);
    const launcher = new RecordingPostgresLauncher();
    const provider = new EmbeddedPostgresProvider({ launcher, home: root, idleGraceMs: 0 });
    providers.push(provider);
    await provider.create(envRequest(root, "91", { statementTimeoutMs: 1500 }));
    await provider.create(envRequest(root, "92"));
    expect(launcher.starts).toBe(1);
    const marked = launcher.commands.length;
    await provider.destroy("91");
    const sql = launcher.commands.slice(marked).map((command) => command.sql).join("\n");
    expect(sql).toContain("env_91");
    expect(sql).not.toContain("env_92");
    expect(launcher.commands.map((command) => command.sql).join("\n")).toContain(`statement_timeout = '1500'`);
  });

  it("fails unsupported extensions before launch and after a live catalog miss", async () => {
    const root = await makeTemp("pg-ext-");
    dirs.push(root);
    const launcher = new RecordingPostgresLauncher();
    const provider = new EmbeddedPostgresProvider({ launcher, home: root, idleGraceMs: 0 });
    providers.push(provider);
    await expect(provider.create(envRequest(root, "91", { extensions: ["pgvector"] }))).rejects.toThrow(
      UnsupportedPostgresExtensionError,
    );
    await expect(provider.create(envRequest(root, "91", { extensions: ["postgis"] }))).rejects.toThrow(
      "Requires Docker (Tier D) for extension postgis",
    );
    expect(launcher.starts).toBe(0);
    const live = new RecordingPostgresLauncher();
    live.liveExtensions = false;
    const liveProvider = new EmbeddedPostgresProvider({
      launcher: live,
      home: root,
      idleGraceMs: 0,
      embeddedExtensions: ["pgvector"],
    });
    providers.push(liveProvider);
    await expect(liveProvider.create(envRequest(root, "92", { extensions: ["pgvector"] }))).rejects.toThrow(
      "Requires Docker (Tier D) for extension pgvector",
    );
    expect(live.starts).toBe(1);
    expect(live.stops).toBe(1);
  });

  it("returns a docker fallback hold when postgres cannot start", async () => {
    const root = await makeTemp("pg-start-");
    dirs.push(root);
    const launcher = new RecordingPostgresLauncher();
    launcher.failWith = "The application failed to start because VCRUNTIME140.dll was not found";
    const provider = new EmbeddedPostgresProvider({ launcher, home: root, idleGraceMs: 0 });
    providers.push(provider);
    await expect(provider.create(envRequest(root, "91"))).rejects.toBeInstanceOf(ServiceStartFailedError);
    try {
      await provider.create(envRequest(root, "91"));
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceStartFailedError);
      const startError = error as ServiceStartFailedError;
      expect(startError.hint).toBe("Offer Docker fallback");
      expect(startError.holdDependentTaskOnly).toBe(true);
      expect(startError.failTask).toBe(false);
      expect(startError.workerQualityPenalty).toBe(false);
      expect(startError.logs).toContain("VCRUNTIME140.dll");
      expect(startError.message).toContain("Offer Docker fallback");
    }
  });

  it("marks active environments degraded on a crash and restarts on the next create", async () => {
    const root = await makeTemp("pg-crash-");
    dirs.push(root);
    const launcher = new RecordingPostgresLauncher();
    const provider = new EmbeddedPostgresProvider({ launcher, home: root, idleGraceMs: 0 });
    providers.push(provider);
    await provider.create(envRequest(root, "1"));
    await provider.create(envRequest(root, "2"));
    await provider.create(envRequest(root, "3"));
    expect(launcher.starts).toBe(1);
    launcher.latest?.crash("cluster process exited: antivirus quarantine");
    const reports = provider.degradations();
    expect(reports.map((report) => report.envId).sort()).toEqual(["1", "2", "3"]);
    for (const report of reports) {
      expect(report.workerQualityPenalty).toBe(false);
      expect(report.failureScope).toBe("environment");
      expect(report.stderr).toBe("cluster process exited: antivirus quarantine");
    }
    await provider.create(envRequest(root, "4"));
    expect(launcher.starts).toBe(2);
  });

  it("starts the shared server lazily and stops it when the last environment is gone", async () => {
    const root = await makeTemp("pg-refs-");
    dirs.push(root);
    const clock = new ManualClock();
    const launcher = new RecordingPostgresLauncher();
    const provider = new EmbeddedPostgresProvider({
      launcher,
      home: root,
      clock,
      idleGraceMs: 1_000,
    });
    providers.push(provider);
    expect(launcher.starts).toBe(0);
    await provider.create(envRequest(root, "1"));
    await provider.create(envRequest(root, "2"));
    expect(launcher.starts).toBe(1);
    await provider.destroy("1");
    expect(launcher.stops).toBe(0);
    await provider.destroy("2");
    await clock.advance(999);
    expect(launcher.stops).toBe(0);
    await clock.advance(1);
    expect(launcher.stops).toBe(1);
    await provider.closeProject("project-a");
  });

  it("reports a missing embedded binary as a docker fallback hold", async () => {
    const root = await makeTemp("pg-missing-");
    dirs.push(root);
    const provider = new EmbeddedPostgresProvider({ home: root, idleGraceMs: 0 });
    providers.push(provider);
    await expect(provider.create(envRequest(root, "91"))).rejects.toMatchObject({
      hint: "Offer Docker fallback",
      holdDependentTaskOnly: true,
    });
  });
});
