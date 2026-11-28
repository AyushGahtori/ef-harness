import { COPILOT_EXHAUSTED_ACTIONS, exhaustedPremiumMessage } from "./constants.js";
import { CopilotOverageConfirmationRequiredError, CopilotPremiumExhaustedError } from "./errors.js";
import { assertNoRawCredential, type RedactingAuditLog } from "./redact.js";
import type {
  CheckpointStopNotifier,
  Clock,
  CopilotAccountClient,
  CopilotCheckpointStopCard,
  CopilotConnectionMetadata,
  CopilotPacingFeed,
  CopilotPacingSignal,
  CopilotQuota,
  GlobalDbConnectionsPort,
  QuotaReadReason,
  TimerRegistry,
  WindowsDpapiSecretsVault,
} from "./types.js";

export type QuotaReadOutcome =
  | {
      readonly kind: "ok";
      readonly proceeded: true;
      readonly quota: CopilotQuota;
      readonly pacing: CopilotPacingSignal;
    }
  | {
      readonly kind: "exhausted_included";
      readonly proceeded: false;
      readonly quota: CopilotQuota;
      readonly pacing: CopilotPacingSignal;
      readonly checkpoint: CopilotCheckpointStopCard;
    }
  | {
      readonly kind: "paid_overage_confirmation_required";
      readonly proceeded: false;
      readonly quota: CopilotQuota;
      readonly pacing: CopilotPacingSignal;
      readonly confirmation: {
        readonly task141PaidTransition: true;
        readonly connectionId: string;
        readonly resetDateUtc: string;
        readonly message: string;
      };
    }
  | {
      readonly kind: "paid_overage_approved";
      readonly proceeded: true;
      readonly explicitUserApproval: true;
      readonly quota: CopilotQuota;
      readonly pacing: CopilotPacingSignal;
    };

export interface CopilotQuotaReaderDeps {
  readonly vault: WindowsDpapiSecretsVault;
  readonly connections: GlobalDbConnectionsPort;
  readonly account: CopilotAccountClient;
  readonly pacing: CopilotPacingFeed;
  readonly checkpoints: CheckpointStopNotifier;
  readonly log: RedactingAuditLog;
  readonly timers: TimerRegistry;
  readonly clock: Clock;
}

export class CopilotQuotaReader {
  private readonly stopped = new Set<string>();
  private readonly handles = new Map<string, number>();

  constructor(private readonly deps: CopilotQuotaReaderDeps) {}

  async read(connectionId: string, reason: QuotaReadReason): Promise<QuotaReadOutcome> {
    const record = this.deps.connections.get(connectionId);
    if (!record || record.metadata.kind !== "copilot" || !record.vaultRef) {
      throw new Error("Copilot connection was not found");
    }
    const token = this.deps.vault.readSecret(record.vaultRef);
    if (!token) throw new Error("Copilot credential is missing from the DPAPI vault");
    this.deps.log.seal(token);
    const quota = normalizeQuota(await this.deps.account.accountGetQuota(token));
    const outcome = this.decide(connectionId, record.metadata, quota, reason);
    this.deps.pacing.onQuota(outcome.pacing);
    if (outcome.kind === "exhausted_included") this.deps.checkpoints.open(outcome.checkpoint);
    this.deps.log.record("copilot_quota_read", {
      connectionId,
      reason,
      remaining: quota.remaining,
      overageEnabled: quota.overageEnabled,
      billingMode: record.metadata.billingMode,
      decision: outcome.kind,
      readAt: this.deps.clock.now(),
    });
    assertNoRawCredential("quota outcome", JSON.stringify(outcome), [token]);
    assertNoRawCredential("logs", this.deps.log.text(), [token]);
    return outcome;
  }

  async assertMaySpendPremium(
    connectionId: string,
  ): Promise<{ readonly allowed: true; readonly explicitUserApproval: boolean }> {
    const outcome = await this.read(connectionId, "build_start");
    if (outcome.kind === "paid_overage_confirmation_required") {
      throw new CopilotOverageConfirmationRequiredError(connectionId);
    }
    if (outcome.kind === "exhausted_included") {
      throw new CopilotPremiumExhaustedError(outcome.checkpoint.message);
    }
    return {
      allowed: true,
      explicitUserApproval: outcome.kind === "paid_overage_approved",
    };
  }

  confirmPaidOverage(connectionId: string, resetDateUtc: string): void {
    this.deps.connections.update(connectionId, (current) => {
      if (current.metadata.kind !== "copilot") throw new Error("Not a Copilot connection");
      return {
        ...current,
        metadata: { ...current.metadata, overageApprovedForReset: resetDateUtc },
      };
    });
    this.deps.log.record("copilot_overage_approved", { connectionId, resetDateUtc });
  }

  startPeriodic(connectionId: string, intervalMs: number): void {
    if (intervalMs < 1_000) {
      throw new Error("Periodic quota reads must wait at least 1000 ms");
    }
    this.stopPeriodic(connectionId);
    this.stopped.delete(connectionId);
    this.arm(connectionId, intervalMs);
  }

  stopPeriodic(connectionId: string): void {
    this.stopped.add(connectionId);
    const handle = this.handles.get(connectionId);
    if (handle !== undefined) this.deps.timers.clear(handle);
    this.handles.delete(connectionId);
  }

  private arm(connectionId: string, intervalMs: number): void {
    if (this.stopped.has(connectionId)) return;
    const handle = this.deps.timers.set(() => {
      void this.read(connectionId, "periodic")
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "unknown";
          this.deps.log.record("copilot_quota_periodic_failed", { connectionId, message });
        })
        .finally(() => {
          this.arm(connectionId, intervalMs);
        });
    }, intervalMs);
    this.handles.set(connectionId, handle);
  }

  private decide(
    connectionId: string,
    metadata: CopilotConnectionMetadata,
    quota: CopilotQuota,
    reason: QuotaReadReason,
  ): QuotaReadOutcome {
    const subscription = metadata.billingMode === "copilot_subscription";
    const pacingBase = {
      connectionId,
      provider: "github_copilot" as const,
      billingMode: metadata.billingMode,
      reason,
      entitlement: quota.entitlement,
      remaining: quota.remaining,
      percentRemaining: quota.percentRemaining,
      resetDateUtc: quota.resetDateUtc,
      overageEnabled: quota.overageEnabled,
      analyticsCurrency: subscription ? ("premium_requests" as const) : ("api_usd" as const),
      subscriptionQuotaApplies: subscription,
    };
    if (!subscription) {
      return {
        kind: "ok",
        proceeded: true,
        quota,
        pacing: { ...pacingBase, dispatch: "allow" },
      };
    }
    if (quota.remaining === 0 && quota.overageEnabled) {
      if (metadata.overageApprovedForReset === quota.resetDateUtc) {
        return {
          kind: "paid_overage_approved",
          proceeded: true,
          explicitUserApproval: true,
          quota,
          pacing: { ...pacingBase, dispatch: "allow_paid_overage" },
        };
      }
      return {
        kind: "paid_overage_confirmation_required",
        proceeded: false,
        quota,
        pacing: { ...pacingBase, dispatch: "pause_for_confirmation" },
        confirmation: {
          task141PaidTransition: true,
          connectionId,
          resetDateUtc: quota.resetDateUtc,
          message: "Copilot would switch into paid overage. Confirm before a charge is incurred.",
        },
      };
    }
    if (quota.remaining === 0 && !quota.overageEnabled) {
      const message = exhaustedPremiumMessage(quota.resetDateUtc);
      return {
        kind: "exhausted_included",
        proceeded: false,
        quota,
        pacing: { ...pacingBase, dispatch: "park" },
        checkpoint: {
          kind: "checkpoint_stop",
          connectionId,
          message,
          actions: COPILOT_EXHAUSTED_ACTIONS,
        },
      };
    }
    return {
      kind: "ok",
      proceeded: true,
      quota,
      pacing: { ...pacingBase, dispatch: "allow" },
    };
  }
}

function normalizeQuota(quota: CopilotQuota): CopilotQuota {
  if (!Number.isInteger(quota.entitlement) || quota.entitlement < 0) {
    throw new Error("Copilot entitlement was not a usable count");
  }
  if (!Number.isInteger(quota.remaining) || quota.remaining < 0) {
    throw new Error("Copilot remaining allowance was not a usable count");
  }
  if (
    typeof quota.percentRemaining !== "number" ||
    quota.percentRemaining < 0 ||
    quota.percentRemaining > 100
  ) {
    throw new Error("Copilot percentRemaining was outside 0..100");
  }
  if (!quota.resetDateUtc) throw new Error("Copilot resetDateUtc was missing");
  return quota;
}
