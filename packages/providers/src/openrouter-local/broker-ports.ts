import path from "node:path";
import { randomBytes } from "node:crypto";
import { GlobalBrokerDb, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import { WindowsDpapiSecretsVault } from "@ef-harness/governor";
import type { VaultMaterialStore } from "../api-keys/local-dpapi-vault.js";
import type {
  DpapiPutInput,
  DpapiSecretHandle,
  DpapiSecretMaterial,
  DpapiSecretsVaultPort,
  GlobalConnectionRecord,
  GlobalConnectionsPort,
} from "./ports.js";

const PROJECT_FALLBACK = "provider-connections";

export interface OpenRouterVaultOptions {
  readonly materialStore?: VaultMaterialStore;
}

/**
 * OpenRouter key material in Task 120 `WindowsDpapiSecretsVault`.
 * Callers persist `secretId` and `lastFourMasked` only.
 */
export class BrokerOpenRouterVault implements DpapiSecretsVaultPort {
  private readonly vault: WindowsDpapiSecretsVault;
  private readonly global: GlobalBrokerDb;
  private readonly state: ProjectStateDb;
  private closed = false;

  constructor(directory: string, options: OpenRouterVaultOptions = {}) {
    this.global = GlobalBrokerDb.open({ root: path.join(directory, "harness") });
    this.state = openProjectStateDb({
      projectId: PROJECT_FALLBACK,
      rootDir: path.join(directory, "state"),
    });
    try {
      this.vault = new WindowsDpapiSecretsVault({
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

  async put(input: DpapiPutInput): Promise<DpapiSecretHandle> {
    const secretId = `vault:openrouter:${randomBytes(8).toString("hex")}`;
    const saved = await this.vault.storeSecret({
      projectId: input.projectId || PROJECT_FALLBACK,
      envScope: input.envScope,
      name: envName(secretId),
      value: input.value,
      providerHint: input.providerHint ?? "openrouter",
      secretId,
    });
    return {
      secretId: saved.secretId,
      name: input.name,
      lastFourMasked: saved.lastFourMasked,
    };
  }

  async readSecret(secretId: string): Promise<DpapiSecretMaterial | null> {
    try {
      const secret = await this.vault.readSecret(secretId);
      if (!secret) return null;
      return { secretId: secret.secretId, name: secret.name, value: secret.value };
    } catch (error) {
      if (error instanceof Error && error.name === "SecretNotFoundError") return null;
      throw error;
    }
  }

  async delete(secretId: string): Promise<void> {
    const existing = await this.vault.readSecret(secretId);
    if (!existing) return;
    await this.vault.deleteSecret(secretId);
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
 * OpenRouter and local-server rows on Task 014 `connections`.
 * Extra fields, when present, live in `connection_profiles` rather than a `metadata_json` column.
 */
export class BrokerOpenRouterConnections implements GlobalConnectionsPort {
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

  async insert(row: GlobalConnectionRecord): Promise<void> {
    this.global.transaction(() => {
      this.global.upsertConnection({
        id: row.id,
        provider: row.provider,
        route: row.route,
        plan: row.plan,
        vaultRef: row.vaultRef,
        currency: row.currency,
        scale: row.scale,
        enabled: row.enabled,
        createdAt: row.createdAt,
      });
      this.global.writer.run(
        `INSERT INTO connection_profiles (connection_id, kind, profile_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(connection_id) DO UPDATE SET
           kind = excluded.kind,
           profile_json = excluded.profile_json,
           updated_at = excluded.updated_at`,
        [row.id, row.route, JSON.stringify({ provider: row.provider, route: row.route }), row.createdAt],
      );
    });
  }

  async get(id: string): Promise<GlobalConnectionRecord | null> {
    const row = this.global.getConnection(id);
    if (!row) return null;
    return mapConnection(row);
  }

  async list(): Promise<readonly GlobalConnectionRecord[]> {
    return this.global.listConnections().map((row) => mapConnection(row));
  }

  async delete(id: string): Promise<void> {
    this.global.transaction(() => {
      this.global.writer.run("DELETE FROM connection_profiles WHERE connection_id = ?", [id]);
      this.global.writer.run("DELETE FROM connections WHERE id = ?", [id]);
    });
  }

  close(): void {
    if (this.closed || !this.owned) return;
    this.closed = true;
    this.global.close();
  }
}

function mapConnection(row: {
  id: string;
  provider: string;
  route: string;
  plan: string | null;
  vaultRef: string | null;
  currency: string;
  scale: number;
  enabled: boolean;
  createdAt: number;
}): GlobalConnectionRecord {
  return {
    id: row.id,
    provider: row.provider,
    route: row.route as GlobalConnectionRecord["route"],
    plan: row.plan,
    vaultRef: row.vaultRef,
    currency: row.currency,
    scale: row.scale,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

function envName(secretId: string): string {
  const cleaned = secretId.replace(/[^A-Za-z0-9_]/g, "_");
  return `OPENROUTER_KEY_${cleaned}`;
}
