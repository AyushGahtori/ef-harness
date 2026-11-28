import path from "node:path";
import { GlobalBrokerDb, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import { WindowsDpapiSecretsVault } from "@ef-harness/governor";
import type { VaultMaterialStore } from "../api-keys/local-dpapi-vault.js";
import type { SiwcSecretsVault } from "./ports.js";

const PROJECT_ID = "provider-connections";

/**
 * ChatGPT token blobs stored by Task 120 `WindowsDpapiSecretsVault`.
 * `name` is the vault reference. The env name is a sanitized identifier.
 */
export class SiwcDpapiSecretsVault implements SiwcSecretsVault {
  private readonly vault: WindowsDpapiSecretsVault;
  private readonly global: GlobalBrokerDb;
  private readonly state: ProjectStateDb;
  private closed = false;

  constructor(directory: string, materialStore?: VaultMaterialStore) {
    this.global = GlobalBrokerDb.open({ root: path.join(directory, "harness") });
    this.state = openProjectStateDb({
      projectId: PROJECT_ID,
      rootDir: path.join(directory, "state"),
    });
    try {
      this.vault = new WindowsDpapiSecretsVault({
        global: this.global,
        state: this.state,
        vaultDir: directory,
        ...(materialStore ? { materialStore } : {}),
      });
    } catch (error) {
      this.state.close();
      this.global.close();
      throw error;
    }
  }

  async storeSecret(name: string, value: string): Promise<void> {
    await this.vault.storeSecret({
      projectId: PROJECT_ID,
      envScope: "prod",
      name: envName(name),
      value,
      providerHint: "openai",
      secretId: name,
    });
  }

  async readPlaintextForKernel(name: string): Promise<string | null> {
    try {
      return await this.vault.readPlaintextForKernel(name);
    } catch (error) {
      if (error instanceof Error && error.name === "SecretNotFoundError") return null;
      throw error;
    }
  }

  async deleteSecret(name: string): Promise<void> {
    const existing = await this.vault.readSecret(name);
    if (!existing) return;
    await this.vault.deleteSecret(name);
  }

  async count(): Promise<number> {
    return this.vault.listSecretNamesAndHashes(PROJECT_ID, "prod").length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.vault.close();
    this.state.close();
    this.global.close();
  }
}

function envName(secretId: string): string {
  const cleaned = secretId.replace(/[^A-Za-z0-9_]/g, "_");
  return `SIWC_${cleaned}`;
}
