import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { GlobalBrokerDb, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import { WindowsDpapiSecretsVault as DpapiVault } from "@ef-harness/governor";
import type { VaultMaterialStore } from "../api-keys/local-dpapi-vault.js";
import { DeviceFlowCancelledError } from "./errors.js";
import {
  emptyCursorReminder,
  isVaultReference,
  type Clock,
  type ConnectionMetadata,
  type CopilotModelMultiplier,
  type GlobalConnectionRecord,
  type GlobalDbConnectionsPort,
  type SecretPublicMetadata,
  type SecretWriteResult,
  type SignedProviderPolicyEnginePort,
  type TimerRegistry,
  type WindowsDpapiSecretsVault,
} from "./types.js";

export { emptyCursorReminder };

const PROJECT_ID = "provider-connections";

export interface CopilotVaultOptions {
  readonly materialStore?: VaultMaterialStore;
}

/**
 * Copilot and Cursor tokens stored by Task 120 `WindowsDpapiSecretsVault`.
 * Production construction does not inject a material store.
 */
export class LocalWindowsDpapiSecretsVault implements WindowsDpapiSecretsVault {
  private readonly vault: DpapiVault;
  private readonly global: GlobalBrokerDb;
  private readonly state: ProjectStateDb;
  private readonly vaultDir: string;
  private closed = false;

  constructor(directory: string, options: CopilotVaultOptions = {}) {
    this.vaultDir = directory;
    this.global = GlobalBrokerDb.open({ root: path.join(directory, "harness") });
    this.state = openProjectStateDb({
      projectId: PROJECT_ID,
      rootDir: path.join(directory, "state"),
    });
    try {
      this.vault = new DpapiVault({
        global: this.global,
        state: this.state,
        vaultDir: directory,
        ...(options.materialStore ? { materialStore: options.materialStore } : {}),
      });
    } catch (error) {
      this.state.close();
      this.global.close();
      throw error;
    }
  }

  async writeSecret(input: {
    readonly secretId: string;
    readonly name: "gitHubToken" | "cursorUserApiKey";
    readonly plaintext: string;
    readonly providerHint: "github_copilot" | "cursor";
  }): Promise<SecretWriteResult> {
    if (!isVaultReference(input.secretId)) {
      throw new Error("DPAPI secret id must be a vault reference");
    }
    if (input.plaintext.length < 12) {
      throw new Error("Refusing a credential that is too short to mask");
    }
    const saved = await this.vault.storeSecret({
      projectId: PROJECT_ID,
      envScope: "dev",
      name: envName(input.name, input.secretId),
      value: input.plaintext,
      providerHint: input.providerHint,
      secretId: input.secretId,
    });
    return { secretId: saved.secretId, lastFourMasked: saved.lastFourMasked };
  }

  async readSecret(secretId: string): Promise<string | null> {
    try {
      const secret = await this.vault.readSecret(secretId);
      return secret ? secret.value : null;
    } catch (error) {
      if (error instanceof Error && error.name === "SecretNotFoundError") return null;
      throw error;
    }
  }

  async deleteSecret(secretId: string): Promise<void> {
    const existing = await this.vault.readSecret(secretId);
    if (!existing) return;
    await this.vault.deleteSecret(secretId);
  }

  exportAtRest(): string {
    return Buffer.from(readTree(this.vaultDir)).toString("latin1");
  }

  listPublicMetadata(): readonly SecretPublicMetadata[] {
    const rows = this.global.writer.all(
      `SELECT secret_id, name, provider_hint, last_four_masked
         FROM vault_secret_metadata
        ORDER BY secret_id`,
    );
    const listed: SecretPublicMetadata[] = [];
    for (const row of rows) {
      const mapped = asRow(row);
      if (!mapped) continue;
      const name = logicalName(textField(mapped, "name"), textField(mapped, "provider_hint"));
      if (!name) continue;
      const hint = textField(mapped, "provider_hint");
      listed.push({
        secretId: textField(mapped, "secret_id"),
        name,
        providerHint: hint === "cursor" ? "cursor" : "github_copilot",
        lastFourMasked: textField(mapped, "last_four_masked"),
      });
    }
    return listed;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.vault.close();
    this.state.close();
    this.global.close();
  }
}

/**
 * Copilot and Cursor rows on Task 014 `connections`, with auth metadata in `connection_profiles`.
 * `connections` has no metadata column. Profiles hold the extra fields.
 */
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

  upsert(record: GlobalConnectionRecord): void {
    this.assertPublic(record);
    this.write(record);
  }

  update(id: string, patch: (current: GlobalConnectionRecord) => GlobalConnectionRecord): void {
    const current = this.get(id);
    if (!current) throw new Error(`Unknown connection ${id}`);
    const next = patch(current);
    if (next.id !== id) throw new Error("Connection id is immutable");
    this.assertPublic(next);
    this.write(next);
  }

  get(id: string): GlobalConnectionRecord | null {
    const row = this.global.getConnection(id);
    if (!row || (row.route !== "copilot_sdk" && row.route !== "cursor_sdk")) return null;
    const metadata = this.readProfile(id);
    if (!metadata) return null;
    return mapRecord(row, metadata);
  }

  delete(id: string): void {
    this.global.transaction(() => {
      this.global.writer.run("DELETE FROM connection_profiles WHERE connection_id = ?", [id]);
      this.global.writer.run("DELETE FROM connections WHERE id = ?", [id]);
    });
  }

  list(): readonly GlobalConnectionRecord[] {
    const records: GlobalConnectionRecord[] = [];
    for (const row of this.global.listConnections()) {
      if (row.route !== "copilot_sdk" && row.route !== "cursor_sdk") continue;
      const metadata = this.readProfile(row.id);
      if (!metadata) continue;
      records.push(mapRecord(row, metadata));
    }
    return records;
  }

  exportSnapshot(): string {
    const connections = this.global.writer.all(
      `SELECT id, provider, route, plan, vault_ref, currency, scale, enabled, created_at
         FROM connections
        ORDER BY id`,
    );
    const profiles = this.global.writer.all(
      `SELECT connection_id, kind, profile_json, updated_at
         FROM connection_profiles
        ORDER BY connection_id`,
    );
    return JSON.stringify({ connections, profiles });
  }

  close(): void {
    if (this.closed || !this.owned) return;
    this.closed = true;
    this.global.close();
  }

  private write(record: GlobalConnectionRecord): void {
    const current = this.global.getConnection(record.id);
    this.global.transaction(() => {
      this.global.upsertConnection({
        id: record.id,
        provider: record.provider,
        route: record.route,
        plan: record.plan,
        vaultRef: record.vaultRef,
        currency: record.currency,
        scale: record.scale,
        enabled: record.enabled === 1,
        createdAt: current?.createdAt ?? record.createdAt,
      });
      this.global.writer.run(
        `INSERT INTO connection_profiles (connection_id, kind, profile_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(connection_id) DO UPDATE SET
           kind = excluded.kind,
           profile_json = excluded.profile_json,
           updated_at = excluded.updated_at`,
        [record.id, record.metadata.kind, JSON.stringify(record.metadata), record.createdAt],
      );
    });
  }

  private readProfile(connectionId: string): ConnectionMetadata | null {
    const row = asRow(
      this.global.writer.get(
        "SELECT kind, profile_json FROM connection_profiles WHERE connection_id = ?",
        [connectionId],
      ),
    );
    if (!row || (row.kind !== "copilot" && row.kind !== "cursor")) return null;
    if (typeof row.profile_json !== "string") return null;
    const parsed: unknown = JSON.parse(row.profile_json);
    if (!isMetadata(parsed) || parsed.kind !== row.kind) return null;
    return parsed;
  }

  private assertPublic(record: GlobalConnectionRecord): void {
    if (record.vaultRef !== null && !isVaultReference(record.vaultRef)) {
      throw new Error("vault_ref must be a credential-manager reference");
    }
  }
}

/** In-memory stand-in for the Copilot multiplier slice of Task 135 `SignedProviderPolicyEngine`. */
export class LocalSignedProviderPolicy implements SignedProviderPolicyEnginePort {
  copilotPremiumMultipliers(): readonly CopilotModelMultiplier[] {
    return [
      { modelId: "included-fast", multiplier: 0, kind: "included" },
      { modelId: "standard-chat", multiplier: 1, kind: "standard" },
      { modelId: "premium-reasoner", multiplier: 3, kind: "premium_reasoning" },
      { modelId: "claude-sonnet", multiplier: 3, kind: "premium_reasoning" },
    ];
  }
}

export class ManualClock implements Clock {
  constructor(private current = 0) {}

  now(): number {
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export class ManualTimerRegistry implements TimerRegistry {
  private next = 1;
  private readonly jobs = new Map<number, () => void>();

  set(callback: () => void, ms: number): number {
    if (ms < 0) throw new Error("Timer delay cannot be negative");
    const handle = this.next;
    this.next += 1;
    this.jobs.set(handle, callback);
    return handle;
  }

  clear(handle: number): void {
    this.jobs.delete(handle);
  }

  activeCount(): number {
    return this.jobs.size;
  }

  fire(handle: number): void {
    const callback = this.jobs.get(handle);
    if (!callback) return;
    this.jobs.delete(handle);
    callback();
  }

  soleHandle(): number {
    const handle = [...this.jobs.keys()][0];
    if (handle === undefined) throw new Error("No timer is armed");
    return handle;
  }
}

export class SystemTimerRegistry implements TimerRegistry {
  private next = 1;
  private readonly jobs = new Map<number, ReturnType<typeof setTimeout>>();

  set(callback: () => void, ms: number): number {
    const id = this.next;
    this.next += 1;
    this.jobs.set(id, setTimeout(callback, ms));
    return id;
  }

  clear(handle: number): void {
    const timer = this.jobs.get(handle);
    if (timer !== undefined) clearTimeout(timer);
    this.jobs.delete(handle);
  }

  activeCount(): number {
    return this.jobs.size;
  }
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DeviceFlowCancelledError());
      return;
    }
    const handle = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(handle);
      reject(new DeviceFlowCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function envName(logical: "gitHubToken" | "cursorUserApiKey", secretId: string): string {
  const prefix = logical === "gitHubToken" ? "GITHUB_TOKEN" : "CURSOR_USER_API_KEY";
  const cleaned = secretId.replace(/[^A-Za-z0-9_]/g, "_");
  return `${prefix}_${cleaned}`;
}

function logicalName(storedName: string, providerHint: string): SecretPublicMetadata["name"] | null {
  if (storedName.startsWith("GITHUB_TOKEN_") || providerHint === "github_copilot") return "gitHubToken";
  if (storedName.startsWith("CURSOR_USER_API_KEY_") || providerHint === "cursor") return "cursorUserApiKey";
  return null;
}

function mapRecord(
  row: { id: string; provider: string; route: string; plan: string | null; vaultRef: string | null; currency: string; scale: number; enabled: boolean; createdAt: number },
  metadata: ConnectionMetadata,
): GlobalConnectionRecord {
  const provider = row.provider === "cursor" ? "cursor" : "github_copilot";
  const route = row.route === "cursor_sdk" ? "cursor_sdk" : "copilot_sdk";
  return {
    id: row.id,
    provider,
    route,
    plan: row.plan,
    vaultRef: row.vaultRef,
    currency: row.currency,
    scale: row.scale,
    enabled: row.enabled ? 1 : 0,
    createdAt: row.createdAt,
    metadata,
  };
}

function isMetadata(value: unknown): value is ConnectionMetadata {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "copilot" || kind === "cursor";
}

function asRow(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function readTree(directory: string): Uint8Array {
  const chunks: Buffer[] = [];
  if (!existsSync(directory)) return Buffer.alloc(0);
  const visit = (current: string): void => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, name.name);
      if (name.isDirectory()) {
        visit(full);
        continue;
      }
      if (name.isFile()) chunks.push(readFileSync(full));
    }
  };
  visit(directory);
  return Buffer.concat(chunks);
}
