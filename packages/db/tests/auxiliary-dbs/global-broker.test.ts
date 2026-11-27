import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import {
  BrokerLockHeldError,
  createCollectingLogger,
  DuplicateProjectPathError,
  GlobalBrokerDb,
  GlobalDatabaseCorruptError,
  InvalidProjectStatusError,
  InvalidSettingValueError,
  PortLeaseConflictError,
  PortLeaseNotFoundError,
  PortOutOfRangeError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  RESEARCH_CACHE_TTL_MS,
  VaultRefSecretError,
  loadCanonicalSchema,
  openSqliteConnection,
  schemaTableNames,
  vaultSecretPrefixes,
  type AuxiliaryLogEvent,
  type ProcessIdentity,
} from "../../src/auxiliary-dbs/index.js";
import { useTempDirs } from "./lifecycle.js";
import { corruptHeader, projectPath } from "./temp-root.js";

const identity: ProcessIdentity = {
  pid: 4242,
  processStartTime: 1_700_000_000_000,
  hostname: "build-box",
};

describe("global broker database", () => {
  const dirs = useTempDirs();

  function open(root: string, events?: AuxiliaryLogEvent[], now = (): number => 1_000) {
    const logger = events === undefined ? undefined : createCollectingLogger(events);
    const db = GlobalBrokerDb.open({
      root,
      identity,
      now,
      ...(logger === undefined ? {} : { logger }),
    });
    dirs.close(() => db.close());
    return db;
  }

  it("bootstraps global.db from the canonical schema and keeps device_id immutable", () => {
    const root = dirs.root("global");
    const canonical = fs.readFileSync(canonicalAssetAbsolute("globalSql"), "utf8");
    expect(loadCanonicalSchema("global")).toBe(canonical);

    const first = open(root, undefined, () => 5_000);
    expect(first.deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(first.deviceId).not.toBe(identity.hostname);
    expect(first.writerEpoch).toBe(1);
    expect(first.owner()).toEqual({
      pid: identity.pid,
      processStartTime: identity.processStartTime,
      epoch: 1,
      hostname: identity.hostname,
      acquiredAt: 5_000,
      role: "broker",
    });
    expect(first.connectionSettings()).toMatchObject({
      journalMode: "wal",
      synchronous: "full",
      foreignKeys: true,
      secureDelete: true,
      userVersion: 1,
    });
    expect(first.schemaTables()).toEqual([...schemaTableNames(canonical)].sort());
    expect(first.attachedDatabaseNames()).toEqual(["main"]);
    first.verifyIsolatedConnection();
    expect(first.quickCheck()).toBe("ok");
    first.assertDeviceIdImmutable();
    expect(first.deviceId).toMatch(/^[0-9a-f]{32}$/);
    const deviceId = first.deviceId;
    const filePath = first.filePath;
    first.close();

    const second = open(root, undefined, () => 9_000);
    expect(second.deviceId).toBe(deviceId);
    expect(second.writerEpoch).toBe(2);
    expect(second.owner().acquiredAt).toBe(9_000);
    second.close();

    const other = open(dirs.root("global-other"));
    expect(other.deviceId).not.toBe(deviceId);
    other.close();

    const inspect = openSqliteConnection(filePath, "global");
    dirs.close(() => inspect.close());
    const ddl = inspect
      .all("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL")
      .map((row) => String(row.sql))
      .join("\n");
    expect(ddl).toContain("CHECK (port BETWEEN 41000 AND 48999)");
    expect(ddl).toContain("json_valid(value)");
    expect(ddl).toContain("device_id is immutable");
  });

  it("refuses a second writer while the broker lock is held and does not replace a corrupt global.db", () => {
    const root = dirs.root("global-lock");
    const first = open(root);
    expect(() => GlobalBrokerDb.open({ root, identity })).toThrow(BrokerLockHeldError);
    const filePath = first.filePath;
    first.close();
    corruptHeader(filePath);
    expect(() => GlobalBrokerDb.open({ root, identity })).toThrow(GlobalDatabaseCorruptError);
    expect(fs.readFileSync(filePath).subarray(0, 16).equals(Buffer.alloc(16, 0))).toBe(true);
  });

  it("registers projects, canonicalizes Windows paths, and preserves pins when a drive goes offline", () => {
    const root = dirs.root("projects");
    const db = open(root);
    const first = db.registerProject({
      id: "alpha",
      path: projectPath("Alpha"),
      displayName: "Alpha",
      schemaVersion: 3,
    });
    expect(first.status).toBe("ok");
    expect(fs.existsSync(db.layout.projectBackupsDir("alpha"))).toBe(true);
    expect(fs.existsSync(db.layout.projectEnvsDir("alpha"))).toBe(true);
    expect(() =>
      db.registerProject({
        id: "alpha",
        path: projectPath("Other"),
        displayName: "Alpha",
        schemaVersion: 3,
      }),
    ).toThrow(ProjectAlreadyExistsError);
    expect(() =>
      db.registerProject({
        id: "beta",
        path: process.platform === "win32" ? "c:\\EFHarnessProjects\\alpha\\" : projectPath("Alpha"),
        displayName: "Beta",
        schemaVersion: 3,
      }),
    ).toThrow(DuplicateProjectPathError);
    expect(db.findProjectByPath(projectPath("Alpha"))?.id).toBe("alpha");

    db.upsertConnection({
      id: "openai-personal",
      provider: "openai",
      route: "api_key",
      vaultRef: "wincred:ef-harness/openai",
      currency: "usd",
      scale: 1_000_000,
      createdAt: 10,
    });
    db.upsertConnection({
      id: "anthropic-disabled",
      provider: "anthropic",
      route: "api_key",
      currency: "usd",
      scale: 1_000_000,
      enabled: false,
      createdAt: 11,
    });
    expect(db.getConnection("openai-personal")?.vaultRef).toBe("wincred:ef-harness/openai");
    expect(db.listConnections().map((conn) => [conn.id, conn.enabled])).toEqual([
      ["anthropic-disabled", false],
      ["openai-personal", true],
    ]);
    for (const prefix of vaultSecretPrefixes()) {
      expect(() =>
        db.upsertConnection({
          id: "leaked",
          provider: "openai",
          route: "api_key",
          vaultRef: `${prefix}example-value`,
          currency: "usd",
          scale: 1,
          createdAt: 11,
        }),
      ).toThrow(VaultRefSecretError);
    }
    expect(() =>
      db.upsertConnection({
        id: "padded",
        provider: "openai",
        route: "api_key",
        vaultRef: `  ${vaultSecretPrefixes()[0]}padded`,
        currency: "usd",
        scale: 1,
        createdAt: 12,
      }),
    ).toThrow(VaultRefSecretError);

    db.insertGrant({
      id: "grant-1",
      projectId: "alpha",
      connectionId: "openai-personal",
      currency: "usd",
      units: 25,
      priorityClass: "interactive",
      issuedAt: 20,
      expiresAt: 30,
    });
    db.pinBlob({ hash: "abc123", holderKind: "project", holderId: "alpha", pinnedAt: 21 });
    const offline = db.markProjectOffline("alpha");
    expect(offline.status).toBe("offline");
    expect(db.listPins()).toEqual([
      { hash: "abc123", holderKind: "project", holderId: "alpha", pinnedAt: 21 },
    ]);
    expect(db.listGrants("alpha")).toHaveLength(1);
    expect(db.listGrants("alpha")[0]?.units).toBe(25);

    const moved = db.updateProjectPath(
      "alpha",
      process.platform === "win32" ? "D:\\Moved\\Alpha\\" : "/var/ef-harness-projects/moved",
    );
    expect(moved.path).toBe(
      process.platform === "win32" ? "D:\\moved\\alpha" : "/var/ef-harness-projects/moved",
    );
    expect(db.markProjectSeen("alpha", 40).lastSeenAt).toBe(40);
    expect(db.markProjectOpened("alpha", 41).lastOpenedAt).toBe(41);
    expect(db.listPins()).toHaveLength(1);
    expect(() => db.markProjectOffline("missing")).toThrow(ProjectNotFoundError);
    expect(() => db.setProjectStatus("alpha", "asleep" as "offline")).toThrow(InvalidProjectStatusError);
  });

  it("stores JSON settings, machine profile, and learned footprints", () => {
    const db = open(dirs.root("settings"));
    db.setSetting("storage.root", { root: "D:\\EFHarness", relocated: true });
    db.setSetting("flags", ["a", null, 1]);
    expect(db.getSetting("storage.root")).toEqual({ root: "D:\\EFHarness", relocated: true });
    expect(db.getSetting("flags")).toEqual(["a", null, 1]);
    expect(db.getSetting("missing")).toBeUndefined();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => db.setSetting("bad", circular)).toThrow(InvalidSettingValueError);
    expect(db.deleteSetting("flags")).toBe(true);
    expect(db.getSetting("flags")).toBeUndefined();

    db.setMachineProfile("ram_total_mb", "32768", 80);
    expect(db.getMachineProfile("ram_total_mb")).toEqual({
      key: "ram_total_mb",
      value: "32768",
      measuredAt: 80,
    });
    db.setFootprint({
      consumer: "worker_cli",
      project: "",
      p50Mb: 400,
      p95Mb: 900,
      samples: 12,
      updatedAt: 90,
    });
    db.setFootprint({
      consumer: "worker_cli",
      project: "",
      p50Mb: 450,
      p95Mb: 950,
      samples: 13,
      updatedAt: 91,
    });
    expect(db.getFootprint("worker_cli")).toMatchObject({ p50Mb: 450, samples: 13 });
  });

  it("leases ports exclusively inside 41000-48999 and releases them", () => {
    const db = open(dirs.root("ports"));
    db.registerProject({
      id: "alpha",
      path: projectPath("Alpha"),
      displayName: "Alpha",
      schemaVersion: 1,
    });
    db.registerProject({
      id: "beta",
      path: projectPath("Beta"),
      displayName: "Beta",
      schemaVersion: 1,
    });
    expect(() =>
      db.leasePort({ projectId: "alpha", environment: "preview", port: 40_999, leasedAt: 1 }),
    ).toThrow(PortOutOfRangeError);
    expect(() =>
      db.leasePort({ projectId: "alpha", environment: "preview", port: 49_000, leasedAt: 1 }),
    ).toThrow(PortOutOfRangeError);
    expect(() =>
      db.leasePort({ projectId: "alpha", environment: "preview", port: 41_000.5, leasedAt: 1 }),
    ).toThrow(PortOutOfRangeError);

    const low = db.leasePort({
      projectId: "alpha",
      environment: "preview",
      port: 41_000,
      leasedAt: 1,
      expiresAt: 5,
    });
    const high = db.leasePort({
      projectId: "beta",
      environment: "postgres",
      port: 48_999,
      leasedAt: 1,
    });
    expect(low.port).toBe(41_000);
    expect(high.projectId).toBe("beta");
    expect(() =>
      db.leasePort({ projectId: "beta", environment: "preview", port: 48_999, leasedAt: 2 }),
    ).toThrow(PortLeaseConflictError);
    expect(db.listPortLeases().map((lease) => lease.port)).toEqual([41_000, 48_999]);

    const firstAuto = db.leasePort({ projectId: "alpha", environment: "redis", leasedAt: 2 });
    const secondAuto = db.leasePort({ projectId: "beta", environment: "mailpit", leasedAt: 2 });
    expect(firstAuto.port).toBe(41_001);
    expect(secondAuto.port).toBe(41_002);
    db.releasePort(41_001);
    expect(() => db.releasePort(41_001)).toThrow(PortLeaseNotFoundError);
    const reused = db.leasePort({ projectId: "beta", environment: "redis", leasedAt: 3 });
    expect(reused.port).toBe(41_001);

    expect(() =>
      db.leasePort({ projectId: "beta", environment: "preview", port: 48_999, leasedAt: 10 }),
    ).toThrow(PortLeaseConflictError);
    expect(db.listPortLeases().some((lease) => lease.port === 41_000)).toBe(true);

    const cleaned = db.leasePort({ projectId: "alpha", environment: "s3", port: 42_000, leasedAt: 10 });
    expect(cleaned.port).toBe(42_000);
    expect(db.listPortLeases().some((lease) => lease.port === 41_000)).toBe(false);
    expect(db.expirePortLeases(10)).toBe(0);
    db.leasePort({
      projectId: "alpha",
      environment: "s3",
      port: 42_001,
      leasedAt: 10,
      expiresAt: 12,
    });
    expect(db.expirePortLeases(12)).toBe(1);
    expect(db.listPortLeases().some((lease) => lease.port === 42_001)).toBe(false);
    expect(() => db.leasePort({ projectId: "missing", environment: "preview", leasedAt: 1 })).toThrow(
      ProjectNotFoundError,
    );
  });

  it("looks up research cache entries for 90 days and invalidates them by package", () => {
    expect(RESEARCH_CACHE_TTL_MS).toBe(90 * 24 * 60 * 60 * 1000);
    const db = open(dirs.root("research"));
    const fetchedAt = 1_000_000;
    const key = {
      packageName: "react",
      versionRange: "19.0",
      docUrl: "https://example.test/react",
    };
    const entry = db.putResearchCache({
      ...key,
      artifactHash: "hash-1",
      fetchedAt,
      pageVersion: "v1",
    });
    expect(entry.expiresAt).toBe(fetchedAt + RESEARCH_CACHE_TTL_MS);
    expect(db.lookupResearchCache(key, fetchedAt + RESEARCH_CACHE_TTL_MS - 1)?.artifactHash).toBe("hash-1");
    expect(db.lookupResearchCache(key, fetchedAt + RESEARCH_CACHE_TTL_MS)).toBeNull();
    expect(db.lookupResearchCache(key, fetchedAt)).toBeNull();

    db.putResearchCache({ ...key, artifactHash: "hash-2", fetchedAt });
    db.putResearchCache({
      packageName: "react",
      versionRange: "18.2",
      docUrl: "https://example.test/react-18",
      artifactHash: "hash-3",
      fetchedAt,
    });
    db.putResearchCache({
      packageName: "vue",
      versionRange: "3.5",
      docUrl: "https://example.test/vue",
      artifactHash: "hash-4",
      fetchedAt,
    });
    expect(db.invalidateResearchCache({ packageName: "react" })).toBe(2);
    expect(
      db.lookupResearchCache(
        { packageName: "vue", versionRange: "3.5", docUrl: "https://example.test/vue" },
        fetchedAt,
      )?.artifactHash,
    ).toBe("hash-4");
  });

  it("warns when the data root is moved to a world-readable location and still opens", () => {
    if (process.platform !== "win32") return;
    const publicRoot = path.join(process.env.PUBLIC ?? "C:\\Users\\Public", "EFHarness-task014-privacy");
    fs.rmSync(publicRoot, { recursive: true, force: true });
    dirs.close(() => {
      fs.rmSync(publicRoot, { recursive: true, force: true });
    });
    const events: AuxiliaryLogEvent[] = [];
    const db = GlobalBrokerDb.open({
      root: publicRoot,
      identity,
      logger: createCollectingLogger(events),
    });
    dirs.close(() => db.close());
    expect(db.layout.privacy.worldReadable).toBe(true);
    expect(events.some((event) => event.code === "data_root_world_readable")).toBe(true);
    expect(events.some((event) => event.message.includes("Settings → Storage"))).toBe(true);
    expect(db.deviceId).toMatch(/^[0-9a-f]{32}$/);
  });
});
