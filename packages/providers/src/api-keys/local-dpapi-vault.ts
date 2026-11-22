import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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

/**
 * Port of Task 120 `WindowsDpapiSecretsVault`.
 * The local adapter encrypts with AES-256-GCM. Integration replaces it with DPAPI.
 */
export interface WindowsDpapiSecretsVaultPort {
  put(input: VaultPutInput): VaultSecretMetadata;
  rotate(secretId: string, plaintext: string): VaultSecretMetadata;
  getPlaintext(secretId: string): string;
  delete(secretId: string): void;
  has(secretId: string): boolean;
  metadata(secretId: string): VaultSecretMetadata | undefined;
  readAtRestBytes(): Uint8Array;
}

interface StoredEntry {
  readonly nonce: string;
  readonly tag: string;
  readonly ciphertext: string;
  readonly lastFourMasked: string;
  readonly name: string;
  readonly providerHint: string;
  readonly envScope: VaultEnvScope;
  readonly createdAt: number;
  readonly rotatedAt: number;
}

interface VaultFile {
  readonly v: 1;
  readonly entries: Record<string, StoredEntry>;
}

export class LocalDpapiSecretsVault implements WindowsDpapiSecretsVaultPort {
  private readonly filePath: string;
  private readonly key: Buffer;

  constructor(directory: string, keyMaterial?: Buffer) {
    mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, "dpapi-vault.json");
    this.key = keyMaterial ?? randomBytes(32);
    if (this.key.length !== 32) {
      throw new ApiKeyOnboardingError("Local vault key must be 32 bytes");
    }
    if (!exists(this.filePath)) {
      this.persist({ v: 1, entries: {} });
    }
  }

  put(input: VaultPutInput): VaultSecretMetadata {
    if (input.plaintext.length === 0) {
      throw new ApiKeyOnboardingError("Refusing to store an empty secret");
    }
    const file = this.load();
    const previous = file.entries[input.secretId];
    const now = Date.now();
    const entry = this.seal(input.plaintext, {
      name: input.name,
      providerHint: input.providerHint,
      envScope: input.envScope,
      createdAt: previous?.createdAt ?? now,
      rotatedAt: now,
    });
    this.persist({
      v: 1,
      entries: { ...file.entries, [input.secretId]: entry },
    });
    return this.toMetadata(input.secretId, entry);
  }

  rotate(secretId: string, plaintext: string): VaultSecretMetadata {
    const current = this.metadata(secretId);
    if (!current) {
      throw new ApiKeyOnboardingError("Cannot rotate a secret that is not in the vault");
    }
    return this.put({
      secretId,
      plaintext,
      name: current.name,
      providerHint: current.providerHint,
      envScope: current.envScope,
    });
  }

  getPlaintext(secretId: string): string {
    const entry = this.load().entries[secretId];
    if (!entry) {
      throw new ApiKeyOnboardingError("Secret is not in the vault");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(entry.nonce, "base64url"));
    decipher.setAuthTag(Buffer.from(entry.tag, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(entry.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  }

  delete(secretId: string): void {
    const file = this.load();
    if (!file.entries[secretId]) return;
    const entries = { ...file.entries };
    delete entries[secretId];
    this.persist({ v: 1, entries });
  }

  has(secretId: string): boolean {
    return this.load().entries[secretId] !== undefined;
  }

  metadata(secretId: string): VaultSecretMetadata | undefined {
    const entry = this.load().entries[secretId];
    if (!entry) return undefined;
    return this.toMetadata(secretId, entry);
  }

  readAtRestBytes(): Uint8Array {
    return readFileSync(this.filePath);
  }

  private seal(
    plaintext: string,
    meta: Omit<StoredEntry, "nonce" | "tag" | "ciphertext" | "lastFourMasked">,
  ): StoredEntry {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      nonce: nonce.toString("base64url"),
      tag: tag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      lastFourMasked: plaintext.slice(-4),
      ...meta,
    };
  }

  private toMetadata(secretId: string, entry: StoredEntry): VaultSecretMetadata {
    return {
      secretId,
      name: entry.name,
      providerHint: entry.providerHint,
      envScope: entry.envScope,
      lastFourMasked: entry.lastFourMasked,
      createdAt: entry.createdAt,
      rotatedAt: entry.rotatedAt,
    };
  }

  private load(): VaultFile {
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new ApiKeyOnboardingError("Vault file is unreadable");
    }
    const record = parsed as { v?: unknown; entries?: unknown };
    if (record.v !== 1 || typeof record.entries !== "object" || record.entries === null) {
      throw new ApiKeyOnboardingError("Vault file is unreadable");
    }
    return { v: 1, entries: record.entries as Record<string, StoredEntry> };
  }

  private persist(file: VaultFile): void {
    writeFileSync(this.filePath, JSON.stringify(file), { encoding: "utf8" });
  }
}

function exists(filePath: string): boolean {
  try {
    readFileSync(filePath);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
    if (code === "ENOENT") return false;
    throw error;
  }
}
