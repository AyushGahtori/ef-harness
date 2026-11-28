import { existsSync, readFileSync } from "node:fs";
import { GlobalBrokerDb } from "@ef-harness/db";
import { redactSecrets } from "@ef-harness/shared-observability";
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
 * API-key rows on Task 014 `GlobalBrokerDb.connections` plus `connection_profiles`.
 * Route and provider stay unconstrained in SQL so subscription and local rows can share the file.
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

interface ApiKeyProfile {
  label: string;
  authMode: typeof API_KEY_AUTH_MODE;
  maskedKeyPreview: string;
  discoveredModels: string[];
  userMonthlyCapMicroUsd: string | null;
  verifiedAt: number | null;
  status: ConnectionStatus;
  resumeStatus: ConnectionStatus | null;
  customBaseUrl: string | null;
  customRates: Record<string, string> | null;
  keyFamily: ApiKeyFamily;
}

export class LocalGlobalDbConnections implements GlobalDbConnectionsPort {
  private readonly global: GlobalBrokerDb;
  private readonly owned: boolean;
  private closed = false;

  constructor(directory: string, shared?: GlobalBrokerDb) {
    if (shared) {
      this.global = shared;
      this.owned = false;
    } else {
      this.global = GlobalBrokerDb.open({ root: directory });
      this.owned = true;
    }
  }

  insert(record: ApiConnectionRecord): void {
    this.write(record, false);
  }

  update(record: ApiConnectionRecord): void {
    this.write(record, true);
  }

  get(connectionId: string): ApiConnectionRecord | undefined {
    const row = this.global.getConnection(connectionId);
    if (!row || row.route !== "api_key") return undefined;
    const profile = this.readProfile(connectionId);
    if (!profile) return undefined;
    return mapRecord(row, profile);
  }

  list(): readonly ApiConnectionRecord[] {
    const records: ApiConnectionRecord[] = [];
    for (const row of this.global.listConnections()) {
      if (row.route !== "api_key") continue;
      const profile = this.readProfile(row.id);
      if (!profile) continue;
      records.push(mapRecord(row, profile));
    }
    records.sort((left, right) => left.createdAt - right.createdAt || left.connectionId.localeCompare(right.connectionId));
    return records;
  }

  delete(connectionId: string): void {
    this.global.transaction(() => {
      this.global.writer.run("DELETE FROM connection_profiles WHERE connection_id = ?", [connectionId]);
      this.global.writer.run("DELETE FROM connections WHERE id = ?", [connectionId]);
    });
  }

  metadataText(): string {
    const connections = this.global.writer.all("SELECT * FROM connections ORDER BY id");
    const profiles = this.global.writer.all(
      "SELECT connection_id, kind, profile_json, updated_at FROM connection_profiles ORDER BY connection_id",
    );
    return redactSecrets(JSON.stringify({ connections, profiles }));
  }

  readAtRestBytes(): Uint8Array {
    const files = [this.global.filePath, `${this.global.filePath}-wal`, `${this.global.filePath}-shm`];
    const chunks: Buffer[] = [];
    for (const file of files) {
      if (existsSync(file)) chunks.push(readFileSync(file));
    }
    return Buffer.concat(chunks);
  }

  close(): void {
    if (this.closed || !this.owned) return;
    this.closed = true;
    this.global.close();
  }

  private write(record: ApiConnectionRecord, existing: boolean): void {
    assertRecord(record);
    const current = existing ? this.global.getConnection(record.connectionId) : null;
    if (existing && !current) {
      throw new ApiKeyOnboardingError("Connection was not found.");
    }
    const profile = profileFromRecord(record);
    this.global.transaction(() => {
      this.global.upsertConnection({
        id: record.connectionId,
        provider: record.provider,
        route: "api_key",
        plan: null,
        vaultRef: record.vaultRef,
        currency: "usd",
        scale: record.scale,
        enabled: record.enabled,
        createdAt: current?.createdAt ?? record.createdAt,
      });
      this.global.writer.run(
        `INSERT INTO connection_profiles (connection_id, kind, profile_json, updated_at)
         VALUES (?, 'api_key', ?, ?)
         ON CONFLICT(connection_id) DO UPDATE SET
           kind = excluded.kind,
           profile_json = excluded.profile_json,
           updated_at = excluded.updated_at`,
        [record.connectionId, JSON.stringify(profile), record.createdAt],
      );
    });
  }

  private readProfile(connectionId: string): ApiKeyProfile | null {
    const row = asRow(
      this.global.writer.get(
        "SELECT kind, profile_json FROM connection_profiles WHERE connection_id = ?",
        [connectionId],
      ),
    );
    if (!row || row.kind !== "api_key" || typeof row.profile_json !== "string") return null;
    return parseProfile(row.profile_json);
  }
}

function profileFromRecord(record: ApiConnectionRecord): ApiKeyProfile {
  return {
    label: record.label,
    authMode: API_KEY_AUTH_MODE,
    maskedKeyPreview: record.maskedKeyPreview,
    discoveredModels: [...record.discoveredModels],
    userMonthlyCapMicroUsd: record.userMonthlyCapMicroUsd === null ? null : record.userMonthlyCapMicroUsd.toString(),
    verifiedAt: record.verifiedAt,
    status: record.status,
    resumeStatus: record.resumeStatus,
    customBaseUrl: record.customBaseUrl,
    customRates: record.customRates ? serializeRates(record.customRates) : null,
    keyFamily: record.keyFamily,
  };
}

function mapRecord(
  row: { id: string; provider: string; vaultRef: string | null; enabled: boolean; createdAt: number; scale: number },
  profile: ApiKeyProfile,
): ApiConnectionRecord {
  if (!isProvider(row.provider) || row.vaultRef === null || row.scale !== MICRO_USD_SCALE) {
    throw new ApiKeyOnboardingError("global.db connection row is corrupt");
  }
  const capText = profile.userMonthlyCapMicroUsd;
  return {
    connectionId: row.id,
    provider: row.provider,
    label: profile.label,
    authMode: API_KEY_AUTH_MODE,
    maskedKeyPreview: profile.maskedKeyPreview,
    discoveredModels: profile.discoveredModels,
    userMonthlyCapMicroUsd: capText === null ? null : BigInt(capText),
    verifiedAt: profile.verifiedAt,
    status: profile.status,
    resumeStatus: profile.resumeStatus,
    enabled: row.enabled,
    keyFamily: profile.keyFamily,
    customBaseUrl: profile.customBaseUrl,
    customRates: profile.customRates ? parseRates(profile.customRates) : null,
    vaultRef: row.vaultRef,
    createdAt: row.createdAt,
    currency: "usd",
    scale: MICRO_USD_SCALE,
  };
}

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
  if (record.scale !== MICRO_USD_SCALE) {
    throw new ApiKeyOnboardingError("API key connections use the micro-USD scale");
  }
}

function parseProfile(json: string): ApiKeyProfile {
  const parsed = JSON.parse(json) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new ApiKeyOnboardingError("global.db connection row is corrupt");
  }
  const record = parsed as Record<string, unknown>;
  const status = requiredText(record, "status");
  const keyFamily = requiredText(record, "keyFamily");
  const resume = record.resumeStatus;
  if (!isStatus(status) || !isFamily(keyFamily)) {
    throw new ApiKeyOnboardingError("global.db connection row is corrupt");
  }
  if (resume !== null && (typeof resume !== "string" || !isStatus(resume))) {
    throw new ApiKeyOnboardingError("global.db connection row is corrupt");
  }
  const models = record.discoveredModels;
  if (!Array.isArray(models) || models.some((item) => typeof item !== "string")) {
    throw new ApiKeyOnboardingError("Discovered model list is corrupt");
  }
  const cap = record.userMonthlyCapMicroUsd;
  if (cap !== null && typeof cap !== "string") {
    throw new ApiKeyOnboardingError("global.db connection row is corrupt");
  }
  return {
    label: requiredText(record, "label"),
    authMode: API_KEY_AUTH_MODE,
    maskedKeyPreview: requiredText(record, "maskedKeyPreview"),
    discoveredModels: models,
    userMonthlyCapMicroUsd: cap,
    verifiedAt: optionalInt(record.verifiedAt),
    status,
    resumeStatus: resume,
    customBaseUrl: optionalText(record.customBaseUrl),
    customRates: parseStoredRates(record.customRates),
    keyFamily,
  };
}

function parseStoredRates(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") throw new ApiKeyOnboardingError("Custom rate table is corrupt");
  const record = value as Record<string, unknown>;
  const rates: Record<string, string> = {};
  for (const key of [
    "inputMicroUsdPer1M",
    "outputMicroUsdPer1M",
    "cachedInputReadMicroUsdPer1M",
    "cacheWriteMicroUsdPer1M",
    "reasoningTokenMicroUsdPer1M",
  ]) {
    const cell = record[key];
    if (typeof cell !== "string") throw new ApiKeyOnboardingError("Custom rate table is corrupt");
    rates[key] = cell;
  }
  return rates;
}

function parseRates(record: Record<string, string>): CustomRateTable {
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

function big(value: string | undefined): bigint {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return BigInt(value);
  throw new ApiKeyOnboardingError("Custom rate table is corrupt");
}

function requiredText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new ApiKeyOnboardingError(`global.db column ${key} was not text`);
  return value;
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ApiKeyOnboardingError("global.db connection row is corrupt");
  return value;
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new ApiKeyOnboardingError("global.db connection row is corrupt");
}

function asRow(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
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
