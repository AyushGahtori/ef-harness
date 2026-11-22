import { DeviceFlowCancelledError } from "./errors.js";
import {
  emptyCursorReminder,
  isVaultReference,
  type Clock,
  type CopilotModelMultiplier,
  type GlobalConnectionRecord,
  type GlobalDbConnectionsPort,
  type SecretPublicMetadata,
  type SecretWriteResult,
  type SignedProviderPolicyEnginePort,
  type SqlConnectionRow,
  type TimerRegistry,
  type WindowsDpapiSecretsVault,
} from "./types.js";

export { emptyCursorReminder };

/**
 * In-memory stand-in for Task 120 `WindowsDpapiSecretsVault`.
 * At-rest bytes are XOR-masked. Plaintext is available only through `readSecret`.
 */
export class LocalWindowsDpapiSecretsVault implements WindowsDpapiSecretsVault {
  private readonly atRest = new Map<string, string>();
  private readonly plaintext = new Map<string, string>();
  private readonly meta = new Map<string, SecretPublicMetadata>();

  writeSecret(input: {
    readonly secretId: string;
    readonly name: "gitHubToken" | "cursorUserApiKey";
    readonly plaintext: string;
    readonly providerHint: "github_copilot" | "cursor";
  }): SecretWriteResult {
    if (!isVaultReference(input.secretId)) {
      throw new Error("DPAPI secret id must be a vault reference");
    }
    if (input.plaintext.length < 12) {
      throw new Error("Refusing a credential that is too short to mask");
    }
    const encoded = bytesToBase64(protect(input.plaintext));
    if (encoded.includes(input.plaintext)) {
      throw new Error("DPAPI stand-in left a credential in plaintext at rest");
    }
    const lastFourMasked = input.plaintext.slice(-4);
    this.atRest.set(input.secretId, encoded);
    this.plaintext.set(input.secretId, input.plaintext);
    this.meta.set(input.secretId, {
      secretId: input.secretId,
      name: input.name,
      providerHint: input.providerHint,
      lastFourMasked,
    });
    return { secretId: input.secretId, lastFourMasked };
  }

  readSecret(secretId: string): string | null {
    return this.plaintext.get(secretId) ?? null;
  }

  deleteSecret(secretId: string): void {
    this.atRest.delete(secretId);
    this.plaintext.delete(secretId);
    this.meta.delete(secretId);
  }

  exportAtRest(): string {
    return JSON.stringify([...this.atRest.entries()]);
  }

  listPublicMetadata(): readonly SecretPublicMetadata[] {
    return [...this.meta.values()];
  }
}

/**
 * In-memory stand-in for Task 014 `GlobalDbRepo.connections`.
 * Rows match `schema/global.sql` columns. Extra auth metadata rides in `metadata_json`
 * because the frozen connections table has no issued_at / expires_at columns.
 */
export class LocalGlobalDbConnections implements GlobalDbConnectionsPort {
  private readonly rows = new Map<string, GlobalConnectionRecord>();

  upsert(record: GlobalConnectionRecord): void {
    this.assertPublic(record);
    this.rows.set(record.id, structuredClone(record));
  }

  update(id: string, patch: (current: GlobalConnectionRecord) => GlobalConnectionRecord): void {
    const current = this.get(id);
    if (!current) throw new Error(`Unknown connection ${id}`);
    const next = patch(current);
    if (next.id !== id) throw new Error("Connection id is immutable");
    this.assertPublic(next);
    this.rows.set(id, structuredClone(next));
  }

  get(id: string): GlobalConnectionRecord | null {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  delete(id: string): void {
    this.rows.delete(id);
  }

  list(): readonly GlobalConnectionRecord[] {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }

  exportSnapshot(): string {
    const sql: SqlConnectionRow[] = [...this.rows.values()].map((record) => ({
      id: record.id,
      provider: record.provider,
      route: record.route,
      plan: record.plan,
      vault_ref: record.vaultRef,
      currency: record.currency,
      scale: record.scale,
      enabled: record.enabled,
      created_at: record.createdAt,
      metadata_json: JSON.stringify(record.metadata),
    }));
    return JSON.stringify(sql);
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

function protect(plaintext: string): Uint8Array {
  const bytes = Buffer.from(plaintext, "utf8");
  const out = Buffer.alloc(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    out[index] = (bytes[index] ?? 0) ^ 0x5a;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
