import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApprovalRequiredError,
  BackfillIncompleteError,
  BackupRequiredBeforeLiveMigrationError,
  ContractPhaseExportGuard,
  DdlSafetyClassifier,
  ExpandContractMigrationOrchestrator,
  ExportRequiredBeforeContractError,
  LIVE_LOCK_TIMEOUT_SQL,
  LocalTemplateDbSeeder,
  LockHazardBlockedError,
  MapDatabaseVault,
  MigrationStateStore,
  PayloadBoundApprovalPolicy,
  PausableBatchedBackfillRunner,
  RehearsalCompatibilityError,
  SqliteSession,
  ActiveDeprecatedReferenceError,
  adaptiveSleepMs,
  executeLiveDdl,
  formatBackfillProgress,
  keysetPageSql,
  pgDumpArgs,
  type AppProbe,
  type BackupProvider,
  type DeployAdapter,
  type ExpandContractPlan,
  type PostDeployHealthCheck,
  type SqlSession,
} from "../../src/live-migrations/index.js";

const ORDER_SCHEMA = `
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    legacy_price INTEGER NOT NULL
  );
`;

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/EPERM|EBUSY|ENOTEMPTY/i.test(message)) throw error;
    }
  }
});

describe("expand-then-contract live migrations", { timeout: 30_000 }, () => {
  it("formats the ship-view backfill strip and refuses OFFSET pagination", () => {
    expect(
      formatBackfillProgress({
        label: "orders.total_cents",
        rowsProcessed: 42500,
        rowsTotal: 50000,
        batchMs: 12,
      }),
    ).toBe("Backfilling orders.total_cents: 42,500 / 50,000 rows (85%) · 12 ms/batch · Pause");
    expect(adaptiveSleepMs(12)).toBe(0);
    expect(adaptiveSleepMs(50)).toBe(100);
    expect(adaptiveSleepMs(200)).toBe(500);
    const page = keysetPageSql("orders", "id", "price_cents");
    expect(page.includes("OFFSET")).toBe(false);
    expect(page).toContain("\"id\" > ?");
    expect(pgDumpArgs("orders", "backup.dump")).toEqual([
      "pg_dump",
      "--format=custom",
      "--file",
      "backup.dump",
      "orders",
    ]);
  });

  it("runs all 6 phases on 5,000 rows, pauses at 2,500, and resumes without duplicate updates", async () => {
    const fixture = createFixture("six-phase");
    const seeder = new LocalTemplateDbSeeder();
    seeder.seed(fixture.live, orderSeed(5000));
    const legacyBefore = sumLegacy(fixture.live);
    expect(legacyBefore).toBe((5000 * 5001) / 2);
    const policy = new PayloadBoundApprovalPolicy("approve");
    const deploy = new ScriptedDeploy();
    const first = harness(fixture, {
      policy,
      deploy,
      health: new ScriptedHealth(true),
      rowCount: 5000,
      backfill: true,
      contract: true,
    });
    const paused = await first.orchestrator.run(first.plan, {
      pauseBackfillWhen: (snapshot) => snapshot.rowsProcessed >= 2500,
      beforeBackfill: () => fixture.live.exec(AUDIT_TRIGGER),
    });
    expect(paused.phases.REHEARSE.status).toBe("passed");
    expect(paused.phases.BACKUP.status).toBe("passed");
    expect(paused.phases.EXPAND.status).toBe("passed");
    expect(paused.phases.APP_DEPLOY.status).toBe("passed");
    expect(paused.phases.BACKFILL.status).toBe("paused");
    expect(paused.backfillCursor?.lastProcessedPk).toBe("2500");
    expect(paused.backfillCursor?.nextPk).toBe("2501");
    expect(paused.backfillCursor?.rowsProcessed).toBe(2500);
    expect(paused.backfillCursor?.rowsRemainingEst).toBe(2500);
    expect(paused.progressText).toMatch(
      /^Backfilling orders\.total_cents: 2,500 \/ 5,000 rows \(50%\) · \d+ ms\/batch · Pause$/,
    );
    expect(paused.backup?.verified).toBe(true);
    expect(paused.backup?.method).toBe("sqlite-online-backup");
    expect(paused.backup?.rowCount).toBe(5000);
    const reader = new DatabaseSync(fixture.statePath, { readOnly: true });
    const stored = reader
      .prepare(
        "SELECT last_processed_pk, rows_processed, rows_remaining_est, paused FROM live_migration_backfill_cursors",
      )
      .get() as { last_processed_pk: string; rows_processed: number; rows_remaining_est: number; paused: number };
    reader.close();
    expect(stored.last_processed_pk).toBe("2500");
    expect(stored.rows_processed).toBe(2500);
    expect(stored.rows_remaining_est).toBe(2500);
    expect(stored.paused).toBe(1);
    expect(sumLegacy(fixture.live)).toBe(legacyBefore);
    first.orchestrator.close();

    const resumedStore = MigrationStateStore.open(fixture.statePath);
    const resumed = new ExpandContractMigrationOrchestrator(
      { ...first.deps, store: resumedStore },
      "sqlite",
    );
    const done = await resumed.run(first.plan);
    expect(done.phases.BACKFILL.status).toBe("passed");
    expect(done.phases.CONTRACT.status).toBe("passed");
    expect(done.fastPath).toBe(false);
    expect(done.backfillCursor?.rowsRemainingEst).toBe(0);
    expect(done.backfillCursor?.rowsProcessed).toBe(5000);
    const audit = fixture.live.get("SELECT COUNT(*) AS c, MAX(hits) AS h FROM fill_audit");
    expect(Number(audit?.c)).toBe(5000);
    expect(Number(audit?.h)).toBe(1);
    expect(deploy.deploys).toBe(1);
    expect(deploy.rollbacks).toBe(0);
    const filled = fixture.live.get("SELECT COUNT(*) AS c, SUM(price_cents) AS s FROM orders WHERE price_cents IS NOT NULL");
    expect(Number(filled?.c)).toBe(5000);
    expect(Number(filled?.s)).toBe(legacyBefore * 100);
    const columns = fixture.live.all("PRAGMA table_info(orders)").map((row) => String(row.name));
    expect(columns).toContain("price_cents");
    expect(columns).not.toContain("legacy_price");
    const card = policy.cards.find((item) => item.kind === "destructive_contract");
    expect(card?.title).toBe("Production Destructive Contract ApprovalCard");
    expect(card?.loud).toBe(true);
    expect(String(card?.payload.dropStatements)).toContain("DROP COLUMN legacy_price");
    expect(String(card?.payload.archivePath).length).toBeGreaterThan(0);
    const archive = done.contractExportPath ?? "";
    const lines = (await import("node:fs")).readFileSync(archive, "utf8").trim().split(/\n/);
    expect(lines).toHaveLength(5001);
    expect(resumed.trace.indexOf("approval:destructive_contract")).toBeGreaterThan(
      resumed.trace.findIndex((entry) => entry.startsWith("export:")),
    );
    expect(resumed.trace.some((entry) => entry.startsWith("contract:"))).toBe(true);
    const ship = resumedStore.getRun(done.migrationId);
    expect(ship?.phases.CONTRACT.status).toBe("passed");
    resumed.close();
    fixture.live.close();
  }, 120_000);

  it("marks backfill and contract not_applicable for an additive-only deploy", async () => {
    const fixture = createFixture("fast-path");
    fixture.live.exec("CREATE TABLE menus (id INTEGER PRIMARY KEY, name TEXT NOT NULL);");
    fixture.live.run("INSERT INTO menus (id, name) VALUES (1, 'lunch')");
    const deploy = new ScriptedDeploy();
    const built = harness(fixture, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy,
      health: new ScriptedHealth(true),
      rowCount: 0,
      sql: "CREATE TABLE dietary_tags (id INTEGER PRIMARY KEY, tag TEXT NOT NULL);",
      predecessor: "CREATE TABLE menus (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
      probes: {
        appNMinus1: {
          probe(session) {
            session.get("SELECT COUNT(*) AS c FROM menus");
            return { ok: true };
          },
        },
        appN: {
          probe(session) {
            const row = session.get("SELECT COUNT(*) AS c FROM dietary_tags");
            return { ok: row !== undefined && Number(row.c) === 0 };
          },
        },
      },
    });
    const done = await built.orchestrator.run(built.plan);
    expect(done.phases.REHEARSE.status).toBe("passed");
    expect(done.phases.BACKUP.status).toBe("passed");
    expect(done.phases.EXPAND.status).toBe("passed");
    expect(done.phases.APP_DEPLOY.status).toBe("passed");
    expect(done.phases.BACKFILL.status).toBe("not_applicable");
    expect(done.phases.CONTRACT.status).toBe("not_applicable");
    expect(done.fastPath).toBe(true);
    expect(Number(fixture.live.get("SELECT COUNT(*) AS c FROM dietary_tags")?.c)).toBe(0);
    built.orchestrator.close();
    fixture.live.close();
  });

  it("hard-blocks Phase 3 when the Phase 2 backup fails", async () => {
    const fixture = createFixture("backup-fail");
    seedOrders(fixture.live, 3);
    const recording = fixture.live.executed.length;
    const built = harness(fixture, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 3,
      dialect: "postgres",
      live: new RecordingSession("postgres"),
    });
    await expect(built.orchestrator.run(built.plan)).rejects.toThrow(BackupRequiredBeforeLiveMigrationError);
    await expect(built.orchestrator.run(built.plan)).rejects.toThrow(/pg_dump: connection refused/);
    const state = built.deps.store.getRun("mig-backup-fail");
    expect(state?.phases.REHEARSE.status).toBe("passed");
    expect(state?.phases.BACKUP.status).toBe("failed");
    expect(state?.phases.EXPAND.status).toBe("pending");
    expect(built.plan.live).toBeInstanceOf(RecordingSession);
    expect((built.plan.live as RecordingSession).log.some((line) => /ALTER|DROP/i.test(line))).toBe(false);
    expect(fixture.live.executed.slice(recording).some((line) => /ALTER|DROP/i.test(line))).toBe(false);
    built.orchestrator.close();
    fixture.live.close();
  });

  it("accepts an explicit PITR attestation when the snapshot fails", async () => {
    const fixture = createFixture("pitr");
    seedOrders(fixture.live, 2);
    const built = harness(fixture, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 2,
      backup: {
        async snapshot() {
          throw new Error("disk full");
        },
      },
      pitr: { clean: true, writtenOverride: "Host PITR snapshots attested clean for orders." },
    });
    const done = await built.orchestrator.run(built.plan, { stopAfter: "EXPAND" });
    expect(done.phases.BACKUP.status).toBe("passed");
    expect(done.backup?.method).toBe("external-pitr");
    expect(done.phases.EXPAND.status).toBe("passed");
    expect(built.orchestrator.trace).toContain("backup-pitr");
    built.orchestrator.close();
    fixture.live.close();
  });

  it("aborts a blocked Postgres DDL at lock_timeout and retries until the analytics lock clears", async () => {
    const held = new ContendedPostgres();
    const sleeps: number[] = [];
    await expect(
      executeLiveDdl({
        session: held,
        statement: "ALTER TABLE orders ADD COLUMN price_cents INTEGER",
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: () => 0,
      }),
    ).rejects.toThrow(/lock timeout/);
    expect(sleeps).toEqual([100, 200, 300]);
    expect(held.log.filter((line) => line === LIVE_LOCK_TIMEOUT_SQL)).toHaveLength(4);

    const fixture = createFixture("lock");
    const live = new ContendedPostgres();
    const built = harness(fixture, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 2,
      dialect: "postgres",
      live,
      backup: verifiedBackup(),
      sleep: async () => {
        live.hold = false;
      },
    });
    seedOrders(fixture.live, 2);
    const done = await built.orchestrator.run(built.plan, { stopAfter: "EXPAND" });
    expect(done.phases.EXPAND.status).toBe("passed");
    expect(live.log.filter((line) => line === LIVE_LOCK_TIMEOUT_SQL).length).toBeGreaterThanOrEqual(2);
    expect(live.hold).toBe(false);
    built.orchestrator.close();
    fixture.live.close();
  });

  it("blocks CREATE INDEX without CONCURRENTLY before any production DDL", async () => {
    const fixture = createFixture("index-lock");
    const live = new RecordingSession("postgres");
    const built = harness(fixture, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 1,
      dialect: "postgres",
      live,
      backup: verifiedBackup(),
      sql: "CREATE INDEX orders_legacy ON orders (legacy_price);",
      probes: {
        appNMinus1: { probe: () => ({ ok: true }) },
        appN: { probe: () => ({ ok: true }) },
      },
    });
    await expect(built.orchestrator.run(built.plan)).rejects.toThrow(LockHazardBlockedError);
    await expect(built.orchestrator.run(built.plan)).rejects.toThrow(/lock_timeout = '2s'/);
    expect(live.log.some((line) => /CREATE INDEX/i.test(line))).toBe(false);
    expect(new DdlSafetyClassifier("postgres").classify(built.plan.sql).lockHazards[0]?.rewrittenSql).toContain(
      "CONCURRENTLY",
    );
    built.orchestrator.close();
    fixture.live.close();
  });

  it("catches a NOT NULL column without DEFAULT during rehearsal, before production", async () => {
    const fixture = createFixture("not-null");
    seedOrders(fixture.live, 4);
    const built = harness(fixture, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 0,
      sql: "ALTER TABLE orders ADD COLUMN price_cents INTEGER NOT NULL;",
    });
    await expect(built.orchestrator.run(built.plan)).rejects.toThrow(RehearsalCompatibilityError);
    await expect(built.orchestrator.run(built.plan)).rejects.toThrow(
      /App N-1 crashes on the expanded schema because a NOT NULL column omitted a DEFAULT/,
    );
    const columns = fixture.live.all("PRAGMA table_info(orders)").map((row) => String(row.name));
    expect(columns).not.toContain("price_cents");
    expect(fixture.live.get("SELECT COUNT(*) AS c FROM orders")?.c).toBe(4);
    built.orchestrator.close();
    fixture.live.close();
  });

  it("keeps App N-1 working when Phase 4 rolls back after an additive expand", async () => {
    const fixture = createFixture("rollback");
    seedOrders(fixture.live, 40);
    const before = sumLegacy(fixture.live);
    const deploy = new ScriptedDeploy();
    const built = harness(fixture, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy,
      health: new ScriptedHealth(false),
      rowCount: 40,
      backfill: true,
      contract: true,
    });
    const done = await built.orchestrator.run(built.plan);
    expect(done.phases.EXPAND.status).toBe("passed");
    expect(done.phases.APP_DEPLOY.status).toBe("rolled_back");
    expect(done.rolledBackTo).toBe("dep-prev");
    expect(done.phases.CONTRACT.status).toBe("pending");
    expect(deploy.rollbacks).toBe(1);
    expect(built.orchestrator.trace).toContain("rollback-n-1-ok");
    expect(sumLegacy(fixture.live)).toBe(before);
    const columns = fixture.live.all("PRAGMA table_info(orders)").map((row) => String(row.name));
    expect(columns).toEqual(expect.arrayContaining(["legacy_price", "price_cents"]));
    expect(fixture.live.executed.some((line) => /DROP COLUMN/i.test(line))).toBe(false);
    const again = await ordersProbe.appNMinus1.probe(fixture.live);
    expect(again.ok).toBe(true);
    built.orchestrator.close();
    fixture.live.close();
  });

  it("blocks Phase 6 while unmigrated rows remain, while readers exist, or when export fails", async () => {
    const incomplete = createFixture("incomplete");
    seedOrders(incomplete.live, 500);
    const incompleteRun = harness(incomplete, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 500,
      backfill: true,
      contract: true,
    });
    await expect(
      incompleteRun.orchestrator.run(incompleteRun.plan, {
        beforeContract: () => {
          incomplete.live.exec("UPDATE orders SET price_cents = NULL WHERE id <= 420");
        },
      }),
    ).rejects.toThrow(BackfillIncompleteError);
    await expect(
      incompleteRun.orchestrator.run(incompleteRun.plan, {
        beforeContract: () => {
          incomplete.live.exec("UPDATE orders SET price_cents = NULL WHERE id <= 420");
        },
      }),
    ).rejects.toThrow(/420 rows still unmigrated/);
    expect(incomplete.live.all("PRAGMA table_info(orders)").some((row) => row.name === "legacy_price")).toBe(true);
    incompleteRun.orchestrator.close();
    incomplete.live.close();

    const referenced = createFixture("referenced");
    seedOrders(referenced.live, 500);
    const referencedRun = harness(referenced, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 500,
      backfill: true,
      contract: true,
      references: ["SELECT legacy_price FROM orders"],
    });
    await expect(referencedRun.orchestrator.run(referencedRun.plan)).rejects.toThrow(ActiveDeprecatedReferenceError);
    expect(referenced.live.executed.some((line) => /DROP COLUMN/i.test(line))).toBe(false);
    referencedRun.orchestrator.close();
    referenced.live.close();

    const blockedExport = createFixture("export-fail");
    seedOrders(blockedExport.live, 500);
    const archiveFile = path.join(blockedExport.dir, "not-a-directory");
    writeFileSync(archiveFile, "occupied");
    const exportRun = harness(blockedExport, {
      policy: new PayloadBoundApprovalPolicy("approve"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 500,
      backfill: true,
      contract: true,
      archiveDir: archiveFile,
    });
    await expect(exportRun.orchestrator.run(exportRun.plan)).rejects.toThrow(ExportRequiredBeforeContractError);
    expect(exportRun.deps.store.getRun("mig-export-fail")?.phases.CONTRACT.status).toBe("blocked");
    expect(blockedExport.live.executed.some((line) => /DROP COLUMN/i.test(line))).toBe(false);
    exportRun.orchestrator.close();
    blockedExport.live.close();

    const guard = new ContractPhaseExportGuard();
    expect(() => guard.assertBackfillComplete(420)).toThrow(/420 rows still unmigrated/);
  }, 120_000);

  it("requires a payload-bound production approval before expand DDL", async () => {
    const fixture = createFixture("approval");
    seedOrders(fixture.live, 2);
    const built = harness(fixture, {
      policy: new PayloadBoundApprovalPolicy("deny"),
      deploy: new ScriptedDeploy(),
      health: new ScriptedHealth(true),
      rowCount: 2,
    });
    await expect(built.orchestrator.run(built.plan)).rejects.toThrow(ApprovalRequiredError);
    expect(fixture.live.executed.some((line) => /ADD COLUMN/i.test(line))).toBe(false);
    built.orchestrator.close();
    fixture.live.close();
  });

  it("rejects an out-of-range backfill batch", async () => {
    const fixture = createFixture("batch");
    const store = fixtureStore(fixture);
    const runner = new PausableBatchedBackfillRunner({
      store,
      sleep: async () => undefined,
      now: () => 0,
    });
    await expect(
      runner.run({
        session: fixture.live,
        migrationId: "mig-batch",
        spec: {
          id: "too-small",
          table: "orders",
          primaryKey: "id",
          targetColumn: "price_cents",
          assignExpression: "legacy_price * 100",
          label: "orders.total_cents",
          batchSize: 50,
        },
      }),
    ).rejects.toThrow(/between 500 and 1000/);
    store.close();
    fixture.live.close();
  });
});

const AUDIT_TRIGGER = `
  CREATE TABLE fill_audit (
    id INTEGER PRIMARY KEY,
    hits INTEGER NOT NULL
  );
  CREATE TRIGGER orders_backfill_audit
  AFTER UPDATE OF price_cents ON orders
  WHEN OLD.price_cents IS NULL AND NEW.price_cents IS NOT NULL
  BEGIN
    INSERT INTO fill_audit(id, hits) VALUES (NEW.id, 1)
    ON CONFLICT(id) DO UPDATE SET hits = hits + 1;
  END;
`;

const ordersProbe: { appNMinus1: AppProbe; appN: AppProbe } = {
  appNMinus1: {
    probe(session) {
      try {
        const before = session.get("SELECT COUNT(*) AS c FROM orders");
        session.run("INSERT INTO orders (id, legacy_price) VALUES (9000001, 4)");
        session.run("DELETE FROM orders WHERE id = 9000001");
        const after = session.get("SELECT COUNT(*) AS c FROM orders");
        return { ok: String(before?.c) === String(after?.c) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  },
  appN: {
    probe(session) {
      const names = session.all("PRAGMA table_info(orders)").map((row) => String(row.name));
      if (!names.includes("price_cents") || !names.includes("legacy_price")) {
        return { ok: false, error: `expanded columns missing: ${names.join(",")}` };
      }
      return { ok: true };
    },
  },
};

function createFixture(name: string): { name: string; dir: string; statePath: string; live: SqliteSession } {
  const dir = mkdtempSync(path.join(tmpdir(), `ef-mig-${name}-`));
  directories.push(dir);
  const live = new SqliteSession(path.join(dir, "live.sqlite"));
  live.exec(ORDER_SCHEMA);
  return { name, dir, statePath: path.join(dir, "state.db"), live };
}

function fixtureStore(fixture: { statePath: string }): MigrationStateStore {
  return MigrationStateStore.open(fixture.statePath);
}

function seedOrders(session: SqliteSession, rowCount: number): void {
  new LocalTemplateDbSeeder().seed(session, orderSeed(rowCount));
}

function orderSeed(rowCount: number) {
  return {
    table: "orders",
    primaryKey: "id",
    rowCount,
    columns: [{ name: "legacy_price", value: (index: number) => index }],
  };
}

function sumLegacy(session: SqliteSession): number {
  const row = session.get("SELECT COALESCE(SUM(legacy_price), 0) AS s FROM orders");
  const value = row?.s;
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function verifiedBackup(): BackupProvider {
  return {
    async snapshot() {
      return {
        artifactPath: "provider-snapshot",
        checksumSha256: "b".repeat(64),
        verified: true,
        method: "provider-snapshot",
        detail: "attested provider snapshot",
        rowCount: null,
      };
    },
  };
}

function harness(
  fixture: { name: string; dir: string; statePath: string; live: SqliteSession },
  input: {
    policy: PayloadBoundApprovalPolicy;
    deploy: DeployAdapter;
    health: PostDeployHealthCheck;
    rowCount: number;
    backfill?: boolean;
    contract?: boolean;
    dialect?: "sqlite" | "postgres";
    live?: SqlSession;
    sql?: string;
    predecessor?: string;
    backup?: BackupProvider;
    pitr?: { clean: true; writtenOverride: string };
    sleep?: (ms: number) => Promise<void>;
    probes?: { appNMinus1: AppProbe; appN: AppProbe };
    references?: readonly string[];
    archiveDir?: string;
  },
) {
  const migrationId = `mig-${fixture.name}`;
  const store = MigrationStateStore.open(fixture.statePath);
  const dialect = input.dialect ?? "sqlite";
  const sql =
    input.sql ??
    (input.contract
      ? "ALTER TABLE orders ADD COLUMN price_cents INTEGER;\nALTER TABLE orders DROP COLUMN legacy_price;"
      : "ALTER TABLE orders ADD COLUMN price_cents INTEGER;");
  const plan: ExpandContractPlan = {
    migrationId,
    env: "production",
    dialect,
    sql,
    predecessorSchemaSql: input.predecessor ?? ORDER_SCHEMA,
    workDir: path.join(fixture.dir, "work"),
    commitSha: "abc123def456",
    previousCommitSha: "prev123",
    targetHost: "db.example.test",
    databaseSecretId: "db-locator",
    live: input.live ?? fixture.live,
    seed: orderSeed(input.rowCount),
    ...(input.backfill
      ? {
          backfills: [
            {
              id: "price-cents",
              table: "orders",
              primaryKey: "id",
              targetColumn: "price_cents",
              assignExpression: "legacy_price * 100",
              label: "orders.total_cents",
              batchSize: 500,
            },
          ],
        }
      : {}),
    appNMinus1: input.probes?.appNMinus1 ?? ordersProbe.appNMinus1,
    appN: input.probes?.appN ?? ordersProbe.appN,
    ...(input.pitr ? { pitrAttestation: input.pitr } : {}),
    ...(input.archiveDir ? { archiveDir: input.archiveDir } : {}),
  };
  const deps = {
    store,
    vault: new MapDatabaseVault(new Map([["db-locator", "local-sqlite-file"]])),
    policy: input.policy,
    deployer: input.deploy,
    health: input.health,
    ...(input.backup ? { backupProvider: input.backup } : {}),
    ...(input.references ? { probe: { activeReferences: () => input.references ?? [] } } : {}),
    ...(input.sleep ? { sleep: input.sleep } : {}),
    random: () => 0,
    now: () => 5,
  };
  return {
    plan,
    deps,
    orchestrator: new ExpandContractMigrationOrchestrator(deps, dialect),
  };
}

class ScriptedDeploy implements DeployAdapter {
  deploys = 0;
  rollbacks = 0;

  async deploy(_env: string, commitSha: string): Promise<{
    deploymentId: string;
    liveUrl: string;
    buildId: string;
    previousDeploymentId: string;
  }> {
    this.deploys += 1;
    return {
      deploymentId: "dep-n",
      liveUrl: "https://app.example.test",
      buildId: commitSha,
      previousDeploymentId: "dep-prev",
    };
  }

  async rollback(): Promise<{
    deploymentId: string;
    liveUrl: string;
    buildId: string;
    previousDeploymentId: string;
  }> {
    this.rollbacks += 1;
    return {
      deploymentId: "dep-prev",
      liveUrl: "https://app.example.test",
      buildId: "prev123",
      previousDeploymentId: "dep-prev",
    };
  }
}

class ScriptedHealth implements PostDeployHealthCheck {
  constructor(private readonly healthy: boolean) {}

  async verify(): Promise<{ healthy: boolean; detail: string }> {
    return { healthy: this.healthy, detail: this.healthy ? "build matched" : "post-deploy health failed" };
  }
}

class RecordingSession implements SqlSession {
  readonly log: string[] = [];

  constructor(readonly dialect: "sqlite" | "postgres") {}

  exec(sql: string): void {
    this.log.push(sql);
  }

  all(): readonly Record<string, never>[] {
    return [];
  }

  get(): undefined {
    return undefined;
  }

  run(): { changes: number } {
    return { changes: 0 };
  }

  close(): void {}
}

class ContendedPostgres extends RecordingSession {
  hold = true;

  constructor() {
    super("postgres");
  }

  override exec(sql: string): void {
    this.log.push(sql);
    if (this.hold && /^(ALTER|CREATE|DROP)\b/i.test(sql.trim())) {
      throw new Error("canceling statement due to lock timeout");
    }
  }
}
