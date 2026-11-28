import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import {
  API_KEY_AUTH_MODE,
  ApiKeyOnboardingError,
  MICRO_USD_SCALE,
  type ApiConnectionRecord,
  type ApiKeyFamily,
  type ApiKeyProviderId,
  type ConnectionStatus,
  type CustomRateTable,
} from "./api-key-types.js";
import { assertRateTable } from "./integer-micro-usd.js";

/**
 * Local stand-in for Task 014 `GlobalDbRepo.connections`.
 * Rows keep the foundation connection columns plus API-key metadata.
 * Raw keys are not a column.
 */
export interface GlobalDbConnectionsPort {
  insert(record: ApiConnectionRecord): void;
  update(record: ApiConnectionRecord): void;
  get(connectionId: string): ApiConnectionRecord | undefined;
  list(): readonly ApiConnectionRecord[];
  delete(connectionId: string): void;
  metadataText(): string;
  readAtRestBytes(): Uint8Array;
  close(): void;
}

const PROVIDERS = new Set<ApiKeyProviderId>(["anthropic", "openai", "openrouter", "gemini", "custom"]);

const STATUSES = new Set<ConnectionStatus>([
  "verified",
  "unverified_offline",
  "billing_not_active",
  "insufficient_quota",
  "org_restriction",
  "rate_limited",
  "provider_error",
  "rejected_by_provider",
  "disabled",
]);

const FAMILIES = new Set<ApiKeyFamily>([
  "anthropic_console",
  "openai_project",
  "openai_standard",
  "openrouter_v1",
  "gemini_developer",
  "provider_selected",
  "custom",
]);

export class LocalGlobalDbConnections implements GlobalDbConnectionsPort {
  private readonly db: DatabaseSync;
  private readonly filePath: string;
  private readonly directory: string;
  private closed = false;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.directory = directory;
    this.filePath = path.join(directory, "global.db");
    this.db = new DatabaseSync(this.filePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('anthropic','openai','openrouter','gemini','custom')),
        route TEXT NOT NULL CHECK (route = 'api_key'),
        plan TEXT,
        vault_ref TEXT,
        currency TEXT NOT NULL CHECK (currency = 'usd'),
        scale INTEGER NOT NULL CHECK (scale = 1000000),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS api_key_connection_meta (
        connection_id TEXT PRIMARY KEY REFERENCES connections(id),
        label TEXT NOT NULL,
        auth_mode TEXT NOT NULL CHECK (auth_mode = 'api_key'),
        masked_key_preview TEXT NOT NULL,
        discovered_models_json TEXT NOT NULL,
        user_monthly_cap_micro_usd TEXT,
        verified_at INTEGER,
        status TEXT NOT NULL CHECK (status IN (
          'verified','unverified_offline','billing_not_active','insufficient_quota',
          'org_restriction','rate_limited','provider_error','rejected_by_provider','disabled'
        )),
        resume_status TEXT,
        custom_base_url TEXT,
        custom_rates_json TEXT,
        key_family TEXT NOT NULL
      ) STRICT;
    `);
  }

  insert(record: ApiConnectionRecord): void {
    this.write(record, false);
  }

  update(record: ApiConnectionRecord): void {
    this.write(record, true);
  }

  get(connectionId: string): ApiConnectionRecord | undefined {
    const row = this.db
      .prepare(`${SELECT_SQL} WHERE c.id = ?`)
      .get(connectionId);
    if (!row) return undefined;
    return mapRow(row);
  }

  list(): readonly ApiConnectionRecord[] {
    return this.db
      .prepare(`${SELECT_SQL} ORDER BY c.created_at ASC, c.id ASC`)
      .all()
      .map((row) => mapRow(row));
  }

  delete(connectionId: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM api_key_connection_meta WHERE connection_id = ?").run(connectionId);
      this.db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);
    });
  }

  metadataText(): string {
    const connections = this.db.prepare("SELECT * FROM connections ORDER BY id").all();
    const meta = this.db.prepare("SELECT * FROM api_key_connection_meta ORDER BY connection_id").all();
    return JSON.stringify({ connections, meta });
  }

  readAtRestBytes(): Uint8Array {
    const dest = path.join(this.directory, "global.snapshot.sqlite");
    rmSync(dest, { force: true });
    const sqlPath = dest.replaceAll("\\", "/").replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${sqlPath}'`);
    const bytes = readFileSync(dest);
    rmSync(dest, { force: true });
    return bytes;
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  private write(record: ApiConnectionRecord, existing: boolean): void {
    assertRecord(record);
    const ratesJson = record.customRates ? JSON.stringify(serializeRates(record.customRates)) : null;
    const cap = record.userMonthlyCapMicroUsd === null ? null : record.userMonthlyCapMicroUsd.toString();
    this.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            `UPDATE connections
             SET provider = ?, vault_ref = ?, enabled = ?
             WHERE id = ?`,
          )
          .run(record.provider, record.vaultRef, record.enabled ? 1 : 0, record.connectionId);
        this.db
          .prepare(
            `UPDATE api_key_connection_meta
             SET label = ?, masked_key_preview = ?, discovered_models_json = ?,
                 user_monthly_cap_micro_usd = ?, verified_at = ?, status = ?, resume_status = ?,
                 custom_base_url = ?, custom_rates_json = ?, key_family = ?
             WHERE connection_id = ?`,
          )
          .run(
            record.label,
            record.maskedKeyPreview,
            JSON.stringify(record.discoveredModels),
            cap,
            record.verifiedAt,
            record.status,
            record.resumeStatus,
            record.customBaseUrl,
            ratesJson,
            record.keyFamily,
            record.connectionId,
          );
        return;
      }
      this.db
        .prepare(
          `INSERT INTO connections (
             id, provider, route, plan, vault_ref, currency, scale, enabled, created_at
           ) VALUES (?, ?, 'api_key', NULL, ?, 'usd', ?, ?, ?)`,
        )
        .run(
          record.connectionId,
          record.provider,
          record.vaultRef,
          MICRO_USD_SCALE,
          record.enabled ? 1 : 0,
          record.createdAt,
        );
      this.db
        .prepare(
          `INSERT INTO api_key_connection_meta (
             connection_id, label, auth_mode, masked_key_preview, discovered_models_json,
             user_monthly_cap_micro_usd, verified_at, status, resume_status,
             custom_base_url, custom_rates_json, key_family
           ) VALUES (?, ?, 'api_key', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.connectionId,
          record.label,
          record.maskedKeyPreview,
          JSON.stringify(record.discoveredModels),
          cap,
          record.verifiedAt,
          record.status,
          record.resumeStatus,
          record.customBaseUrl,
          ratesJson,
          record.keyFamily,
        );
    });
  }

  private transaction(work: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

const SELECT_SQL = `
  SELECT
    c.id, c.provider, c.vault_ref, c.enabled, c.created_at,
    m.label, m.auth_mode, m.masked_key_preview, m.discovered_models_json,
    m.user_monthly_cap_micro_usd, m.verified_at, m.status, m.resume_status,
    m.custom_base_url, m.custom_rates_json, m.key_family
  FROM connections c
  JOIN api_key_connection_meta m ON m.connection_id = c.id
`;

function assertRecord(record: ApiConnectionRecord): void {
  if (!PROVIDERS.has(record.provider)) {
    throw new ApiKeyOnboardingError("Connection provider is not supported");
  }
  if (!STATUSES.has(record.status)) {
    throw new ApiKeyOnboardingError("Connection status is not supported");
  }
  if (record.resumeStatus !== null && !STATUSES.has(record.resumeStatus)) {
    throw new ApiKeyOnboardingError("Connection resume status is not supported");
  }
  if (!FAMILIES.has(record.keyFamily)) {
    throw new ApiKeyOnboardingError("Connection key family is not supported");
  }
  if (record.authMode !== API_KEY_AUTH_MODE) {
    throw new ApiKeyOnboardingError("API key connections must use auth mode api_key");
  }
  if (record.label.trim().length === 0) {
    throw new ApiKeyOnboardingError("Enter a label for this connection.");
  }
}

function mapRow(row: Record<string, SQLOutputValue>): ApiConnectionRecord {
  const provider = requiredText(row, "provider");
  const status = requiredText(row, "status");
  const keyFamily = requiredText(row, "key_family");
  if (!isProvider(provider) || !isStatus(status) || !isFamily(keyFamily)) {
    throw new ApiKeyOnboardingError("global.db connection row is corrupt");
  }
  const resume = optionalText(row, "resume_status");
  if (resume !== null && !isStatus(resume)) {
    throw new ApiKeyOnboardingError("global.db connection row is corrupt");
  }
  const capText = optionalText(row, "user_monthly_cap_micro_usd");
  return {
    connectionId: requiredText(row, "id"),
    provider,
    label: requiredText(row, "label"),
    authMode: API_KEY_AUTH_MODE,
    maskedKeyPreview: requiredText(row, "masked_key_preview"),
    discoveredModels: parseModels(requiredText(row, "discovered_models_json")),
    userMonthlyCapMicroUsd: capText === null ? null : BigInt(capText),
    verifiedAt: optionalInt(row, "verified_at"),
    status,
    resumeStatus: resume,
    enabled: requiredInt(row, "enabled") === 1,
    keyFamily,
    customBaseUrl: optionalText(row, "custom_base_url"),
    customRates: parseRates(optionalText(row, "custom_rates_json")),
    vaultRef: requiredText(row, "vault_ref"),
    createdAt: requiredInt(row, "created_at"),
    currency: "usd",
    scale: MICRO_USD_SCALE,
  };
}

function parseModels(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new ApiKeyOnboardingError("Discovered model list is corrupt");
  }
  return parsed;
}

function parseRates(json: string | null): CustomRateTable | null {
  if (json === null) return null;
  const parsed = JSON.parse(json) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new ApiKeyOnboardingError("Custom rate table is corrupt");
  }
  const record = parsed as Record<string, unknown>;
  return assertRateTable({
    inputMicroUsdPer1M: big(record.inputMicroUsdPer1M),
    outputMicroUsdPer1M: big(record.outputMicroUsdPer1M),
    cachedInputReadMicroUsdPer1M: big(record.cachedInputReadMicroUsdPer1M),
    cacheWriteMicroUsdPer1M: big(record.cacheWriteMicroUsdPer1M),
    reasoningTokenMicroUsdPer1M: big(record.reasoningTokenMicroUsdPer1M),
  });
}

function serializeRates(rates: CustomRateTable): Record<string, string> {
  const safe = assertRateTable(rates);
  return {
    inputMicroUsdPer1M: safe.inputMicroUsdPer1M.toString(),
    outputMicroUsdPer1M: safe.outputMicroUsdPer1M.toString(),
    cachedInputReadMicroUsdPer1M: safe.cachedInputReadMicroUsdPer1M.toString(),
    cacheWriteMicroUsdPer1M: safe.cacheWriteMicroUsdPer1M.toString(),
    reasoningTokenMicroUsdPer1M: safe.reasoningTokenMicroUsdPer1M.toString(),
  };
}

function big(value: unknown): bigint {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return BigInt(value);
  throw new ApiKeyOnboardingError("Custom rate table is corrupt");
}

function requiredText(row: Record<string, SQLOutputValue>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new ApiKeyOnboardingError(`global.db column ${key} was not text`);
  }
  return value;
}

function optionalText(row: Record<string, SQLOutputValue>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ApiKeyOnboardingError(`global.db column ${key} was not text`);
  }
  return value;
}

function requiredInt(row: Record<string, SQLOutputValue>, key: string): number {
  const value = optionalInt(row, key);
  if (value === null) throw new ApiKeyOnboardingError(`global.db column ${key} was not an integer`);
  return value;
}

function optionalInt(row: Record<string, SQLOutputValue>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n) {
    return Number(value);
  }
  throw new ApiKeyOnboardingError(`global.db column ${key} was not an integer`);
}

function isProvider(value: string): value is ApiKeyProviderId {
  return PROVIDERS.has(value as ApiKeyProviderId);
}

function isStatus(value: string): value is ConnectionStatus {
  return STATUSES.has(value as ConnectionStatus);
}

function isFamily(value: string): value is ApiKeyFamily {
  return FAMILIES.has(value as ApiKeyFamily);
}
