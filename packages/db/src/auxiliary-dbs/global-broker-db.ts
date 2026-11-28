import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  lookupNamedQuery,
  ReaderPool,
  type DbHandle,
  type SqliteConnection as DriverSqliteConnection,
} from "../driver/index.js";
import { DatabaseNewerThanAppError } from "../migrations/errors.js";
import { upgradeDatabaseOnOpen } from "../migrations/open-upgrade.js";
import { PRODUCTION_SCHEMA_VERSION, productionMigrations } from "../migrations/production.js";
import { maxKnownSchemaVersion } from "../migrations/registry.js";
import { acquireBrokerLock, type BrokerLock } from "./broker-lock.js";
import { ensureHarnessDataLayout, type HarnessDataLayout } from "./data-layout.js";
import {
  AuxiliaryDbError,
  DeviceIdImmutableError,
  DeviceIdInvalidError,
  DeviceIdMissingError,
  DuplicateProjectPathError,
  GlobalDatabaseCorruptError,
  GlobalSchemaVersionError,
  InvalidProjectStatusError,
  InvalidSettingValueError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
} from "./errors.js";
import { removeWithRetry, renameWithRetry } from "./fs-retry.js";
import { bigintToNumber } from "./integers.js";
import { createStderrAuxiliaryLogger } from "./logger.js";
import { expirePortLeases, leasePort, listPortLeases, releasePort } from "./port-leases.js";
import { currentProcessIdentity } from "./process-identity.js";
import { normalizeProjectPath } from "./project-path.js";
import {
  assertNonEmpty,
  assertSafeInteger,
  optionalInt,
  optionalText,
  requiredFlag,
  requiredInt,
  requiredText,
} from "./rows.js";
import { loadCanonicalSchema } from "./schema-file.js";
import {
  assertConnectionIsolated,
  assertQuickCheck,
  isSqliteConstraint,
  isSqliteCorruption,
  openSqliteConnection,
  type SqliteConnection,
} from "./sqlite-connection.js";
import {
  GRANT_PRIORITIES,
  GRANT_STATES,
  PIN_HOLDER_KINDS,
  PROJECT_STATUSES,
  type AuxiliaryLogger,
  type BrokerOwner,
  type CasPinInput,
  type CasPinRecord,
  type ConnectionInput,
  type ConnectionRecord,
  type FootprintEntry,
  type GlobalConnectionSettings,
  type GrantInput,
  type GrantPriority,
  type GrantRecord,
  type GrantState,
  type LeasePortInput,
  type MachineProfileEntry,
  type PinHolderKind,
  type PortLease,
  type ProcessIdentity,
  type ProjectRecord,
  type ProjectStatus,
  type RegisterProjectInput,
  type ResearchCacheEntry,
  type ResearchCacheFilter,
  type ResearchCacheWrite,
} from "./types.js";
import { assertVaultRef } from "./vault-ref.js";

export const RESEARCH_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const DEVICE_ID_PATTERN = /^[0-9a-f]{32}$/u;

const DEVICE_ID_GUARDS = `
CREATE TRIGGER IF NOT EXISTS meta_device_id_no_update
BEFORE UPDATE OF value ON meta
FOR EACH ROW
WHEN OLD.key = 'device_id' AND NEW.value <> OLD.value
BEGIN
  SELECT RAISE(ABORT, 'device_id is immutable');
END;
CREATE TRIGGER IF NOT EXISTS meta_device_id_no_delete
BEFORE DELETE ON meta
FOR EACH ROW
WHEN OLD.key = 'device_id'
BEGIN
  SELECT RAISE(ABORT, 'device_id is immutable');
END;
`;

export interface OpenGlobalBrokerDbOptions {
  readonly root?: string;
  readonly logger?: AuxiliaryLogger;
  readonly identity?: ProcessIdentity;
  readonly now?: () => number;
}

export interface AdapterConformanceKey {
  readonly adapterId: string;
  readonly cliVersion: string;
  readonly osSandboxTier: string;
  readonly suiteVersion: string;
}

export interface AdapterConformanceWrite extends AdapterConformanceKey {
  readonly mode: string;
  readonly trust: string;
  readonly payload: string;
  readonly signature: string;
  readonly reportJson: string;
}

export class GlobalBrokerDb implements DbHandle {
  private closed = false;
  private readersPool: ReaderPool | undefined;

  private constructor(
    private readonly conn: SqliteConnection,
    private readonly lock: BrokerLock,
    readonly layout: HarnessDataLayout,
    readonly deviceId: string,
    private ownerRow: BrokerOwner,
  ) {}

  static open(options: OpenGlobalBrokerDbOptions = {}): GlobalBrokerDb {
    const logger = options.logger ?? createStderrAuxiliaryLogger();
    const now = options.now ?? Date.now;
    const identity = options.identity ?? currentProcessIdentity();
    const layout =
      options.root === undefined
        ? ensureHarnessDataLayout()
        : ensureHarnessDataLayout({ root: options.root });
    if (layout.privacy.warning !== null) {
      logger.warn({
        code: "data_root_world_readable",
        message: layout.privacy.warning,
      });
    }
    const lock = acquireBrokerLock(layout.globalLockPath);
    try {
      if (!fs.existsSync(layout.globalDbPath)) {
        createGlobalDatabase(layout.globalDbPath, randomBytes(16).toString("hex"), now());
      } else if (fs.statSync(layout.globalDbPath).size === 0) {
        throw new GlobalDatabaseCorruptError("global.db is empty");
      }
      try {
        upgradeDatabaseOnOpen({
          dbPath: layout.globalDbPath,
          targetDb: "global",
          appVersion: "0.0.0",
          backupsDir: path.join(layout.root, "backups"),
          globalDbPath: layout.globalDbPath,
        });
      } catch (error) {
        if (error instanceof DatabaseNewerThanAppError) {
          throw new GlobalSchemaVersionError(error.userVersion, error.maxKnownVersion);
        }
        if (isSqliteCorruption(error)) {
          throw new GlobalDatabaseCorruptError(error instanceof Error ? error.message : "corrupt");
        }
        throw error;
      }
      const conn = openVerifiedGlobal(layout.globalDbPath);
      try {
        const deviceId = readDeviceId(conn);
        const owner = conn.runImmediate(() => {
          conn.exec(DEVICE_ID_GUARDS);
          const epoch = nextWriterEpoch(conn);
          return writeOwner(conn, identity, epoch, now());
        });
        return new GlobalBrokerDb(conn, lock, layout, deviceId, owner);
      } catch (error) {
        conn.close();
        throw error;
      }
    } catch (error) {
      lock.release();
      throw error;
    }
  }

  get filePath(): string {
    return this.layout.globalDbPath;
  }

  get writer(): DriverSqliteConnection {
    this.assertOpen();
    return this.conn.driver;
  }

  get readers(): ReaderPool {
    this.assertOpen();
    if (this.readersPool === undefined) {
      this.readersPool = new ReaderPool({
        location: this.layout.globalDbPath,
        role: "global",
        size: 2,
        lazy: true,
      });
    }
    return this.readersPool;
  }

  query(name: string): string {
    this.assertOpen();
    return lookupNamedQuery(name);
  }

  get writerEpoch(): number {
    return this.ownerRow.epoch;
  }

  owner(): BrokerOwner {
    this.assertOpen();
    return this.ownerRow;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const readers = this.readersPool;
    this.readersPool = undefined;
    if (readers) void readers.close();
    try {
      this.conn.close({ skipCheckpoint: this.conn.inTransaction() });
    } catch (error) {
      if (!isSqliteCorruption(error)) throw error;
    }
    this.lock.release();
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen();
    return this.conn.runImmediate(fn);
  }

  connectionSettings(): GlobalConnectionSettings {
    this.assertOpen();
    return readConnectionSettings(this.conn);
  }

  schemaTables(): readonly string[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .map((row) => requiredText(row, "name"));
  }

  attachedDatabaseNames(): readonly string[] {
    this.assertOpen();
    return this.conn.databaseNames().filter((name) => name !== "temp");
  }

  verifyIsolatedConnection(): void {
    this.assertOpen();
    assertConnectionIsolated(this.conn);
  }

  quickCheck(): "ok" {
    this.assertOpen();
    assertQuickCheck(this.conn);
    return "ok";
  }

  assertDeviceIdImmutable(): void {
    this.assertOpen();
    const current = readDeviceId(this.conn);
    const attempts: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["UPDATE meta SET value = ? WHERE key = 'device_id'", ["0".repeat(32)]],
      ["DELETE FROM meta WHERE key = 'device_id'", []],
    ];
    for (const [sql, params] of attempts) {
      try {
        this.write(() => {
          this.conn.run(sql, ...params);
        });
      } catch (error) {
        if (readDeviceId(this.conn) !== current) {
          throw new DeviceIdImmutableError("device_id changed");
        }
        const message = error instanceof Error ? error.message : "";
        if (!/immutable|abort/i.test(message)) throw error;
      }
    }
    if (readDeviceId(this.conn) !== current) {
      throw new DeviceIdImmutableError("device_id update was accepted");
    }
  }

  registerProject(input: RegisterProjectInput): ProjectRecord {
    this.assertOpen();
    const id = assertNonEmpty(input.id, "project id");
    const projectPath = normalizeProjectPath(input.path);
    const displayName = assertNonEmpty(input.displayName, "display name");
    const schemaVersion = assertSafeInteger(input.schemaVersion, "schemaVersion");
    const status = input.status ?? "ok";
    assertStatus(status);
    this.layout.ensureProject(id);
    return this.write(() => {
      if (this.conn.get("SELECT id FROM projects WHERE id = ?", id) !== undefined) {
        throw new ProjectAlreadyExistsError(id);
      }
      const duplicate = this.conn.get("SELECT id FROM projects WHERE path = ?", projectPath);
      if (duplicate !== undefined) throw new DuplicateProjectPathError(projectPath);
      this.conn.run(
        `INSERT INTO projects(id, path, display_name, schema_version, status, last_opened_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        projectPath,
        displayName,
        schemaVersion,
        status,
        input.lastOpenedAt ?? null,
        input.lastSeenAt ?? null,
      );
      return this.requireProject(id);
    });
  }

  getProject(id: string): ProjectRecord | null {
    this.assertOpen();
    const row = this.conn.get("SELECT * FROM projects WHERE id = ?", id);
    return row === undefined ? null : mapProject(row);
  }

  findProjectByPath(projectPath: string): ProjectRecord | null {
    this.assertOpen();
    const canonical = normalizeProjectPath(projectPath);
    const row = this.conn.get("SELECT * FROM projects WHERE path = ?", canonical);
    return row === undefined ? null : mapProject(row);
  }

  listProjects(): readonly ProjectRecord[] {
    this.assertOpen();
    return this.conn.all("SELECT * FROM projects ORDER BY id").map((row) => mapProject(row));
  }

  updateProjectPath(id: string, projectPath: string): ProjectRecord {
    const canonical = normalizeProjectPath(projectPath);
    return this.write(() => {
      this.requireProject(id);
      const duplicate = this.conn.get(
        "SELECT id FROM projects WHERE path = ? AND id <> ?",
        canonical,
        id,
      );
      if (duplicate !== undefined) throw new DuplicateProjectPathError(canonical);
      this.conn.run("UPDATE projects SET path = ? WHERE id = ?", canonical, id);
      return this.requireProject(id);
    });
  }

  markProjectOpened(id: string, at: number): ProjectRecord {
    assertSafeInteger(at, "lastOpenedAt");
    return this.write(() => {
      this.requireProject(id);
      this.conn.run("UPDATE projects SET last_opened_at = ? WHERE id = ?", at, id);
      return this.requireProject(id);
    });
  }

  markProjectSeen(id: string, at: number): ProjectRecord {
    assertSafeInteger(at, "lastSeenAt");
    return this.write(() => {
      this.requireProject(id);
      this.conn.run("UPDATE projects SET last_seen_at = ? WHERE id = ?", at, id);
      return this.requireProject(id);
    });
  }

  setProjectStatus(id: string, status: ProjectStatus): ProjectRecord {
    assertStatus(status);
    return this.write(() => {
      this.requireProject(id);
      this.conn.run("UPDATE projects SET status = ? WHERE id = ?", status, id);
      return this.requireProject(id);
    });
  }

  markProjectOffline(id: string): ProjectRecord {
    return this.setProjectStatus(id, "offline");
  }

  getSetting(key: string): unknown {
    this.assertOpen();
    const row = this.conn.get("SELECT value FROM settings WHERE key = ?", assertSettingKey(key));
    if (row === undefined) return undefined;
    return JSON.parse(requiredText(row, "value")) as unknown;
  }

  setSetting(key: string, value: unknown): void {
    const json = encodeJson(value);
    this.write(() => {
      this.conn.run(
        `INSERT INTO settings(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        assertSettingKey(key),
        json,
      );
    });
  }

  deleteSetting(key: string): boolean {
    return this.write(() => {
      const result = this.conn.run("DELETE FROM settings WHERE key = ?", assertSettingKey(key));
      return result.changes > 0;
    });
  }

  getMachineProfile(key: string): MachineProfileEntry | null {
    this.assertOpen();
    const row = this.conn.get("SELECT * FROM machine_profile WHERE key = ?", key);
    if (row === undefined) return null;
    return {
      key: requiredText(row, "key"),
      value: requiredText(row, "value"),
      measuredAt: requiredInt(row, "measured_at"),
    };
  }

  listMachineProfiles(): readonly MachineProfileEntry[] {
    this.assertOpen();
    return this.conn.all("SELECT * FROM machine_profile ORDER BY key").map((row) => ({
      key: requiredText(row, "key"),
      value: requiredText(row, "value"),
      measuredAt: requiredInt(row, "measured_at"),
    }));
  }

  setMachineProfile(key: string, value: string, measuredAt: number): void {
    const profileKey = assertNonEmpty(key, "machine profile key");
    const profileValue = assertNonEmpty(value, "machine profile value");
    assertSafeInteger(measuredAt, "measuredAt");
    this.write(() => {
      this.conn.run(
        `INSERT INTO machine_profile(key, value, measured_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, measured_at = excluded.measured_at`,
        profileKey,
        profileValue,
        measuredAt,
      );
    });
  }

  getFootprint(consumer: string, project = ""): FootprintEntry | null {
    this.assertOpen();
    const row = this.conn.get(
      "SELECT * FROM footprints WHERE consumer = ? AND project = ?",
      consumer,
      project,
    );
    if (row === undefined) return null;
    return mapFootprint(row);
  }

  listFootprints(): readonly FootprintEntry[] {
    this.assertOpen();
    return this.conn.all("SELECT * FROM footprints ORDER BY consumer, project").map((row) => mapFootprint(row));
  }

  setFootprint(input: FootprintEntry): void {
    const consumer = assertNonEmpty(input.consumer, "consumer");
    const p90Mb = input.p90Mb ?? 0;
    const peakRamMb = input.peakRamMb ?? 0;
    const peakCpuTimeMs = input.peakCpuTimeMs ?? 0;
    const diskWriteBytes = input.diskWriteBytes ?? 0;
    const wallClockMs = input.wallClockMs ?? 0;
    const highWatermarkMb = input.highWatermarkMb ?? 0;
    const predictedMb = input.predictedMb ?? 0;
    const peakRamSamplesMb = input.peakRamSamplesMb ?? [];
    assertSafeInteger(input.p50Mb, "p50Mb");
    assertSafeInteger(input.p95Mb, "p95Mb");
    assertSafeInteger(input.samples, "samples");
    assertSafeInteger(input.updatedAt, "updatedAt");
    assertSafeInteger(p90Mb, "p90Mb");
    assertSafeInteger(peakRamMb, "peakRamMb");
    assertSafeInteger(peakCpuTimeMs, "peakCpuTimeMs");
    assertSafeInteger(diskWriteBytes, "diskWriteBytes");
    assertSafeInteger(wallClockMs, "wallClockMs");
    assertSafeInteger(predictedMb, "predictedMb");
    if (!Number.isFinite(highWatermarkMb)) {
      throw new AuxiliaryDbError("INVALID_INTEGER", "highWatermarkMb must be finite");
    }
    const samplesJson = JSON.stringify(peakRamSamplesMb);
    this.write(() => {
      this.conn.run(
        `INSERT INTO footprints(
           consumer, project, p50_mb, p95_mb, samples, updated_at,
           p90_mb, peak_ram_mb, peak_cpu_time_ms, disk_write_bytes, wall_clock_ms,
           high_watermark_mb, predicted_mb, peak_ram_samples_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(consumer, project) DO UPDATE SET
           p50_mb = excluded.p50_mb,
           p95_mb = excluded.p95_mb,
           samples = excluded.samples,
           updated_at = excluded.updated_at,
           p90_mb = excluded.p90_mb,
           peak_ram_mb = excluded.peak_ram_mb,
           peak_cpu_time_ms = excluded.peak_cpu_time_ms,
           disk_write_bytes = excluded.disk_write_bytes,
           wall_clock_ms = excluded.wall_clock_ms,
           high_watermark_mb = excluded.high_watermark_mb,
           predicted_mb = excluded.predicted_mb,
           peak_ram_samples_json = excluded.peak_ram_samples_json`,
        consumer,
        input.project,
        input.p50Mb,
        input.p95Mb,
        input.samples,
        input.updatedAt,
        p90Mb,
        peakRamMb,
        peakCpuTimeMs,
        diskWriteBytes,
        wallClockMs,
        highWatermarkMb,
        predictedMb,
        samplesJson,
      );
    });
  }

  leasePort(input: LeasePortInput): PortLease {
    this.assertOpen();
    return leasePort(this.conn, input);
  }

  releasePort(port: number): void {
    this.assertOpen();
    releasePort(this.conn, port);
  }

  expirePortLeases(now: number): number {
    this.assertOpen();
    return expirePortLeases(this.conn, now);
  }

  listPortLeases(): readonly PortLease[] {
    this.assertOpen();
    return listPortLeases(this.conn);
  }

  putResearchCache(input: ResearchCacheWrite): ResearchCacheEntry {
    const packageName = assertNonEmpty(input.packageName, "package");
    const versionRange = assertNonEmpty(input.versionRange, "versionRange");
    const docUrl = assertNonEmpty(input.docUrl, "docUrl");
    const artifactHash = assertNonEmpty(input.artifactHash, "artifactHash");
    const fetchedAt = assertSafeInteger(input.fetchedAt, "fetchedAt");
    const expiresAt = fetchedAt + RESEARCH_CACHE_TTL_MS;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new AuxiliaryDbError("RESEARCH_CACHE_TTL", "research cache expiry is out of range");
    }
    const pageVersion = input.pageVersion ?? null;
    return this.write(() => {
      this.conn.run(
        `INSERT INTO research_cache(
           package, version_range, doc_url, page_version, artifact_hash, fetched_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(package, version_range, doc_url) DO UPDATE SET
           page_version = excluded.page_version,
           artifact_hash = excluded.artifact_hash,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
        packageName,
        versionRange,
        docUrl,
        pageVersion,
        artifactHash,
        fetchedAt,
        expiresAt,
      );
      return {
        packageName,
        versionRange,
        docUrl,
        pageVersion,
        artifactHash,
        fetchedAt,
        expiresAt,
      };
    });
  }

  lookupResearchCache(
    key: Pick<ResearchCacheEntry, "packageName" | "versionRange" | "docUrl">,
    now: number,
  ): ResearchCacheEntry | null {
    this.assertOpen();
    assertSafeInteger(now, "now");
    const row = this.conn.get(
      `SELECT * FROM research_cache
       WHERE package = ? AND version_range = ? AND doc_url = ?`,
      key.packageName,
      key.versionRange,
      key.docUrl,
    );
    if (row === undefined) return null;
    const entry = mapResearch(row);
    if (entry.expiresAt > now) return entry;
    this.invalidateResearchCache({
      packageName: key.packageName,
      versionRange: key.versionRange,
      docUrl: key.docUrl,
    });
    return null;
  }

  invalidateResearchCache(filter: ResearchCacheFilter): number {
    const clauses: string[] = [];
    const params: Array<string> = [];
    if (filter.packageName !== undefined) {
      clauses.push("package = ?");
      params.push(filter.packageName);
    }
    if (filter.versionRange !== undefined) {
      clauses.push("version_range = ?");
      params.push(filter.versionRange);
    }
    if (filter.docUrl !== undefined) {
      clauses.push("doc_url = ?");
      params.push(filter.docUrl);
    }
    if (clauses.length === 0) {
      throw new AuxiliaryDbError(
        "RESEARCH_CACHE_FILTER",
        "research cache invalidation needs package, versionRange, or docUrl",
      );
    }
    return this.write(() => {
      const result = this.conn.run(
        `DELETE FROM research_cache WHERE ${clauses.join(" AND ")}`,
        ...params,
      );
      return result.changes;
    });
  }

  upsertConnection(input: ConnectionInput): void {
    assertVaultRef(input.vaultRef ?? null);
    const id = assertNonEmpty(input.id, "connection id");
    const provider = assertNonEmpty(input.provider, "provider");
    const route = assertNonEmpty(input.route, "route");
    const currency = assertNonEmpty(input.currency, "currency");
    const scale = assertSafeInteger(input.scale, "scale");
    const createdAt = assertSafeInteger(input.createdAt, "createdAt");
    this.write(() => {
      this.conn.run(
        `INSERT INTO connections(
           id, provider, route, plan, vault_ref, currency, scale, enabled, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           route = excluded.route,
           plan = excluded.plan,
           vault_ref = excluded.vault_ref,
           currency = excluded.currency,
           scale = excluded.scale,
           enabled = excluded.enabled`,
        id,
        provider,
        route,
        input.plan ?? null,
        input.vaultRef ?? null,
        currency,
        scale,
        input.enabled === false ? 0 : 1,
        createdAt,
      );
    });
  }

  getConnection(id: string): ConnectionRecord | null {
    this.assertOpen();
    const row = this.conn.get("SELECT * FROM connections WHERE id = ?", id);
    return row === undefined ? null : mapConnection(row);
  }

  listConnections(): readonly ConnectionRecord[] {
    this.assertOpen();
    return this.conn
      .all("SELECT * FROM connections ORDER BY id")
      .map((row) => mapConnection(row));
  }

  pinBlob(input: CasPinInput): void {
    const hash = assertNonEmpty(input.hash, "hash");
    assertHolderKind(input.holderKind);
    const holderId = assertNonEmpty(input.holderId, "holderId");
    const pinnedAt = assertSafeInteger(input.pinnedAt, "pinnedAt");
    this.write(() => {
      this.conn.run(
        `INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(hash, holder_kind, holder_id) DO UPDATE SET pinned_at = excluded.pinned_at`,
        hash,
        input.holderKind,
        holderId,
        pinnedAt,
      );
    });
  }

  listPins(): readonly CasPinRecord[] {
    this.assertOpen();
    return this.conn
      .all("SELECT hash, holder_kind, holder_id, pinned_at FROM cas_pins ORDER BY hash, holder_kind, holder_id")
      .map((row) => ({
        hash: requiredText(row, "hash"),
        holderKind: parseHolderKind(requiredText(row, "holder_kind")),
        holderId: requiredText(row, "holder_id"),
        pinnedAt: requiredInt(row, "pinned_at"),
      }));
  }

  insertGrant(input: GrantInput): void {
    const id = assertNonEmpty(input.id, "grant id");
    const projectId = assertNonEmpty(input.projectId, "projectId");
    const connectionId = assertNonEmpty(input.connectionId, "connectionId");
    const units = assertSafeInteger(input.units, "units");
    if (units <= 0) throw new AuxiliaryDbError("INVALID_GRANT", "grant units must be positive");
    const concurrency = input.concurrency ?? 1;
    assertSafeInteger(concurrency, "concurrency");
    assertPriority(input.priorityClass);
    const state = input.state ?? "issued";
    assertGrantState(state);
    const issuedAt = assertSafeInteger(input.issuedAt, "issuedAt");
    const expiresAt = assertSafeInteger(input.expiresAt, "expiresAt");
    this.write(() => {
      try {
        this.conn.run(
          `INSERT INTO grants(
             id, project, connection, currency, units, concurrency, priority_class,
             issued_at, expires_at, state, used_units, unknown_units, closed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          projectId,
          connectionId,
          input.currency,
          units,
          concurrency,
          input.priorityClass,
          issuedAt,
          expiresAt,
          state,
          input.usedUnits ?? null,
          input.unknownUnits ?? null,
          input.closedAt ?? null,
        );
      } catch (error) {
        if (isSqliteConstraint(error)) {
          throw new AuxiliaryDbError("GRANT_CONSTRAINT", "grant violated a global.db constraint");
        }
        throw error;
      }
    });
  }

  listGrants(projectId: string): readonly GrantRecord[] {
    this.assertOpen();
    return this.conn
      .all(
        `SELECT id, project, connection, currency, units, concurrency, priority_class,
                issued_at, expires_at, state, used_units, unknown_units, closed_at
         FROM grants
         WHERE project = ?
         ORDER BY id`,
        projectId,
      )
      .map((row) => ({
        id: requiredText(row, "id"),
        projectId: requiredText(row, "project"),
        connectionId: requiredText(row, "connection"),
        currency: requiredText(row, "currency"),
        units: requiredInt(row, "units"),
        concurrency: requiredInt(row, "concurrency"),
        priorityClass: parsePriority(requiredText(row, "priority_class")),
        issuedAt: requiredInt(row, "issued_at"),
        expiresAt: requiredInt(row, "expires_at"),
        state: parseGrantState(requiredText(row, "state")),
        usedUnits: optionalInt(row, "used_units"),
        unknownUnits: optionalInt(row, "unknown_units"),
        closedAt: optionalInt(row, "closed_at"),
      }));
  }

  upsertAdapterConformance(input: AdapterConformanceWrite): void {
    const reportJson = input.reportJson;
    if (!reportJson.startsWith("{")) {
      throw new InvalidSettingValueError("adapter conformance report must be a JSON object");
    }
    this.write(() => {
      this.conn.run(
        `INSERT INTO adapter_conformance(
           adapter_id, cli_version, os_sandbox_tier, mode, suite_version,
           trust, payload, signature, report_json, active, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(adapter_id, cli_version, os_sandbox_tier, mode, suite_version)
         DO UPDATE SET
           trust = excluded.trust,
           payload = excluded.payload,
           signature = excluded.signature,
           report_json = excluded.report_json,
           updated_at = excluded.updated_at`,
        input.adapterId,
        input.cliVersion,
        input.osSandboxTier,
        input.mode,
        input.suiteVersion,
        input.trust,
        input.payload,
        input.signature,
        reportJson,
        Date.now(),
      );
    });
  }

  activateAdapterConformance(input: AdapterConformanceKey & { readonly mode: string }): void {
    this.write(() => {
      this.conn.run(
        `UPDATE adapter_conformance SET active = 0
         WHERE adapter_id = ? AND cli_version = ? AND os_sandbox_tier = ? AND suite_version = ?`,
        input.adapterId,
        input.cliVersion,
        input.osSandboxTier,
        input.suiteVersion,
      );
      this.conn.run(
        `UPDATE adapter_conformance SET active = 1
         WHERE adapter_id = ? AND cli_version = ? AND os_sandbox_tier = ? AND suite_version = ? AND mode = ?`,
        input.adapterId,
        input.cliVersion,
        input.osSandboxTier,
        input.suiteVersion,
        input.mode,
      );
    });
  }

  findActiveAdapterConformance(input: AdapterConformanceKey): AdapterConformanceWrite | null {
    this.assertOpen();
    const row = this.conn.get(
      `SELECT adapter_id, cli_version, os_sandbox_tier, mode, suite_version,
              trust, payload, signature, report_json
       FROM adapter_conformance
       WHERE adapter_id = ? AND cli_version = ? AND os_sandbox_tier = ? AND suite_version = ? AND active = 1`,
      input.adapterId,
      input.cliVersion,
      input.osSandboxTier,
      input.suiteVersion,
    );
    if (row === undefined) return null;
    return {
      adapterId: requiredText(row, "adapter_id"),
      cliVersion: requiredText(row, "cli_version"),
      osSandboxTier: requiredText(row, "os_sandbox_tier"),
      mode: requiredText(row, "mode"),
      suiteVersion: requiredText(row, "suite_version"),
      trust: requiredText(row, "trust"),
      payload: requiredText(row, "payload"),
      signature: requiredText(row, "signature"),
      reportJson: requiredText(row, "report_json"),
    };
  }

  rewriteAdapterConformanceSignature(input: AdapterConformanceKey, signature: string): void {
    this.write(() => {
      this.conn.run(
        `UPDATE adapter_conformance SET signature = ?, updated_at = ?
         WHERE adapter_id = ? AND cli_version = ? AND os_sandbox_tier = ? AND suite_version = ? AND active = 1`,
        signature,
        Date.now(),
        input.adapterId,
        input.cliVersion,
        input.osSandboxTier,
        input.suiteVersion,
      );
    });
  }

  private write<T>(fn: () => T): T {
    this.assertOpen();
    if (this.conn.inTransaction()) return fn();
    return this.conn.runImmediate(fn);
  }

  private requireProject(id: string): ProjectRecord {
    const row = this.conn.get("SELECT * FROM projects WHERE id = ?", id);
    if (row === undefined) throw new ProjectNotFoundError(id);
    return mapProject(row);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AuxiliaryDbError("BROKER_CLOSED", "global broker is closed");
    }
  }
}

function createGlobalDatabase(filePath: string, deviceId: string, createdAt: number): void {
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw new DeviceIdInvalidError();
  removeStaleInitFiles(filePath);
  const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.init.tmp`;
  const connection = openSqliteConnection(temporary, "global");
  try {
    connection.runImmediate(() => {
      connection.exec(loadCanonicalSchema("global"));
      connection.run("INSERT INTO meta(key, value) VALUES ('device_id', ?)", deviceId);
      connection.run(
        `INSERT INTO schema_migrations(version, name, kind, app_version, applied_at)
         VALUES (1, 'global-schema-v1', 'additive', '0.0.0', ?)`,
        createdAt,
      );
      connection.exec(DEVICE_ID_GUARDS);
      connection.exec("PRAGMA user_version = 1");
    });
    connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (error) {
    connection.close();
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  connection.close();
  renameWithRetry(temporary, filePath);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${temporary}${suffix}`;
    if (!fs.existsSync(sidecar)) continue;
    try {
      removeWithRetry(sidecar);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code: unknown }).code
          : undefined;
      if (code === "ENOENT" || code === "EPERM" || code === "EBUSY" || code === "EACCES") continue;
      throw error;
    }
  }
}

function removeStaleInitFiles(filePath: string): void {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.`;
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith(prefix) || !name.includes(".init.tmp")) continue;
    removeWithRetry(path.join(directory, name));
  }
}

function openVerifiedGlobal(filePath: string): SqliteConnection {
  let connection: SqliteConnection | undefined;
  try {
    connection = openSqliteConnection(filePath, "global");
    assertQuickCheck(connection);
    const settings = readConnectionSettings(connection);
    const supported = maxKnownSchemaVersion(productionMigrations, "global", PRODUCTION_SCHEMA_VERSION);
    if (settings.userVersion > supported || settings.userVersion < PRODUCTION_SCHEMA_VERSION) {
      throw new GlobalSchemaVersionError(settings.userVersion, supported);
    }
    if (settings.journalMode !== "wal") {
      throw new GlobalDatabaseCorruptError(`journal_mode is ${settings.journalMode}`);
    }
    const meta = connection.get(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
    );
    if (meta === undefined) throw new GlobalDatabaseCorruptError("global.db has no meta table");
    return connection;
  } catch (error) {
    connection?.close();
    if (error instanceof GlobalDatabaseCorruptError || error instanceof GlobalSchemaVersionError) {
      throw error;
    }
    if (isSqliteCorruption(error) || (error instanceof AuxiliaryDbError && error.code === "QUICK_CHECK_FAILED")) {
      throw new GlobalDatabaseCorruptError(error instanceof Error ? error.message : "corrupt");
    }
    throw error;
  }
}

function readDeviceId(connection: SqliteConnection): string {
  const row = connection.get("SELECT value FROM meta WHERE key = 'device_id'");
  if (row === undefined) throw new DeviceIdMissingError();
  const value = requiredText(row, "value");
  if (!DEVICE_ID_PATTERN.test(value)) throw new DeviceIdInvalidError();
  return value;
}

function nextWriterEpoch(connection: SqliteConnection): number {
  const row = connection.get("SELECT value FROM meta WHERE key = 'owner'");
  if (row === undefined) return 1;
  const owner = parseOwner(requiredText(row, "value"));
  if (owner === null) throw new GlobalDatabaseCorruptError("owner row is malformed");
  if (!Number.isSafeInteger(owner.epoch + 1)) {
    throw new GlobalDatabaseCorruptError("owner epoch overflow");
  }
  return owner.epoch + 1;
}

function writeOwner(
  connection: SqliteConnection,
  identity: ProcessIdentity,
  epoch: number,
  acquiredAt: number,
): BrokerOwner {
  const owner: BrokerOwner = {
    pid: identity.pid,
    processStartTime: identity.processStartTime,
    epoch,
    hostname: identity.hostname,
    acquiredAt,
    role: "broker",
  };
  connection.run(
    `INSERT INTO meta(key, value) VALUES ('owner', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    JSON.stringify(owner),
  );
  return owner;
}

function parseOwner(value: string): BrokerOwner | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.role !== "broker") return null;
  if (typeof record.pid !== "number" || !Number.isInteger(record.pid)) return null;
  if (typeof record.processStartTime !== "number" || !Number.isInteger(record.processStartTime)) {
    return null;
  }
  if (typeof record.epoch !== "number" || !Number.isInteger(record.epoch) || record.epoch < 1) {
    return null;
  }
  if (typeof record.hostname !== "string" || record.hostname.length === 0) return null;
  if (typeof record.acquiredAt !== "number" || !Number.isInteger(record.acquiredAt)) return null;
  return {
    pid: record.pid,
    processStartTime: record.processStartTime,
    epoch: record.epoch,
    hostname: record.hostname,
    acquiredAt: record.acquiredAt,
    role: "broker",
  };
}

function readConnectionSettings(connection: SqliteConnection): GlobalConnectionSettings {
  return {
    journalMode: String(connection.readPragma("journal_mode") ?? "").toLowerCase(),
    synchronous: synchronousName(connection.readPragma("synchronous")),
    foreignKeys: flagPragma(connection.readPragma("foreign_keys")),
    secureDelete: flagPragma(connection.readPragma("secure_delete")),
    userVersion: integerPragma(connection.readPragma("user_version"), "user_version"),
    busyTimeoutMs: integerPragma(connection.readPragma("busy_timeout"), "busy_timeout"),
  };
}

function synchronousName(value: ReturnType<SqliteConnection["readPragma"]>): string {
  if (value === 2 || value === "2" || value === "full") return "full";
  if (value === 1 || value === "1" || value === "normal") return "normal";
  if (value === 0 || value === "0" || value === "off") return "off";
  return String(value);
}

function flagPragma(value: ReturnType<SqliteConnection["readPragma"]>): boolean {
  return value === 1 || value === "1" || value === "on";
}

function integerPragma(value: ReturnType<SqliteConnection["readPragma"]>, name: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "bigint") return bigintToNumber(value);
  throw new AuxiliaryDbError("PRAGMA_VALUE", `${name} was not an integer`);
}

function mapProject(row: Parameters<typeof requiredText>[0]): ProjectRecord {
  return {
    id: requiredText(row, "id"),
    path: requiredText(row, "path"),
    displayName: requiredText(row, "display_name"),
    schemaVersion: requiredInt(row, "schema_version"),
    status: parseStatus(requiredText(row, "status")),
    lastOpenedAt: optionalInt(row, "last_opened_at"),
    lastSeenAt: optionalInt(row, "last_seen_at"),
  };
}

function mapFootprint(row: Parameters<typeof requiredText>[0]): FootprintEntry {
  return {
    consumer: requiredText(row, "consumer"),
    project: requiredText(row, "project"),
    p50Mb: requiredInt(row, "p50_mb"),
    p95Mb: requiredInt(row, "p95_mb"),
    samples: requiredInt(row, "samples"),
    updatedAt: requiredInt(row, "updated_at"),
    p90Mb: requiredInt(row, "p90_mb"),
    peakRamMb: requiredInt(row, "peak_ram_mb"),
    peakCpuTimeMs: requiredInt(row, "peak_cpu_time_ms"),
    diskWriteBytes: requiredInt(row, "disk_write_bytes"),
    wallClockMs: requiredInt(row, "wall_clock_ms"),
    highWatermarkMb: requiredFinite(row, "high_watermark_mb"),
    predictedMb: requiredInt(row, "predicted_mb"),
    peakRamSamplesMb: parseRamSamples(requiredText(row, "peak_ram_samples_json")),
  };
}

function requiredFinite(row: Parameters<typeof requiredText>[0], key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return bigintToNumber(value);
  throw new AuxiliaryDbError("ROW_SHAPE", `expected number in column ${key}`);
}

function parseRamSamples(raw: string): readonly number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuxiliaryDbError("ROW_SHAPE", "peak_ram_samples_json is not JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new AuxiliaryDbError("ROW_SHAPE", "peak_ram_samples_json must be an array");
  }
  return parsed.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new AuxiliaryDbError("ROW_SHAPE", `peak_ram_samples_json[${index}] must be a number`);
    }
    return item;
  });
}

function mapResearch(row: Parameters<typeof requiredText>[0]): ResearchCacheEntry {
  return {
    packageName: requiredText(row, "package"),
    versionRange: requiredText(row, "version_range"),
    docUrl: requiredText(row, "doc_url"),
    pageVersion: optionalText(row, "page_version"),
    artifactHash: requiredText(row, "artifact_hash"),
    fetchedAt: requiredInt(row, "fetched_at"),
    expiresAt: requiredInt(row, "expires_at"),
  };
}

function mapConnection(row: Parameters<typeof requiredText>[0]): ConnectionRecord {
  return {
    id: requiredText(row, "id"),
    provider: requiredText(row, "provider"),
    route: requiredText(row, "route"),
    plan: optionalText(row, "plan"),
    vaultRef: optionalText(row, "vault_ref"),
    currency: requiredText(row, "currency"),
    scale: requiredInt(row, "scale"),
    enabled: requiredFlag(row, "enabled"),
    createdAt: requiredInt(row, "created_at"),
  };
}

function encodeJson(value: unknown): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new InvalidSettingValueError(error instanceof Error ? error.message : "value is not JSON");
  }
  if (typeof encoded !== "string") {
    throw new InvalidSettingValueError("value is not JSON");
  }
  return encoded;
}

function assertSettingKey(key: string): string {
  return assertNonEmpty(key, "setting key");
}

function assertStatus(status: string): asserts status is ProjectStatus {
  if (!(PROJECT_STATUSES as readonly string[]).includes(status)) {
    throw new InvalidProjectStatusError(status);
  }
}

function parseStatus(status: string): ProjectStatus {
  assertStatus(status);
  return status;
}

function assertHolderKind(kind: string): asserts kind is PinHolderKind {
  if (!(PIN_HOLDER_KINDS as readonly string[]).includes(kind)) {
    throw new AuxiliaryDbError("INVALID_PIN_HOLDER", `unknown pin holder ${kind}`);
  }
}

function parseHolderKind(kind: string): PinHolderKind {
  assertHolderKind(kind);
  return kind;
}

function assertPriority(priority: string): asserts priority is GrantPriority {
  if (!(GRANT_PRIORITIES as readonly string[]).includes(priority)) {
    throw new AuxiliaryDbError("INVALID_GRANT", `unknown priority ${priority}`);
  }
}

function parsePriority(priority: string): GrantPriority {
  assertPriority(priority);
  return priority;
}

function assertGrantState(state: string): asserts state is GrantState {
  if (!(GRANT_STATES as readonly string[]).includes(state)) {
    throw new AuxiliaryDbError("INVALID_GRANT", `unknown grant state ${state}`);
  }
}

function parseGrantState(state: string): GrantState {
  assertGrantState(state);
  return state;
}
