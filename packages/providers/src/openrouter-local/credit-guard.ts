import { CREDIT_POLL_EVERY_TURNS, OPENROUTER_KEY_PATH } from "./constants.js";
import { OpenRouterLocalError } from "./errors.js";
import { fetchJson } from "./http.js";
import { bindingFromBalance, parseOpenRouterKeyBalance } from "./oauth-flow.js";
import type {
  CreditWindDownPort,
  DpapiSecretsVaultPort,
  FetchPort,
  GlobalConnectionsPort,
  OpenRouterCreditBinding,
} from "./ports.js";

export interface OpenRouterCreditGuardOptions {
  readonly vault: DpapiSecretsVaultPort;
  readonly connections: GlobalConnectionsPort;
  readonly windDown: CreditWindDownPort;
  readonly apiOrigin: string;
  readonly fetchImpl?: FetchPort;
  readonly timeoutMs?: number;
}

/**
 * Polls `GET /api/v1/auth/key` on build start, every 10 turns, and after HTTP 402.
 * The binding is what Task 128 uses to wind down before OpenRouter's hard cap.
 */
export class OpenRouterCreditBalanceGuard {
  private readonly turns = new Map<string, number>();

  constructor(private readonly options: OpenRouterCreditGuardOptions) {}

  onBuildStart(connectionId: string): Promise<OpenRouterCreditBinding> {
    return this.refresh(connectionId, "build_start", false);
  }

  afterTurn(connectionId: string): Promise<OpenRouterCreditBinding | null> {
    const next = (this.turns.get(connectionId) ?? 0) + 1;
    this.turns.set(connectionId, next);
    if (next % CREDIT_POLL_EVERY_TURNS !== 0) return Promise.resolve(null);
    return this.refresh(connectionId, "turn_interval", false);
  }

  async afterHttpStatus(connectionId: string, status: number): Promise<OpenRouterCreditBinding | null> {
    if (status !== 402) return null;
    try {
      return await this.refresh(connectionId, "payment_required", true);
    } catch {
      const binding: OpenRouterCreditBinding = {
        connectionId,
        limitMicroUsd: null,
        usedMicroUsd: 0,
        remainingMicroUsd: 0,
        windDownStartsAtMicroUsd: null,
        pastWindDown: true,
        exhausted: true,
        display: "$0.00 remaining on OpenRouter key",
        reason: "payment_required",
      };
      this.options.windDown.bindOpenRouterCredit(binding);
      return binding;
    }
  }

  private async refresh(
    connectionId: string,
    reason: OpenRouterCreditBinding["reason"],
    exhaustedOverride: boolean,
  ): Promise<OpenRouterCreditBinding> {
    const connection = await this.options.connections.get(connectionId);
    if (!connection?.vaultRef) {
      throw new OpenRouterLocalError("balance-failed", "OpenRouter connection has no vault reference");
    }
    const secret = await this.options.vault.readSecret(connection.vaultRef);
    if (!secret) {
      throw new OpenRouterLocalError("balance-failed", "OpenRouter key is not in the vault");
    }
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchJson(
      fetchImpl,
      new URL(OPENROUTER_KEY_PATH, this.options.apiOrigin).toString(),
      {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${secret.value}` },
      },
      this.options.timeoutMs ?? 15_000,
    );
    if (response.status !== 200) {
      throw new OpenRouterLocalError("balance-failed", `OpenRouter key balance failed (${response.status})`);
    }
    const balance = parseOpenRouterKeyBalance(response.body);
    const binding = bindingFromBalance({
      connectionId,
      balance,
      reason,
      exhaustedOverride,
    });
    this.options.windDown.bindOpenRouterCredit(binding);
    return binding;
  }
}
