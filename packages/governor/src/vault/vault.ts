import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { GlobalBrokerDb, ProjectStateDb } from "@ef-harness/db";
import { WindowsDpapiMaterialStore } from "./dpapi-store.js";
import { VaultHmac } from "./hmac.js";
import { SqliteVaultMetadataStore } from "./metadata-store.js";
import { diffSecretNames } from "./name-diff.js";
import { maskLastFour } from "./patterns.js";
import type {
  GlobalDbRepo,
  ProviderSecretProberPort,
  PurgeOffer,
  SecretMaterialStore,
  SecretPurgeEngine,
  StoredSecret,
  VaultSecretSource,
} from "./ports.js";
import { LiveKeyTestRefusalGuard } from "./refusal.js";
import type { EnvScope, NameOnlySecretDiff, ProbeProvider, SecretMetadata, SecretNameHash, VerifiedStatus } from "./types.js";
import {
  CredentialsNeedReentryError,
  LiveKeyRefusedError,
  SecretNameConflictError,
  SecretNotFoundError,
  SecretPurgeUnavailableError,
  VaultError,
} from "./types.js";

export interface PutSecretInput {
  readonly projectId: string;
  readonly envScope: EnvScope;
  readonly name: string;
  readonly value: string;
  readonly providerHint?: string;
  readonly taggedProd?: boolean;
  readonly pairedWithLiveSecret?: boolean;
  readonly explicitTestOverride?: boolean;
  readonly provider?: ProbeProvider;
  readonly secretId?: string;
}

export interface WindowsDpapiSecretsVaultOptions {
  readonly global: GlobalBrokerDb;
  readonly state: ProjectStateDb;
  readonly vaultDir: string;
  readonly logsDir?: string;
  readonly prodHostnames?: readonly string[];
  readonly purge?: SecretPurgeEngine;
  readonly prober?: ProviderSecretProberPort;
  readonly guard?: LiveKeyTestRefusalGuard;
  readonly metadata?: GlobalDbRepo;
  readonly materialStore?: SecretMaterialStore;
  readonly now?: () => number;
}

export class WindowsDpapiSecretsVault implements VaultSecretSource {
  readonly guard: LiveKeyTestRefusalGuard;
  private readonly metadata: GlobalDbRepo;
  private readonly ownsMetadata: boolean;
  private readonly material: SecretMaterialStore;
  private readonly purge: SecretPurgeEngine | null;
  private readonly prober: ProviderSecretProberPort | null;
  private readonly logsDir: string | null;
  private readonly vaultDir: string;
  private readonly now: () => number;
  private readonly cache = new Map<string, string>();
  private hmac: VaultHmac | null = null;
  private closed = false;

  constructor(options: WindowsDpapiSecretsVaultOptions) {
    this.guard = options.guard ?? new LiveKeyTestRefusalGuard(
      options.prodHostnames ? { prodHostnames: options.prodHostnames } : {},
    );
    if (options.metadata) {
      this.metadata = options.metadata;
      this.ownsMetadata = false;
    } else {
      this.metadata = new SqliteVaultMetadataStore(options.global, options.state);
      this.ownsMetadata = true;
    }
    this.material = options.materialStore ?? new WindowsDpapiMaterialStore(options.vaultDir);
    this.purge = options.purge ?? null;
    this.prober = options.prober ?? null;
    this.logsDir = options.logsDir ?? null;
    this.vaultDir = options.vaultDir;
    this.now = options.now ?? (() => Date.now());
    mkdirSync(options.vaultDir, { recursive: true });
    if (this.logsDir) mkdirSync(this.logsDir, { recursive: true });
  }

  storeSecret(input: PutSecretInput): Promise<SecretMetadata> {
    return this.put(input);
  }

  async readPlaintextForKernel(secretId: string): Promise<string> {
    const secret = await this.readSecret(secretId);
    if (!secret) throw new SecretNotFoundError(secretId);
    return secret.value;
  }

  deleteSecret(secretId: string): Promise<PurgeOffer> {
    return this.delete(secretId);
  }

  async put(input: PutSecretInput): Promise<SecretMetadata> {
    validateSecret(input.name, input.value);
    const existing = this.metadata.findVaultMetadataByName(input.projectId, input.envScope, input.name);
    if (existing && existing.secretId !== input.secretId) {
      throw new SecretNameConflictError(input.name);
    }
    this.guard.assertAllowed(guardInput(input));
    const verifiedStatus = await this.probeAndGuard(input);
    const secretId = input.secretId ?? existing?.secretId ?? createSecretId(this.now());
    const createdAt = existing?.createdAt ?? this.now();
    return this.persist(secretId, input, verifiedStatus, createdAt, existing?.rotatedAt);
  }

  async rotate(secretId: string, value: string): Promise<{ metadata: SecretMetadata; purgePrevious: PurgeOffer }> {
    const current = this.requireMeta(secretId);
    validateSecret(current.name, value);
    const previous = await this.readValue(current);
    const input: PutSecretInput = {
      projectId: current.projectId,
      envScope: current.envScope,
      name: current.name,
      value,
      ...(current.providerHint ? { providerHint: current.providerHint } : {}),
      ...(current.taggedProd ? { taggedProd: true } : {}),
      ...(current.testOverride ? { explicitTestOverride: true } : {}),
      secretId,
    };
    this.guard.assertAllowed(guardInput(input));
    const verifiedStatus = await this.probeAndGuard(input);
    const metadata = await this.persist(secretId, input, verifiedStatus, current.createdAt, this.now());
    this.cache.delete(secretId);
    return { metadata, purgePrevious: this.offerFor(previous, current.name, secretId) };
  }

  async delete(secretId: string): Promise<PurgeOffer> {
    const current = this.requireMeta(secretId);
    let previous: string | null = null;
    try {
      previous = await this.readValue(current);
    } catch (error) {
      if (!(error instanceof CredentialsNeedReentryError)) throw error;
    }
    await this.material.deleteMaterial(current.credentialTarget, this.overflowPath(secretId));
    this.cache.delete(secretId);
    this.metadata.deleteVaultMetadata(secretId);
    this.writeLog("delete", current, current.verifiedStatus);
    if (previous === null) {
      return {
        secretId,
        label: current.name,
        invocation: "one-click",
        invoke: () => Promise.reject(new CredentialsNeedReentryError()),
      };
    }
    return this.offerFor(previous, current.name, secretId);
  }

  async readSecret(secretId: string): Promise<StoredSecret | null> {
    const meta = this.metadata.getVaultMetadata(secretId);
    if (!meta) return null;
    const value = await this.readValue(meta);
    return {
      secretId: meta.secretId,
      projectId: meta.projectId,
      name: meta.name,
      value,
      envScope: meta.envScope,
      ...(meta.providerHint ? { providerHint: meta.providerHint } : {}),
      taggedProd: meta.taggedProd,
      testOverride: meta.testOverride,
    };
  }

  listSecretNamesAndHashes(projectId: string, envScope: EnvScope): SecretNameHash[] {
    return this.metadata.listVaultMetadata({ projectId, envScope }).map((row) => ({
      name: row.name,
      hmac: row.fingerprint,
    }));
  }

  diffNames(projectId: string, envScope: EnvScope, remote: readonly SecretNameHash[]): NameOnlySecretDiff {
    return diffSecretNames(this.listSecretNamesAndHashes(projectId, envScope), remote);
  }

  offerChatPastePurge(secret: string, label: string): PurgeOffer {
    return this.offerFor(secret, label, null);
  }

  async materializeEnvEntries(
    projectId: string,
    envScope: EnvScope,
    explicitOptIn: boolean,
  ): Promise<Record<string, string>> {
    if (explicitOptIn !== true) {
      throw new VaultError(
        "env_opt_in_required",
        "Local .env.local export is off until the developer explicitly opts in.",
      );
    }
    const rows = this.metadata.listVaultMetadata({ projectId, envScope });
    const entries: Record<string, string> = {};
    for (const row of rows) {
      const value = await this.readValue(row);
      this.guard.assertAllowed({
        value,
        envScope,
        name: row.name,
        ...(row.providerHint ? { providerHint: row.providerHint } : {}),
        ...(row.taggedProd ? { taggedProd: true } : {}),
        ...(row.testOverride ? { explicitTestOverride: true } : {}),
        storedEnvScope: row.envScope,
      });
      entries[row.name] = value;
    }
    return entries;
  }

  invalidateCaches(): void {
    this.cache.clear();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cache.clear();
    if (this.ownsMetadata && this.metadata instanceof SqliteVaultMetadataStore) {
      this.metadata.close();
    }
    await this.material.close();
  }

  private async persist(
    secretId: string,
    input: PutSecretInput,
    verifiedStatus: VerifiedStatus,
    createdAt: number,
    rotatedAt: number | undefined,
  ): Promise<SecretMetadata> {
    const hmac = await this.fingerprints();
    const metadata: SecretMetadata = {
      secretId,
      projectId: input.projectId,
      envScope: input.envScope,
      name: input.name,
      lastFourMasked: maskLastFour(input.value),
      createdAt,
      verifiedStatus,
      credentialTarget: credentialTargetFor(secretId),
      fingerprint: hmac.fingerprint(input.value),
      taggedProd: input.taggedProd === true,
      testOverride: input.explicitTestOverride === true,
      ...(input.providerHint ? { providerHint: input.providerHint } : {}),
      ...(rotatedAt !== undefined ? { rotatedAt } : {}),
    };
    const plain = Buffer.from(input.value, "utf8");
    try {
      await this.material.protectAndWrite(metadata.credentialTarget, plain, this.overflowPath(secretId));
    } finally {
      plain.fill(0);
    }
    this.metadata.upsertVaultMetadata(metadata);
    this.cache.delete(secretId);
    this.writeLog(rotatedAt !== undefined && rotatedAt !== createdAt ? "rotate" : "put", metadata, verifiedStatus);
    return metadata;
  }

  private async probeAndGuard(input: PutSecretInput): Promise<VerifiedStatus> {
    if (!this.prober || !input.provider) return "unverified";
    let status: VerifiedStatus = "unreachable";
    let livemode: boolean | undefined;
    try {
      const probed = await this.prober.probe({
        provider: input.provider,
        secret: input.value,
        envScope: input.envScope,
        ...(input.name ? { name: input.name } : {}),
      });
      status = probed.status;
      livemode = probed.stripeLivemode;
    } catch (error) {
      if (error instanceof LiveKeyRefusedError) throw error;
      status = "unreachable";
    }
    if (livemode === true) {
      this.guard.assertAllowed({ ...guardInput(input), stripeLivemode: true });
    }
    if ((input.envScope === "test" || input.envScope === "dev") && status === "verified_live") {
      throw new LiveKeyRefusedError("verified_live", this.guard.inspect({
        ...guardInput(input),
        stripeLivemode: true,
      }).allowed
        ? "Refused to store a live-verified credential in a test or dev scope."
        : refusedMessage(this.guard, input));
    }
    return status;
  }

  private async readValue(meta: SecretMetadata): Promise<string> {
    const cached = this.cache.get(meta.secretId);
    if (cached !== undefined) return cached;
    const bytes = await this.material.readAndUnprotect(meta.credentialTarget);
    if (!bytes) throw new CredentialsNeedReentryError();
    const value = bytes.toString("utf8");
    bytes.fill(0);
    this.cache.set(meta.secretId, value);
    return value;
  }

  private requireMeta(secretId: string): SecretMetadata {
    const meta = this.metadata.getVaultMetadata(secretId);
    if (!meta) throw new SecretNotFoundError(secretId);
    return meta;
  }

  private offerFor(secret: string, label: string, secretId: string | null): PurgeOffer {
    return {
      secretId,
      label,
      invocation: "one-click",
      invoke: async () => {
        if (!this.purge) throw new SecretPurgeUnavailableError();
        return this.purge.executeSecretPurge(secret, { label });
      },
    };
  }

  private async fingerprints(): Promise<VaultHmac> {
    if (!this.hmac) this.hmac = await VaultHmac.load(path.join(this.vaultDir, "hmac.salt"));
    return this.hmac;
  }

  private overflowPath(secretId: string): string {
    return path.join(this.vaultDir, "blobs", `${secretId}.bin`);
  }

  private writeLog(event: "put" | "rotate" | "delete", meta: SecretMetadata, verifiedStatus: VerifiedStatus): void {
    if (!this.logsDir) return;
    const line = JSON.stringify({
      ts: this.now(),
      event,
      secretId: meta.secretId,
      name: meta.name,
      envScope: meta.envScope,
      verifiedStatus,
    });
    appendFileSync(path.join(this.logsDir, "vault.jsonl"), `${line}\n`, "utf8");
  }
}

export function credentialTargetFor(secretId: string): string {
  return `EFHarness:vault:${secretId}`;
}

export function createSecretId(now: number): string {
  return `sec_${now.toString(16)}_${randomBytes(8).toString("hex")}`;
}

function validateSecret(name: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new VaultError("secret_name", "Secret names must be environment variable identifiers.");
  }
  if (value.length === 0 || value.trim().length === 0) {
    throw new VaultError("secret_empty", "Refusing to store an empty secret.");
  }
  if (value.includes("\0")) {
    throw new VaultError("secret_nul", "Refusing a secret that contains a NUL byte.");
  }
  if (name === value) {
    throw new VaultError("secret_name", "Refusing to use the secret value as its name.");
  }
}

function guardInput(input: PutSecretInput) {
  return {
    value: input.value,
    envScope: input.envScope,
    name: input.name,
    ...(input.providerHint ? { providerHint: input.providerHint } : {}),
    ...(input.taggedProd ? { taggedProd: true as const } : {}),
    ...(input.pairedWithLiveSecret ? { pairedWithLiveSecret: true as const } : {}),
    ...(input.explicitTestOverride ? { explicitTestOverride: true as const } : {}),
  };
}

function refusedMessage(guard: LiveKeyTestRefusalGuard, input: PutSecretInput): string {
  const decision = guard.inspect({ ...guardInput(input), stripeLivemode: true });
  if (!decision.allowed) return decision.message;
  return "Refused to store a live-verified credential in a test or dev scope.";
}
