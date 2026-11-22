import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GlobalDbRepo } from "./ports.js";
import { assertEnvScope } from "./patterns.js";
import type { EnvScope, SecretMetadata, VerifiedStatus } from "./types.js";
import { VERIFIED_STATUSES } from "./types.js";

const DDL = `
CREATE TABLE IF NOT EXISTS vault_secret_metadata (
  secret_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  env_scope TEXT NOT NULL,
  name TEXT NOT NULL,
  last_four_masked TEXT NOT NULL,
  provider_hint TEXT,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER,
  verified_status TEXT NOT NULL,
  credential_target TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  tagged_prod INTEGER NOT NULL CHECK (tagged_prod IN (0, 1)),
  test_override INTEGER NOT NULL CHECK (test_override IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS vault_secret_name_scope
  ON vault_secret_metadata(project_id, env_scope, name);
`;

export class SqliteVaultMetadataStore implements GlobalDbRepo {
  private readonly globalDb: DatabaseSync;
  private readonly stateDb: DatabaseSync;
  private closed = false;

  constructor(globalDbPath: string, stateDbPath: string) {
    if (path.resolve(globalDbPath) === path.resolve(stateDbPath)) {
      throw new Error("global.db and state.db must be different files.");
    }
    this.globalDb = openVaultDb(globalDbPath);
    this.stateDb = openVaultDb(stateDbPath);
  }

  upsertVaultMetadata(row: SecretMetadata): void {
    this.write(this.globalDb, row);
    try {
      this.write(this.stateDb, row);
    } catch (error) {
      this.remove(this.globalDb, row.secretId);
      throw error;
    }
  }

  getVaultMetadata(secretId: string): SecretMetadata | null {
    const row = this.globalDb
      .prepare("SELECT * FROM vault_secret_metadata WHERE secret_id = ?")
      .get(secretId);
    return asMetadata(row);
  }

  deleteVaultMetadata(secretId: string): void {
    this.remove(this.globalDb, secretId);
    this.remove(this.stateDb, secretId);
  }

  findVaultMetadataByName(projectId: string, envScope: EnvScope, name: string): SecretMetadata | null {
    const row = this.globalDb
      .prepare(
        "SELECT * FROM vault_secret_metadata WHERE project_id = ? AND env_scope = ? AND name = ?",
      )
      .get(projectId, envScope, name);
    return asMetadata(row);
  }

  listVaultMetadata(query?: {
    readonly projectId?: string;
    readonly envScope?: EnvScope;
  }): readonly SecretMetadata[] {
    const projectId = query?.projectId ?? null;
    const envScope = query?.envScope ?? null;
    const rows = this.globalDb
      .prepare(
        `SELECT * FROM vault_secret_metadata
         WHERE (? IS NULL OR project_id = ?)
           AND (? IS NULL OR env_scope = ?)
         ORDER BY name`,
      )
      .all(projectId, projectId, envScope, envScope);
    const records: SecretMetadata[] = [];
    for (const row of rows) {
      const mapped = asMetadata(row);
      if (mapped) records.push(mapped);
    }
    return records;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.globalDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.stateDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.globalDb.close();
    this.stateDb.close();
  }

  private write(db: DatabaseSync, row: SecretMetadata): void {
    db.prepare(
      `INSERT INTO vault_secret_metadata (
         secret_id, project_id, env_scope, name, last_four_masked, provider_hint,
         created_at, rotated_at, verified_status, credential_target, fingerprint,
         tagged_prod, test_override
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(secret_id) DO UPDATE SET
         project_id = excluded.project_id,
         env_scope = excluded.env_scope,
         name = excluded.name,
         last_four_masked = excluded.last_four_masked,
         provider_hint = excluded.provider_hint,
         created_at = excluded.created_at,
         rotated_at = excluded.rotated_at,
         verified_status = excluded.verified_status,
         credential_target = excluded.credential_target,
         fingerprint = excluded.fingerprint,
         tagged_prod = excluded.tagged_prod,
         test_override = excluded.test_override`,
    ).run(
      row.secretId,
      row.projectId,
      row.envScope,
      row.name,
      row.lastFourMasked,
      row.providerHint ?? null,
      row.createdAt,
      row.rotatedAt ?? null,
      row.verifiedStatus,
      row.credentialTarget,
      row.fingerprint,
      row.taggedProd ? 1 : 0,
      row.testOverride ? 1 : 0,
    );
  }

  private remove(db: DatabaseSync, secretId: string): void {
    db.prepare("DELETE FROM vault_secret_metadata WHERE secret_id = ?").run(secretId);
  }
}

function openVaultDb(file: string): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA secure_delete = ON");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(DDL);
  return db;
}

function asMetadata(value: unknown): SecretMetadata | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const secretId = asString(row.secret_id);
  const projectId = asString(row.project_id);
  const envScopeRaw = asString(row.env_scope);
  const name = asString(row.name);
  const lastFourMasked = asString(row.last_four_masked);
  const verifiedRaw = asString(row.verified_status);
  const credentialTarget = asString(row.credential_target);
  const fingerprint = asString(row.fingerprint);
  const createdAt = asInt(row.created_at);
  if (
    !secretId ||
    !projectId ||
    !envScopeRaw ||
    !name ||
    !lastFourMasked ||
    !verifiedRaw ||
    !credentialTarget ||
    !fingerprint ||
    createdAt === null
  ) {
    return null;
  }
  const verifiedStatus = asVerified(verifiedRaw);
  if (!verifiedStatus) return null;
  const rotatedAt = row.rotated_at === null ? undefined : asInt(row.rotated_at);
  if (row.rotated_at !== null && rotatedAt === null) return null;
  const providerHint = row.provider_hint === null ? undefined : asString(row.provider_hint);
  if (row.provider_hint !== null && !providerHint) return null;
  const base = {
    secretId,
    projectId,
    envScope: assertEnvScope(envScopeRaw),
    name,
    lastFourMasked,
    createdAt,
    verifiedStatus,
    credentialTarget,
    fingerprint,
    taggedProd: asInt(row.tagged_prod) === 1,
    testOverride: asInt(row.test_override) === 1,
  };
  return {
    ...base,
    ...(providerHint ? { providerHint } : {}),
    ...(rotatedAt !== undefined && rotatedAt !== null ? { rotatedAt } : {}),
  };
}

function asVerified(value: string): VerifiedStatus | null {
  return VERIFIED_STATUSES.find((item) => item === value) ?? null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value);
  }
  return null;
}
