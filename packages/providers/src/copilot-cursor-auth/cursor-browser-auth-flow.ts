import { CURSOR_KEY_LIFETIME_MS } from "./constants.js";
import { CursorAuthCancelledError, CursorUnauthorizedError } from "./errors.js";
import { assertNoRawCredential, type RedactingAuditLog } from "./redact.js";
import {
  emptyCursorReminder,
  isVaultReference,
  maskedPreview,
  type Clock,
  type CursorAuthLoginPort,
  type GlobalConnectionRecord,
  type GlobalDbConnectionsPort,
  type TimerRegistry,
  type UserAgentActions,
  type WindowsDpapiSecretsVault,
} from "./types.js";

export interface CursorBrowserAuthDeps {
  readonly cursor: CursorAuthLoginPort;
  readonly clock: Clock;
  readonly timers: TimerRegistry;
  readonly vault: WindowsDpapiSecretsVault;
  readonly connections: GlobalDbConnectionsPort;
  readonly log: RedactingAuditLog;
  readonly agent: UserAgentActions;
}

export interface EstablishedCursorConnection {
  readonly connection: GlobalConnectionRecord;
}

export class CursorBrowserAuthFlow {
  private inflight: AbortController | null = null;

  constructor(private readonly deps: CursorBrowserAuthDeps) {}

  async login(options?: { readonly connectionId?: string }): Promise<EstablishedCursorConnection> {
    if (this.inflight) throw new Error("A Cursor browser login is already in progress");
    const controller = new AbortController();
    this.inflight = controller;
    const handle = this.deps.timers.set(() => {
      controller.abort();
    }, 15 * 60 * 1000);
    try {
      const result = await this.deps.cursor.login({
        signal: controller.signal,
        openBrowser: (url) => {
          this.deps.agent.openExternal(url, "os_browser");
        },
      });
      if (controller.signal.aborted) throw new CursorAuthCancelledError();
      const usage = await this.deps.cursor.getUsage(result.userApiKey);
      if (!usage.ok) throw this.probeFailure(usage.status, usage.message);
      const models = await this.deps.cursor.probeModels(result.userApiKey);
      if (!models.ok) throw this.probeFailure(models.status, models.message);
      if (controller.signal.aborted) throw new CursorAuthCancelledError();
      return this.persist({
        connectionId: options?.connectionId ?? null,
        userApiKey: result.userApiKey,
        chargedCents: usage.chargedCents,
        modelCount: models.models.length,
      });
    } finally {
      this.deps.timers.clear(handle);
      this.inflight = null;
    }
  }

  cancel(): void {
    this.inflight?.abort();
  }

  async refresh(connectionId: string): Promise<EstablishedCursorConnection> {
    const existing = this.deps.connections.get(connectionId);
    if (!existing || existing.metadata.kind !== "cursor") {
      throw new Error("Cursor connection was not found");
    }
    return this.login({ connectionId });
  }

  disconnect(connectionId: string): void {
    this.cancel();
    const row = this.deps.connections.get(connectionId);
    if (row?.vaultRef) this.deps.vault.deleteSecret(row.vaultRef);
    if (row) this.deps.connections.delete(connectionId);
    this.deps.log.record("cursor_disconnected", { connectionId });
  }

  private probeFailure(status: number, message: string): Error {
    if (status === 401) return new CursorUnauthorizedError(message);
    return new Error(message);
  }

  private persist(input: {
    readonly connectionId: string | null;
    readonly userApiKey: string;
    readonly chargedCents: number;
    readonly modelCount: number;
  }): EstablishedCursorConnection {
    const now = this.deps.clock.now();
    const existing = input.connectionId ? this.deps.connections.get(input.connectionId) : null;
    const createdAt =
      existing?.metadata.kind === "cursor" ? existing.createdAt : now;
    const id = input.connectionId ?? this.allocateId();
    const previousVault = existing?.metadata.kind === "cursor" ? existing.vaultRef : null;
    const secretId = `vault:cursorUserApiKey:${id}:${now}`;
    if (!isVaultReference(secretId)) throw new Error("Vault reference was rejected");
    this.deps.log.seal(input.userApiKey);
    const written = this.deps.vault.writeSecret({
      secretId,
      name: "cursorUserApiKey",
      plaintext: input.userApiKey,
      providerHint: "cursor",
    });
    const record: GlobalConnectionRecord = {
      id,
      provider: "cursor",
      route: "cursor_sdk",
      plan: "cursor",
      vaultRef: written.secretId,
      currency: `allowance:${id}`,
      scale: 1,
      enabled: 1,
      createdAt,
      metadata: {
        kind: "cursor",
        authMode: "cursor_browser",
        billingMode: "cursor_subscription",
        issuedAt: now,
        expiresAt: now + CURSOR_KEY_LIFETIME_MS,
        maskedPreview: maskedPreview(written.lastFourMasked),
        verifiedAt: now,
        status: "active",
        modelCount: input.modelCount,
        chargedCents: input.chargedCents,
        reminder: emptyCursorReminder(),
      },
    };
    try {
      assertNoRawCredential("connection record", JSON.stringify(record), [input.userApiKey]);
      this.deps.connections.upsert(record);
      this.deps.log.record("cursor_connected", {
        connectionId: id,
        expiresAt: now + CURSOR_KEY_LIFETIME_MS,
        modelCount: input.modelCount,
      });
      assertNoRawCredential("global.db", this.deps.connections.exportSnapshot(), [input.userApiKey]);
      assertNoRawCredential("logs", this.deps.log.text(), [input.userApiKey]);
      assertNoRawCredential("dpapi at rest", this.deps.vault.exportAtRest(), [input.userApiKey]);
      if (previousVault && previousVault !== written.secretId) {
        this.deps.vault.deleteSecret(previousVault);
      }
    } catch (error) {
      this.deps.vault.deleteSecret(written.secretId);
      if (existing) this.deps.connections.upsert(existing);
      else this.deps.connections.delete(id);
      throw error;
    }
    const stored = this.deps.connections.get(id);
    if (!stored || stored.metadata.kind !== "cursor") {
      throw new Error("Cursor connection was not stored");
    }
    return { connection: stored };
  }

  private allocateId(): string {
    const base = "cursor-primary";
    if (!this.deps.connections.get(base)) return base;
    let suffix = 2;
    while (this.deps.connections.get(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }
}
