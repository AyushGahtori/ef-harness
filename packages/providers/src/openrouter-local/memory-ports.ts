import { randomBytes } from "node:crypto";
import { maskLastFour } from "./money.js";
import type {
  CreditWindDownPort,
  DpapiPutInput,
  DpapiSecretHandle,
  DpapiSecretMaterial,
  DpapiSecretsVaultPort,
  GlobalConnectionRecord,
  GlobalConnectionsPort,
  GpuHeadroomSample,
  OpenRouterCreditBinding,
  VramTelemetryPort,
  WhisperDispatch,
  WhisperPriorityPort,
  WhisperTicket,
} from "./ports.js";

interface StoredSecret extends DpapiSecretHandle {
  readonly projectId: string;
  readonly value: string;
}

/**
 * In-memory stand-in for Task 120. Plaintext never appears on connection rows.
 * Swap the constructor argument for `WindowsDpapiSecretsVault` at integration.
 */
export class InMemoryDpapiSecretsVault implements DpapiSecretsVaultPort {
  private readonly secrets = new Map<string, StoredSecret>();
  private sequence = 0;

  async put(input: DpapiPutInput): Promise<DpapiSecretHandle> {
    this.sequence += 1;
    const secretId = `vault-${this.sequence}-${randomBytes(4).toString("hex")}`;
    const handle: StoredSecret = {
      secretId,
      projectId: input.projectId,
      name: input.name,
      value: input.value,
      lastFourMasked: maskLastFour(input.value),
    };
    this.secrets.set(secretId, handle);
    return {
      secretId: handle.secretId,
      name: handle.name,
      lastFourMasked: handle.lastFourMasked,
    };
  }

  async readSecret(secretId: string): Promise<DpapiSecretMaterial | null> {
    const stored = this.secrets.get(secretId);
    if (!stored) return null;
    return { secretId: stored.secretId, name: stored.name, value: stored.value };
  }

  async delete(secretId: string): Promise<void> {
    this.secrets.delete(secretId);
  }

  metadataWithoutSecrets(): readonly DpapiSecretHandle[] {
    return [...this.secrets.values()].map((row) => ({
      secretId: row.secretId,
      name: row.name,
      lastFourMasked: row.lastFourMasked,
    }));
  }
}

/** In-memory stand-in for Task 014 `connections`. */
export class InMemoryGlobalConnections implements GlobalConnectionsPort {
  private readonly rows = new Map<string, GlobalConnectionRecord>();

  async insert(row: GlobalConnectionRecord): Promise<void> {
    this.rows.set(row.id, { ...row });
  }

  async get(id: string): Promise<GlobalConnectionRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async list(): Promise<readonly GlobalConnectionRecord[]> {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

/** In-memory stand-in for the Task 128 credit ceiling. */
export class InMemoryCreditWindDown implements CreditWindDownPort {
  bindings: OpenRouterCreditBinding[] = [];

  bindOpenRouterCredit(binding: OpenRouterCreditBinding): void {
    this.bindings.push({ ...binding });
  }

  latest(connectionId: string): OpenRouterCreditBinding | null {
    for (let index = this.bindings.length - 1; index >= 0; index -= 1) {
      const binding = this.bindings[index];
      if (binding?.connectionId === connectionId) return binding;
    }
    return null;
  }
}

export class InMemoryVramTelemetry implements VramTelemetryPort {
  constructor(private sample: GpuHeadroomSample) {}

  setSample(sample: GpuHeadroomSample): void {
    this.sample = sample;
  }

  sampleGpu(): GpuHeadroomSample {
    return this.sample;
  }
}

/**
 * Minimal Task 118 behavior: dictation queues background local dispatches.
 * Swap for `GpuWhisperPriorityArbiter` via `whisperPortFromArbiter`.
 */
export class InMemoryWhisperPriority implements WhisperPriorityPort {
  dictationActive = false;
  readonly queued: WhisperDispatch[] = [];

  activateDictation(): void {
    this.dictationActive = true;
  }

  deactivateDictation(): void {
    this.dictationActive = false;
  }

  enqueueLocalModel(request: WhisperDispatch): WhisperTicket {
    if (this.dictationActive) {
      this.queued.push(request);
      return { state: "queued", reason: "deferred: whisper dictation holds interactive GPU priority" };
    }
    return { state: "granted", reason: "granted" };
  }
}

export function connectionStorageRow(row: GlobalConnectionRecord): {
  readonly id: string;
  readonly provider: string;
  readonly route: string;
  readonly plan: string | null;
  readonly vault_ref: string | null;
  readonly currency: string;
  readonly scale: number;
  readonly enabled: 0 | 1;
  readonly created_at: number;
} {
  return {
    id: row.id,
    provider: row.provider,
    route: row.route,
    plan: row.plan,
    vault_ref: row.vaultRef,
    currency: row.currency,
    scale: row.scale,
    enabled: row.enabled ? 1 : 0,
    created_at: row.createdAt,
  };
}
