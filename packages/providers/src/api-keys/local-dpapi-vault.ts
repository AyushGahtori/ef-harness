import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { GlobalBrokerDb, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import { WindowsDpapiSecretsVault } from "@ef-harness/governor";
import { ApiKeyOnboardingError } from "./api-key-types.js";

export type VaultEnvScope = "test" | "dev" | "staging" | "prod";

export interface VaultSecretMetadata {
  readonly secretId: string;
  readonly name: string;
  readonly providerHint: string;
  readonly envScope: VaultEnvScope;
  readonly lastFourMasked: string;
  readonly createdAt: number;
  readonly rotatedAt: number;
}

export interface VaultPutInput {
  readonly secretId: string;
  readonly plaintext: string;
  readonly name: string;
  readonly providerHint: string;
  readonly envScope: VaultEnvScope;
}

export interface VaultMaterialStore {
  protectAndWrite(target: string, plaintext: Buffer, overflowPath: string): Promise<void>;
  readAndUnprotect(target: string): Promise<Buffer | null>;
  deleteMaterial(target: string, overflowPath: string): Promise<void>;
  replaceStoredCiphertext(target: string, ciphertext: Buffer, overflowPath: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Async port of Task 120 `WindowsDpapiSecretsVault`.
 * Callers use `storeSecret`, `readPlaintextForKernel`, and `deleteSecret`.
 */
export interface WindowsDpapiSecretsVaultPort {
  storeSecret(input: VaultPutInput): Promise<VaultSecretMetadata>;
  rotate(secretId: string, plaintext: string): Promise<VaultSecretMetadata>;
  readPlaintextForKernel(secretId: string): Promise<string>;
  deleteSecret(secretId: string): Promise<void>;
  has(secretId: string): Promise<boolean>;
  readAtRestBytes(): Uint8Array;
}

export interface LocalDpapiSecretsVaultOptions {
  readonly materialStore?: VaultMaterialStore;
}

const PROJECT_ID = "provider-connections";

export class LocalDpapiSecretsVault implements WindowsDpapiSecretsVaultPort {
  private readonly vault: WindowsDpapiSecretsVault;
  private readonly global: GlobalBrokerDb;
  private readonly state: ProjectStateDb;
  private readonly vaultDir: string;
  private closed = false;

  constructor(directory: string, options: LocalDpapiSecretsVaultOptions = {}) {
    this.vaultDir = directory;
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
        ...(options.materialStore ? { materialStore: options.materialStore } : {}),
      });
    } catch (error) {
      this.state.close();
      this.global.close();
      throw error;
    }
  }

  async storeSecret(input: VaultPutInput): Promise<VaultSecretMetadata> {
    if (input.plaintext.length === 0) {
      throw new ApiKeyOnboardingError("Refusing to store an empty secret");
    }
    const saved = await this.vault.storeSecret({
      projectId: PROJECT_ID,
      envScope: input.envScope,
      name: envName(input.secretId),
      value: input.plaintext,
      providerHint: input.providerHint,
      secretId: input.secretId,
    });
    return toMetadata(saved, input.providerHint);
  }

  async rotate(secretId: string, plaintext: string): Promise<VaultSecretMetadata> {
    if (!(await this.has(secretId))) {
      throw new ApiKeyOnboardingError("Cannot rotate a secret that is not in the vault");
    }
    const saved = await this.vault.rotate(secretId, plaintext);
    return toMetadata(saved.metadata, saved.metadata.providerHint ?? "");
  }

  async readPlaintextForKernel(secretId: string): Promise<string> {
    try {
      return await this.vault.readPlaintextForKernel(secretId);
    } catch (error) {
      if (error instanceof Error && error.name === "SecretNotFoundError") {
        throw new ApiKeyOnboardingError("Secret is not in the vault");
      }
      throw error;
    }
  }

  async deleteSecret(secretId: string): Promise<void> {
    if (!(await this.has(secretId))) return;
    await this.vault.deleteSecret(secretId);
  }

  async has(secretId: string): Promise<boolean> {
    const secret = await this.vault.readSecret(secretId);
    return secret !== null;
  }

  readAtRestBytes(): Uint8Array {
    return readTree(this.vaultDir);
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
  const named = `API_KEY_${cleaned}`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(named)) {
    throw new ApiKeyOnboardingError("Secret name is not an environment variable identifier");
  }
  return named;
}

function toMetadata(
  saved: { secretId: string; name: string; envScope: VaultEnvScope; lastFourMasked: string; createdAt: number; rotatedAt?: number; providerHint?: string },
  providerHint: string,
): VaultSecretMetadata {
  return {
    secretId: saved.secretId,
    name: saved.name,
    providerHint: saved.providerHint ?? providerHint,
    envScope: saved.envScope,
    lastFourMasked: saved.lastFourMasked,
    createdAt: saved.createdAt,
    rotatedAt: saved.rotatedAt ?? saved.createdAt,
  };
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
