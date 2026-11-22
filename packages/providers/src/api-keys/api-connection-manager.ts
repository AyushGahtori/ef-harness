import { randomUUID } from "node:crypto";
import {
  API_KEY_AUTH_MODE,
  ApiKeyOnboardingError,
  MICRO_USD_SCALE,
  type ApiConnectionRecord,
  type ApiCostLedgerEntry,
  type ApiKeyFamily,
  type ApiKeyProviderId,
  type ConnectionStatus,
  type CustomRateTable,
  type ValidationResult,
} from "./api-key-types.js";
import {
  ApiKeyPrefixDetector,
  maskKeyPreview,
  normalizePastedApiKey,
  previewStemForProvider,
  type PrefixDetection,
} from "./api-key-prefix-detector.js";
import { checkCustomBaseUrl } from "./endpoint-url.js";
import { asNonNegativeBigInt } from "./integer-micro-usd.js";
import type { BudgetLedgerPort } from "./local-budget-ledger.js";
import type { WindowsDpapiSecretsVaultPort } from "./local-dpapi-vault.js";
import type { GlobalDbConnectionsPort } from "./local-global-db-connections.js";
import { OFFLINE_SAVE_MESSAGE } from "./prefix-fragments.js";
import type { ZeroTokenApiKeyValidator } from "./zero-token-api-key-validator.js";

export interface SaveApiKeyInput {
  readonly rawKey: string;
  readonly label: string;
  readonly providerOverride?: ApiKeyProviderId;
  readonly customBaseUrl?: string;
  readonly customRates?: CustomRateTable;
  readonly userMonthlyCapMicroUsd?: bigint;
  readonly offline?: boolean;
}

export interface RotateApiKeyInput {
  readonly rawKey: string;
  readonly offline?: boolean;
  readonly customRates?: CustomRateTable;
}

export type SaveApiKeyResult =
  | { readonly outcome: "saved"; readonly connection: ApiConnectionRecord; readonly message: string }
  | { readonly outcome: "rejected"; readonly message: string }
  | { readonly outcome: "needs_selection"; readonly message: string }
  | { readonly outcome: "invalid_key"; readonly message: string };

export interface ApiConnectionManagerOptions {
  readonly vault: WindowsDpapiSecretsVaultPort;
  readonly connections: GlobalDbConnectionsPort;
  readonly ledger: BudgetLedgerPort;
  readonly validator: ZeroTokenApiKeyValidator;
  readonly detector?: ApiKeyPrefixDetector;
  readonly now?: () => number;
  readonly createId?: () => string;
}

interface ResolvedKey {
  readonly provider: ApiKeyProviderId;
  readonly keyFamily: ApiKeyFamily;
  readonly normalizedKey: string;
  readonly previewStem: string;
}

export class ApiConnectionManager {
  private readonly vault: WindowsDpapiSecretsVaultPort;
  private readonly connections: GlobalDbConnectionsPort;
  private readonly ledger: BudgetLedgerPort;
  private readonly validator: ZeroTokenApiKeyValidator;
  private readonly detector: ApiKeyPrefixDetector;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(options: ApiConnectionManagerOptions) {
    this.vault = options.vault;
    this.connections = options.connections;
    this.ledger = options.ledger;
    this.validator = options.validator;
    this.detector = options.detector ?? new ApiKeyPrefixDetector();
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => `api-key-${randomUUID()}`);
  }

  async savePastedKey(input: SaveApiKeyInput): Promise<SaveApiKeyResult> {
    const label = input.label.trim();
    if (label.length === 0) {
      return { outcome: "rejected", message: "Enter a label for this connection." };
    }
    const resolved = this.resolveKey(input.rawKey, input.providerOverride);
    if ("outcome" in resolved) return resolved;
    const prepared = this.prepareEndpoint(resolved.key, input.customBaseUrl);
    if ("outcome" in prepared) return prepared;
    const cap = this.readCap(input.userMonthlyCapMicroUsd);
    if ("outcome" in cap) return cap;

    if (input.offline === true) {
      const connection = this.insertConnection({
        key: resolved.key,
        label,
        cap: cap.cap,
        customBaseUrl: prepared.customBaseUrl,
        customRates: resolved.key.provider === "custom" ? (input.customRates ?? null) : null,
        status: "unverified_offline",
        verifiedAt: null,
        discoveredModels: [],
        enabled: true,
        resumeStatus: null,
      });
      return { outcome: "saved", connection, message: OFFLINE_SAVE_MESSAGE };
    }

    const validation = await this.validator.validate({
      apiKey: resolved.key.normalizedKey,
      provider: resolved.key.provider,
      ...(prepared.customBaseUrl ? { customBaseUrl: prepared.customBaseUrl } : {}),
    });
    return this.finishCreate(resolved.key, label, cap.cap, prepared.customBaseUrl, input.customRates, validation);
  }

  async rotateKey(connectionId: string, input: RotateApiKeyInput): Promise<SaveApiKeyResult> {
    const existing = this.connections.get(connectionId);
    if (!existing) return { outcome: "rejected", message: "Connection was not found." };
    const resolved = this.resolveKey(input.rawKey, existing.provider === "custom" ? "custom" : undefined);
    if ("outcome" in resolved) return resolved;
    if (resolved.key.provider !== existing.provider) {
      return {
        outcome: "rejected",
        message: "This key belongs to a different provider. Add a new connection instead of rotating in place.",
      };
    }
    const prepared = this.prepareEndpoint(resolved.key, existing.customBaseUrl ?? undefined);
    if ("outcome" in prepared) return prepared;

    if (input.offline === true) {
      const connection = this.replaceSecret(existing, resolved.key, {
        ...projectStatus(existing, "unverified_offline", null, existing.discoveredModels),
        customRates: this.rotatedRates(existing, input.customRates),
      });
      return { outcome: "saved", connection, message: OFFLINE_SAVE_MESSAGE };
    }

    const validation = await this.validator.validate({
      apiKey: resolved.key.normalizedKey,
      provider: resolved.key.provider,
      ...(prepared.customBaseUrl ? { customBaseUrl: prepared.customBaseUrl } : {}),
    });
    if (!validation.ok && (validation.failureClass === "invalid_key" || validation.failureClass === "network_or_proxy_blocked")) {
      return validation.failureClass === "invalid_key"
        ? { outcome: "invalid_key", message: validation.message }
        : { outcome: "rejected", message: validation.message };
    }
    if (!validation.ok && isHardRejection(validation.failureClass)) {
      return { outcome: "rejected", message: validation.message };
    }
    const applied = applyValidation(existing, validation, this.now());
    const connection = this.replaceSecret(existing, resolved.key, {
      ...applied,
      customRates: this.rotatedRates(existing, input.customRates),
    });
    const message = validation.ok ? verifiedMessage(validation.discoveredModels.length) : validation.message;
    return { outcome: "saved", connection, message };
  }

  async retest(connectionId: string): Promise<{ readonly connection: ApiConnectionRecord; readonly validation: ValidationResult }> {
    const existing = this.require(connectionId);
    const apiKey = this.vault.getPlaintext(existing.vaultRef);
    const validation = await this.validator.validate({
      apiKey,
      provider: existing.provider,
      ...(existing.customBaseUrl ? { customBaseUrl: existing.customBaseUrl } : {}),
    });
    const wasVerified = existing.status === "verified" || existing.resumeStatus === "verified";
    if (!validation.ok && validation.failureClass === "network_or_proxy_blocked" && wasVerified) {
      return { connection: existing, validation };
    }
    const applied = applyValidation(existing, validation, this.now());
    const connection: ApiConnectionRecord = { ...existing, ...applied };
    this.connections.update(connection);
    return { connection, validation };
  }

  disable(connectionId: string): ApiConnectionRecord {
    const existing = this.require(connectionId);
    if (!existing.enabled && existing.status === "disabled") return existing;
    const next: ApiConnectionRecord = {
      ...existing,
      enabled: false,
      status: "disabled",
      resumeStatus: existing.status === "disabled" ? existing.resumeStatus : existing.status,
    };
    this.connections.update(next);
    return next;
  }

  enable(connectionId: string): ApiConnectionRecord {
    const existing = this.require(connectionId);
    if (existing.enabled && existing.status !== "disabled") return existing;
    const restored = existing.resumeStatus && existing.resumeStatus !== "disabled"
      ? existing.resumeStatus
      : "unverified_offline";
    const next: ApiConnectionRecord = {
      ...existing,
      enabled: true,
      status: restored,
      resumeStatus: null,
    };
    this.connections.update(next);
    return next;
  }

  delete(connectionId: string): void {
    const existing = this.require(connectionId);
    this.vault.delete(existing.vaultRef);
    this.connections.delete(connectionId);
  }

  get(connectionId: string): ApiConnectionRecord | undefined {
    return this.connections.get(connectionId);
  }

  list(): readonly ApiConnectionRecord[] {
    return this.connections.list();
  }

  usageReceipts(connectionId: string): readonly ApiCostLedgerEntry[] {
    return this.ledger.listByConnection(connectionId);
  }

  private finishCreate(
    key: ResolvedKey,
    label: string,
    cap: bigint | null,
    customBaseUrl: string | null,
    customRates: CustomRateTable | undefined,
    validation: ValidationResult,
  ): SaveApiKeyResult {
    if (!validation.ok && validation.failureClass === "invalid_key") {
      return { outcome: "invalid_key", message: validation.message };
    }
    if (!validation.ok && isHardRejection(validation.failureClass)) {
      return { outcome: "rejected", message: validation.message };
    }
    if (!validation.ok && validation.failureClass === "network_or_proxy_blocked") {
      const connection = this.insertConnection({
        key,
        label,
        cap,
        customBaseUrl,
        customRates: key.provider === "custom" ? (customRates ?? null) : null,
        status: "unverified_offline",
        verifiedAt: null,
        discoveredModels: [],
        enabled: true,
        resumeStatus: null,
      });
      return { outcome: "saved", connection, message: OFFLINE_SAVE_MESSAGE };
    }
    const status = validation.ok ? "verified" : failureStatus(validation.failureClass);
    const connection = this.insertConnection({
      key,
      label,
      cap,
      customBaseUrl,
      customRates: key.provider === "custom" ? (customRates ?? null) : null,
      status,
      verifiedAt: validation.ok ? this.now() : null,
      discoveredModels: validation.ok ? validation.discoveredModels : [],
      enabled: true,
      resumeStatus: null,
    });
    const message = validation.ok ? verifiedMessage(validation.discoveredModels.length) : validation.message;
    return { outcome: "saved", connection, message };
  }

  private insertConnection(input: {
    readonly key: ResolvedKey;
    readonly label: string;
    readonly cap: bigint | null;
    readonly customBaseUrl: string | null;
    readonly customRates: CustomRateTable | null;
    readonly status: ConnectionStatus;
    readonly verifiedAt: number | null;
    readonly discoveredModels: readonly string[];
    readonly enabled: boolean;
    readonly resumeStatus: ConnectionStatus | null;
  }): ApiConnectionRecord {
    this.assertPreviewSafe(input.key.normalizedKey, input.key.previewStem);
    const connectionId = this.createId();
    const vaultRef = `api-key:${connectionId}`;
    const record: ApiConnectionRecord = {
      connectionId,
      provider: input.key.provider,
      label: input.label,
      authMode: API_KEY_AUTH_MODE,
      maskedKeyPreview: maskKeyPreview(input.key.normalizedKey, input.key.previewStem),
      discoveredModels: [...input.discoveredModels],
      userMonthlyCapMicroUsd: input.cap,
      verifiedAt: input.verifiedAt,
      status: input.status,
      resumeStatus: input.resumeStatus,
      enabled: input.enabled,
      keyFamily: input.key.keyFamily,
      customBaseUrl: input.customBaseUrl,
      customRates: input.customRates,
      vaultRef,
      createdAt: this.now(),
      currency: "usd",
      scale: MICRO_USD_SCALE,
    };
    this.vault.put({
      secretId: vaultRef,
      plaintext: input.key.normalizedKey,
      name: input.label,
      providerHint: input.key.provider,
      envScope: "prod",
    });
    try {
      this.connections.insert(record);
    } catch (error) {
      this.vault.delete(vaultRef);
      throw error;
    }
    return record;
  }

  private replaceSecret(
    existing: ApiConnectionRecord,
    key: ResolvedKey,
    patch: {
      readonly status: ConnectionStatus;
      readonly resumeStatus: ConnectionStatus | null;
      readonly enabled: boolean;
      readonly verifiedAt: number | null;
      readonly discoveredModels: readonly string[];
      readonly customRates: CustomRateTable | null;
    },
  ): ApiConnectionRecord {
    this.assertPreviewSafe(key.normalizedKey, key.previewStem);
    const previous = this.vault.getPlaintext(existing.vaultRef);
    const next: ApiConnectionRecord = {
      ...existing,
      status: patch.status,
      resumeStatus: patch.resumeStatus,
      enabled: patch.enabled,
      verifiedAt: patch.verifiedAt,
      discoveredModels: patch.discoveredModels,
      maskedKeyPreview: maskKeyPreview(key.normalizedKey, key.previewStem),
      keyFamily: key.keyFamily,
      customRates: patch.customRates,
    };
    this.vault.rotate(existing.vaultRef, key.normalizedKey);
    try {
      this.connections.update(next);
    } catch (error) {
      try {
        this.vault.rotate(existing.vaultRef, previous);
      } catch (restoreError) {
        const reason = restoreError instanceof Error ? restoreError.message : "restore failed";
        throw new ApiKeyOnboardingError(`Key rotation failed and the previous secret could not be restored (${reason})`);
      }
      throw error;
    }
    return next;
  }

  private resolveKey(
    rawKey: string,
    providerOverride: ApiKeyProviderId | undefined,
  ): { readonly key: ResolvedKey } | SaveApiKeyResult {
    const detection = this.detector.inspect(rawKey);
    if (detection.kind === "rejected") {
      return { outcome: "rejected", message: detection.message };
    }
    if (detection.kind === "detected") {
      if (providerOverride && providerOverride !== detection.provider) {
        return {
          outcome: "rejected",
          message: `This key's prefix matches ${detection.provider}. Add a new connection for a different provider instead of overriding it.`,
        };
      }
      return {
        key: {
          provider: detection.provider,
          keyFamily: detection.keyFamily,
          normalizedKey: detection.normalizedKey,
          previewStem: detection.previewStem,
        },
      };
    }
    return this.resolveUnknown(rawKey, detection, providerOverride);
  }

  private resolveUnknown(
    rawKey: string,
    detection: Extract<PrefixDetection, { kind: "unknown" }>,
    providerOverride: ApiKeyProviderId | undefined,
  ): { readonly key: ResolvedKey } | SaveApiKeyResult {
    if (!providerOverride) {
      return { outcome: "needs_selection", message: detection.message };
    }
    const normalizedKey = normalizePastedApiKey(rawKey);
    if (normalizedKey.length < 16) {
      return { outcome: "rejected", message: "This API key looks truncated. Paste the full key." };
    }
    if (providerOverride === "custom") {
      return {
        key: { provider: "custom", keyFamily: "custom", normalizedKey, previewStem: "key" },
      };
    }
    return {
      key: {
        provider: providerOverride,
        keyFamily: "provider_selected",
        normalizedKey,
        previewStem: previewStemForProvider(providerOverride, normalizedKey),
      },
    };
  }

  private prepareEndpoint(
    key: ResolvedKey,
    customBaseUrl: string | undefined,
  ): { readonly customBaseUrl: string | null } | SaveApiKeyResult {
    if (key.normalizedKey.length < 16) {
      return { outcome: "rejected", message: "This API key looks truncated. Paste the full key." };
    }
    if (key.provider !== "custom") {
      if (customBaseUrl) {
        return {
          outcome: "rejected",
          message: "A custom base URL is only used for a custom OpenAI-compatible endpoint.",
        };
      }
      return { customBaseUrl: null };
    }
    if (!customBaseUrl) {
      return { outcome: "rejected", message: "Enter a custom OpenAI-compatible base URL." };
    }
    if (customBaseUrl.includes(key.normalizedKey)) {
      return { outcome: "rejected", message: "Custom base URLs cannot contain the API key." };
    }
    const checked = checkCustomBaseUrl(customBaseUrl);
    if (!checked.ok) return { outcome: "rejected", message: checked.message };
    return { customBaseUrl: checked.base.toString() };
  }

  private readCap(
    cap: bigint | undefined,
  ): { readonly cap: bigint | null } | SaveApiKeyResult {
    if (cap === undefined) return { cap: null };
    try {
      return { cap: asNonNegativeBigInt(cap, "userMonthlyCapMicroUsd") };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Monthly cap is invalid";
      return { outcome: "rejected", message };
    }
  }

  private rotatedRates(existing: ApiConnectionRecord, next: CustomRateTable | undefined): CustomRateTable | null {
    if (existing.provider !== "custom") return null;
    return next ?? existing.customRates;
  }

  private assertPreviewSafe(normalizedKey: string, previewStem: string): void {
    const preview = maskKeyPreview(normalizedKey, previewStem);
    if (preview === normalizedKey || preview.includes(normalizedKey)) {
      throw new ApiKeyOnboardingError("Refusing to store an unmasked key preview");
    }
  }

  private require(connectionId: string): ApiConnectionRecord {
    const existing = this.connections.get(connectionId);
    if (!existing) throw new ApiKeyOnboardingError("Connection was not found.");
    return existing;
  }
}

function verifiedMessage(count: number): string {
  const noun = count === 1 ? "model" : "models";
  return `Key verified. Discovered ${count} ${noun}.`;
}

function isHardRejection(failureClass: string): boolean {
  return (
    failureClass === "subscription_oauth_rejected" ||
    failureClass === "compliance_rejected" ||
    failureClass === "insecure_base_url"
  );
}

function failureStatus(failureClass: string): ConnectionStatus {
  if (
    failureClass === "billing_not_active" ||
    failureClass === "insufficient_quota" ||
    failureClass === "org_restriction" ||
    failureClass === "rate_limited" ||
    failureClass === "provider_error"
  ) {
    return failureClass;
  }
  return "provider_error";
}

function applyValidation(
  existing: ApiConnectionRecord,
  validation: ValidationResult,
  now: number,
): Pick<ApiConnectionRecord, "status" | "resumeStatus" | "enabled" | "verifiedAt" | "discoveredModels"> {
  if (!validation.ok && validation.failureClass === "invalid_key") {
    return projectStatus(existing, "rejected_by_provider", null, existing.discoveredModels);
  }
  if (!validation.ok && validation.failureClass === "network_or_proxy_blocked") {
    return projectStatus(existing, "unverified_offline", null, existing.discoveredModels);
  }
  if (!validation.ok) {
    return projectStatus(existing, failureStatus(validation.failureClass), null, existing.discoveredModels);
  }
  return projectStatus(existing, "verified", now, validation.discoveredModels);
}

function projectStatus(
  existing: ApiConnectionRecord,
  status: ConnectionStatus,
  verifiedAt: number | null,
  discoveredModels: readonly string[],
): Pick<ApiConnectionRecord, "status" | "resumeStatus" | "enabled" | "verifiedAt" | "discoveredModels"> {
  const disabled = !existing.enabled || existing.status === "disabled";
  if (disabled) {
    return {
      status: "disabled",
      resumeStatus: status,
      enabled: false,
      verifiedAt,
      discoveredModels,
    };
  }
  return {
    status,
    resumeStatus: null,
    enabled: true,
    verifiedAt,
    discoveredModels,
  };
}
