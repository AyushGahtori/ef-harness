import {
  DEFAULT_OPENROUTER_ORIGIN,
  MICRO_USD_SCALE,
  OPENROUTER_AUTHORIZE_PATH,
  OPENROUTER_EXCHANGE_PATH,
  OPENROUTER_KEY_PATH,
  USD_CURRENCY,
} from "./constants.js";
import { OpenRouterLocalError, OpenRouterOAuthCancelledError } from "./errors.js";
import { fetchJson } from "./http.js";
import { isRecord, numberField, recordField, stringField } from "./json.js";
import { LoopbackCallbackServer } from "./loopback-server.js";
import { connectionStorageRow } from "./memory-ports.js";
import {
  openRouterRemainingDisplay,
  usdToMicroUsd,
  windDownStartsAtMicroUsd,
} from "./money.js";
import { createPkcePair, type PkcePair } from "./pkce.js";
import type {
  CreditWindDownPort,
  DpapiSecretsVaultPort,
  ExternalBrowserPort,
  FetchPort,
  GlobalConnectionRecord,
  GlobalConnectionsPort,
  OpenRouterBalance,
  OpenRouterCostReceipt,
  OpenRouterCreditBinding,
} from "./ports.js";

export interface OpenRouterOAuthResult {
  readonly connection: GlobalConnectionRecord;
  readonly storageRow: ReturnType<typeof connectionStorageRow>;
  readonly balance: OpenRouterBalance;
  readonly display: string;
  readonly binding: OpenRouterCreditBinding;
  readonly authorizeUrl: string;
}

export interface OpenRouterPkceOAuthFlowOptions {
  readonly vault: DpapiSecretsVaultPort;
  readonly connections: GlobalConnectionsPort;
  readonly browser: ExternalBrowserPort;
  readonly windDown: CreditWindDownPort;
  readonly projectId: string;
  readonly apiOrigin?: string;
  readonly authOrigin?: string;
  readonly fetchImpl?: FetchPort;
  readonly creditLimitUsd?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly envScope?: "test" | "dev" | "staging" | "prod";
  readonly secretName?: string;
  readonly randomBytes?: (size: number) => Buffer;
}

export function buildOpenRouterAuthorizeUrl(input: {
  readonly origin: string;
  readonly callbackUrl: string;
  readonly codeChallenge: string;
  readonly creditLimitUsd?: number;
}): string {
  const url = new URL(OPENROUTER_AUTHORIZE_PATH, input.origin);
  url.searchParams.set("callback_url", input.callbackUrl);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.creditLimitUsd !== undefined) {
    url.searchParams.set("limit", String(input.creditLimitUsd));
  }
  return url.toString();
}

export function parseOpenRouterKeyBalance(body: unknown): OpenRouterBalance {
  if (!isRecord(body)) {
    throw new OpenRouterLocalError("balance-failed", "OpenRouter key balance was not an object");
  }
  const data = recordField(body, "data") ?? body;
  const limitUsd = nullableNumber(data, "limit");
  const usageUsd = numberField(data, "usage") ?? 0;
  let limitRemainingUsd = nullableNumber(data, "limit_remaining");
  if (limitRemainingUsd === null && limitUsd !== null) {
    limitRemainingUsd = limitUsd - usageUsd;
  }
  return { limitUsd, usageUsd, limitRemainingUsd };
}

export function ingestOpenRouterUsageCost(body: unknown): OpenRouterCostReceipt {
  if (!isRecord(body)) {
    throw new OpenRouterLocalError("cost-missing", "OpenRouter response has no usage.cost");
  }
  const usage = recordField(body, "usage");
  const cost = usage ? numberField(usage, "cost") : null;
  if (usage === null || cost === null) {
    throw new OpenRouterLocalError("cost-missing", "OpenRouter response has no usage.cost");
  }
  return {
    reported: true,
    currency: "usd",
    costMicroUsd: usdToMicroUsd(cost),
    promptTokens: numberField(usage, "prompt_tokens") ?? 0,
    completionTokens: numberField(usage, "completion_tokens") ?? 0,
    totalTokens: numberField(usage, "total_tokens") ?? 0,
  };
}

export function bindingFromBalance(input: {
  readonly connectionId: string;
  readonly balance: OpenRouterBalance;
  readonly reason: OpenRouterCreditBinding["reason"];
  readonly exhaustedOverride?: boolean;
}): OpenRouterCreditBinding {
  const limitMicroUsd = input.balance.limitUsd === null ? null : usdToMicroUsd(input.balance.limitUsd);
  const usedMicroUsd = usdToMicroUsd(input.balance.usageUsd);
  const remainingMicroUsd =
    input.balance.limitRemainingUsd === null ? null : usdToMicroUsd(input.balance.limitRemainingUsd);
  const windDownAt =
    limitMicroUsd === null ? null : windDownStartsAtMicroUsd(limitMicroUsd);
  const pastWindDown =
    limitMicroUsd !== null && windDownAt !== null && usedMicroUsd >= windDownAt;
  const exhausted =
    input.exhaustedOverride === true || (remainingMicroUsd !== null && remainingMicroUsd <= 0);
  const display =
    input.balance.limitRemainingUsd === null
      ? "OpenRouter key has no credit cap"
      : openRouterRemainingDisplay(input.balance.limitRemainingUsd);
  return {
    connectionId: input.connectionId,
    limitMicroUsd,
    usedMicroUsd,
    remainingMicroUsd,
    windDownStartsAtMicroUsd: windDownAt,
    pastWindDown,
    exhausted,
    display,
    reason: input.reason,
  };
}

function nullableNumber(record: Record<string, unknown>, key: string): number | null {
  if (!(key in record) || record[key] === null) return null;
  return numberField(record, key);
}

function readMintedKey(body: unknown): string {
  if (!isRecord(body)) {
    throw new OpenRouterLocalError("exchange-failed", "OpenRouter key exchange returned no key");
  }
  const key = stringField(body, "key");
  if (key === null) {
    throw new OpenRouterLocalError("exchange-failed", "OpenRouter key exchange returned no key");
  }
  return key;
}

/**
 * OpenRouter browser PKCE (S256) on an ephemeral 127.0.0.1 callback.
 * The minted key is stored only through the DPAPI port. `global.db` keeps `vault_ref`.
 */
export class OpenRouterPkceOAuthFlow {
  private abort: AbortController | null = null;
  private loopback: LoopbackCallbackServer | null = null;
  private running = false;

  constructor(private readonly options: OpenRouterPkceOAuthFlowOptions) {}

  cancel(): void {
    this.abort?.abort();
  }

  async start(): Promise<OpenRouterOAuthResult> {
    if (this.running) {
      throw new OpenRouterLocalError("busy", "OpenRouter sign-in is already running");
    }
    this.running = true;
    this.abort = new AbortController();
    const loopback = await LoopbackCallbackServer.listen();
    this.loopback = loopback;
    try {
      return await this.run(loopback);
    } finally {
      await loopback.close();
      this.loopback = null;
      this.running = false;
    }
  }

  private async run(loopback: LoopbackCallbackServer): Promise<OpenRouterOAuthResult> {
    const signal = this.abort?.signal;
    if (signal?.aborted) throw new OpenRouterOAuthCancelledError("cancelled");
    const pkce = createPkcePair(this.options.randomBytes);
    const origin = this.options.authOrigin ?? this.options.apiOrigin ?? DEFAULT_OPENROUTER_ORIGIN;
    const authorizeUrl = buildOpenRouterAuthorizeUrl({
      origin,
      callbackUrl: loopback.callbackUrl,
      codeChallenge: pkce.challenge,
      ...(this.options.creditLimitUsd !== undefined ? { creditLimitUsd: this.options.creditLimitUsd } : {}),
    });
    const pending = loopback.wait(this.options.timeoutMs ?? 5 * 60 * 1000, signal);
    await this.options.browser.openExternal(authorizeUrl);
    const callback = await pending;
    if (callback.status === "cancelled") {
      throw new OpenRouterOAuthCancelledError(callback.error);
    }
    const apiOrigin = this.options.apiOrigin ?? DEFAULT_OPENROUTER_ORIGIN;
    const key = await this.exchange(apiOrigin, callback.code, pkce);
    const balance = await this.loadBalance(apiOrigin, key);
    const handle = await this.options.vault.put({
      projectId: this.options.projectId,
      envScope: this.options.envScope ?? "dev",
      name: this.options.secretName ?? "OPENROUTER_API_KEY",
      value: key,
      providerHint: "openrouter",
    });
    const createdAt = this.options.now?.() ?? Date.now();
    const connection: GlobalConnectionRecord = {
      id: `openrouter-${handle.secretId}`,
      provider: "openrouter",
      route: "api_key",
      plan: null,
      vaultRef: handle.secretId,
      currency: USD_CURRENCY,
      scale: MICRO_USD_SCALE,
      enabled: true,
      createdAt,
    };
    try {
      await this.options.connections.insert(connection);
    } catch (error) {
      await this.options.vault.delete(handle.secretId);
      throw error;
    }
    const binding = bindingFromBalance({
      connectionId: connection.id,
      balance,
      reason: "oauth",
    });
    this.options.windDown.bindOpenRouterCredit(binding);
    return {
      connection,
      storageRow: connectionStorageRow(connection),
      balance,
      display: binding.display,
      binding,
      authorizeUrl,
    };
  }

  private async exchange(origin: string, code: string, pkce: PkcePair): Promise<string> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchJson(
      fetchImpl,
      new URL(OPENROUTER_EXCHANGE_PATH, origin).toString(),
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          code,
          code_verifier: pkce.verifier,
          code_challenge_method: "S256",
        }),
      },
      15_000,
    );
    if (response.status !== 200) {
      throw new OpenRouterLocalError("exchange-failed", `OpenRouter key exchange failed (${response.status})`);
    }
    return readMintedKey(response.body);
  }

  private async loadBalance(origin: string, key: string): Promise<OpenRouterBalance> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchJson(
      fetchImpl,
      new URL(OPENROUTER_KEY_PATH, origin).toString(),
      {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${key}` },
      },
      15_000,
    );
    if (response.status !== 200) {
      throw new OpenRouterLocalError("balance-failed", `OpenRouter key balance failed (${response.status})`);
    }
    return parseOpenRouterKeyBalance(response.body);
  }
}
