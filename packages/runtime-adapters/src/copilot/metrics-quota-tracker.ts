import { CopilotAdapterError, CopilotAuthExpiredError, CopilotByokComplianceError, CopilotOveragePausedError } from "./errors.js";
import { isBadCredentials, normalizeAccountQuota, normalizeSessionMetrics, readSessionMetrics } from "./normalize.js";
import { quotaWindow } from "./connection-windows.js";
import { quotaSnapshotForPacing } from "./ports.js";
import { ACCOUNT_CARD_TITLE, OVERAGE_STOP_MESSAGE } from "./types.js";
import type { AccountQuotaSnapshot, BillingMode, ByokProvider, NormalizedUsage, ResolvedByok } from "./types.js";
import type { CopilotRuntimeDeps } from "./ports.js";

export interface TurnMetricSource {
  readonly usage: { getMetrics(): Promise<unknown> };
}

export interface QuotaPollInput {
  readonly connectionId: string;
  readonly modelId: string;
  readonly billingMode: BillingMode;
  readonly effectiveTokens: number;
  readonly reason: "session_start" | "pre_turn" | "post_turn";
}

/**
 * Reads `session.usage.getMetrics()` and `account.getQuota()`, writes `connection_windows`,
 * feeds Task 140, and pauses before paid overage.
 */
export class CopilotMetricsAndQuotaTracker {
  private readonly latest = new Map<string, AccountQuotaSnapshot>();
  private readonly previous = new Map<string, AccountQuotaSnapshot>();
  private readonly opened = new Set<string>();
  private readonly accountCards = new Set<string>();

  constructor(private readonly deps: CopilotRuntimeDeps) {}

  async readTurnMetrics(
    source: TurnMetricSource,
    partialInterrupted: boolean,
    billing: {
      readonly mode: BillingMode;
      readonly connectionId: string;
      readonly byok: ResolvedByok | null;
    },
  ): Promise<NormalizedUsage> {
    const fields = await readSessionMetrics(source, partialInterrupted);
    const quota = this.latest.get(billing.connectionId) ?? null;
    if (billing.mode === "byok_api_key") {
      const byok = requireByok(billing.byok);
      const costMicroUsd = this.deps.prices.estimateMicroUsd({
        provider: byok.provider,
        model: byok.model,
        inputTokens: fields.inputTokens,
        cachedInputTokens: fields.cachedInputTokens,
        cacheCreationInputTokens: fields.cacheCreationInputTokens,
        outputTokens: fields.outputTokens,
        reasoningTokens: fields.reasoningTokens,
      });
      this.deps.byokLedger.record({
        connectionId: byok.connectionId,
        provider: byok.provider,
        model: byok.model,
        microUsd: costMicroUsd,
        billingMode: "byok_api_key",
      });
      return {
        ...fields,
        premiumRequests: 0,
        costMicroUsd,
        billingMode: "byok_api_key",
        partial_interrupted: fields.partial_interrupted,
        subscriptionQuotaApplies: false,
        byokConnectionId: byok.connectionId,
        explicitOverageApproval: false,
        quota,
      };
    }
    return {
      ...fields,
      costMicroUsd: null,
      billingMode: "copilot_subscription",
      subscriptionQuotaApplies: true,
      byokConnectionId: null,
      explicitOverageApproval: quota
        ? this.deps.approvals.isApproved(billing.connectionId, quota.resetDateUtc)
        : false,
      quota,
    };
  }

  metricsFromPayload(raw: unknown, partialInterrupted: boolean, billing: {
    readonly mode: BillingMode;
    readonly connectionId: string;
    readonly byok: ResolvedByok | null;
  }): Promise<NormalizedUsage> {
    return this.readTurnMetrics(
      {
        usage: {
          getMetrics: async () => {
            if (raw instanceof Error && raw instanceof TypeError) throw raw;
            return raw;
          },
        },
      },
      partialInterrupted,
      billing,
    );
  }

  async pollQuota(input: QuotaPollInput, readQuota: () => Promise<unknown>): Promise<AccountQuotaSnapshot> {
    let raw: unknown;
    try {
      raw = await readQuota();
    } catch (error) {
      if (isBadCredentials(error)) {
        this.parkAuth(input.connectionId);
        throw new CopilotAuthExpiredError();
      }
      throw error;
    }
    const quota = normalizeAccountQuota(raw);
    if (input.billingMode === "byok_api_key") {
      this.latest.set(input.connectionId, quota);
      return quota;
    }
    const prior = this.latest.get(input.connectionId) ?? null;
    if (prior) this.previous.set(input.connectionId, prior);
    this.latest.set(input.connectionId, quota);
    const paced = await this.deps.pacing.observeCopilotQuota({
      connectionId: input.connectionId,
      modelId: input.modelId,
      effectiveTokens: input.effectiveTokens,
      previous: prior ? quotaSnapshotForPacing(prior) : null,
      next: quotaSnapshotForPacing(quota),
    });
    const cwnd = paced?.cwnd ?? this.deps.pacing.getCwnd(input.connectionId);
    this.deps.windows.upsert(
      quotaWindow({
        connectionId: input.connectionId,
        quota,
        observedAt: this.deps.clock.now(),
        cwnd,
      }),
    );
    this.evaluateStop(input.connectionId, quota);
    return quota;
  }

  assertCanDispatch(connectionId: string, billingMode: BillingMode): void {
    if (billingMode !== "copilot_subscription") return;
    const quota = this.latest.get(connectionId);
    if (!quota || quota.remaining > 0) return;
    this.evaluateStop(connectionId, quota);
    if (quota.overageEnabled && this.deps.approvals.isApproved(connectionId, quota.resetDateUtc)) return;
    if (!quota.overageEnabled) {
      throw new CopilotAdapterError("premium_exhausted", "Copilot premium requests are exhausted");
    }
    throw new CopilotOveragePausedError(OVERAGE_STOP_MESSAGE);
  }

  approvePaidOverage(connectionId: string, resetDateUtc: string): void {
    this.deps.approvals.approve(connectionId, resetDateUtc);
  }

  parkAuth(connectionId: string): void {
    this.deps.fallbackGuard.refuse({ fromConnectionId: connectionId, attempted: "other_paid_connection" });
    if (this.accountCards.has(connectionId)) return;
    this.accountCards.add(connectionId);
    this.deps.cards.openAccount({
      kind: "account_card",
      connectionId,
      title: ACCOUNT_CARD_TITLE,
    });
  }

  private evaluateStop(connectionId: string, quota: AccountQuotaSnapshot): void {
    if (quota.remaining !== 0) return;
    this.deps.pacing.setCwnd(connectionId, 0);
    const current = this.deps.windows.latest(connectionId);
    if (current) this.deps.windows.upsert({ ...current, cwnd: 0, observed_at: this.deps.clock.now() });
    if (!quota.overageEnabled) return;
    if (this.deps.approvals.isApproved(connectionId, quota.resetDateUtc)) return;
    const key = `${connectionId}:${quota.resetDateUtc}`;
    if (this.opened.has(key)) return;
    this.opened.add(key);
    this.deps.cards.openCheckpointStop({
      kind: "checkpoint_stop",
      connectionId,
      reason: "paid_overage",
      remaining: 0,
      overageEnabled: true,
      resetDateUtc: quota.resetDateUtc,
      cwnd: 0,
      requiresExplicitApproval: true,
      message: OVERAGE_STOP_MESSAGE,
    });
  }
}

function requireByok(byok: ResolvedByok | null): ResolvedByok {
  if (!byok) throw new CopilotByokComplianceError("BYOK session is missing provider material");
  return byok;
}

export function assertByokMaterial(deps: CopilotRuntimeDeps, provider: ByokProvider, key: string): void {
  try {
    deps.compliance.assertByokKey(provider, key);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Anthropic Console API key required";
    throw new CopilotByokComplianceError(message);
  }
}

export function usageFromFields(fields: ReturnType<typeof normalizeSessionMetrics>): NormalizedUsage {
  return {
    ...fields,
    costMicroUsd: null,
    billingMode: "copilot_subscription",
    subscriptionQuotaApplies: true,
    byokConnectionId: null,
    explicitOverageApproval: false,
    quota: null,
  };
}
