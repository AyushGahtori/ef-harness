import { sha256 } from "./redactor.js";
import { verifyHealthAndBuildId } from "./health.js";
import type {
  Clock,
  DeployAdapter,
  DeployEnvironment,
  EffectApprovalStatus,
  EnvApprovalPolicyEngine,
  ExternalEffectLedger,
  PacketSecurityRedactor,
  PlannedEffect,
  ProductionAlertCardSink,
  ProductionRollbackCard,
  ShipRunState,
  TlsProbe,
} from "./types.js";

export interface RollbackRequest {
  readonly shipRunId: string;
  readonly env: DeployEnvironment;
  readonly commitSha: string;
  readonly liveUrl: string;
  readonly deploymentId: string;
  readonly previousSha: string;
  readonly previousDeploymentId: string;
  readonly failingCheck: string;
  readonly consoleErrors: readonly string[];
  readonly redactedLogs: string;
  readonly screenshotSha256: string | null;
}

export interface RollbackDecision {
  readonly state: ShipRunState;
  readonly rolledBack: boolean;
  readonly previousHealthy: boolean | null;
  readonly cardId: string | null;
  readonly notification: string;
  readonly redactedLogs: string;
  readonly rollbackTargetId: string | null;
  readonly repairTaskRequested: boolean;
}

interface PendingRollback {
  readonly request: RollbackRequest;
  readonly planned: PlannedEffect;
  resolved: boolean;
}

export function defaultEnvApprovalPolicy(): EnvApprovalPolicyEngine {
  return {
    rollbackDisposition(env) {
      return env === "production" ? "explicit_approval" : "automatic";
    },
  };
}

/**
 * Opt-in only. Production stays explicit unless a developer has already
 * enabled automatic production rollback through the approval policy.
 */
export function developerEnabledProductionAutoRollbackPolicy(): EnvApprovalPolicyEngine {
  return {
    rollbackDisposition() {
      return "automatic";
    },
  };
}

export class InMemoryProductionAlertCardSink implements ProductionAlertCardSink {
  readonly cards: ProductionRollbackCard[] = [];

  async raise(card: ProductionRollbackCard): Promise<{ readonly cardId: string }> {
    this.cards.push(card);
    return { cardId: card.cardId };
  }
}

export class EnvironmentRollbackPolicyController {
  private readonly pending = new Map<string, PendingRollback>();

  constructor(
    private readonly deps: {
      readonly adapter: DeployAdapter;
      readonly ledger: ExternalEffectLedger;
      readonly policy: EnvApprovalPolicyEngine;
      readonly cards: ProductionAlertCardSink;
      readonly redactor: PacketSecurityRedactor;
      readonly clock?: Clock;
      readonly tlsProbe?: TlsProbe;
      readonly fetchImpl?: typeof fetch;
    },
  ) {}

  async handle(request: RollbackRequest): Promise<RollbackDecision> {
    const existing = [...this.pending.values()].find(
      (item) => item.request.shipRunId === request.shipRunId && !item.resolved,
    );
    if (existing) {
      return this.awaiting(existing.request, this.cardId(existing.request));
    }
    const disposition = this.deps.policy.rollbackDisposition(request.env);
    if (disposition === "explicit_approval") {
      return this.offer(request);
    }
    return this.execute(request, "auto_allowed");
  }

  async approveRollback(cardId: string): Promise<RollbackDecision> {
    const pending = this.requirePending(cardId);
    pending.resolved = true;
    return this.dispatch(pending.request, pending.planned, "developer approved production rollback");
  }

  async keepLive(cardId: string): Promise<RollbackDecision> {
    const pending = this.requirePending(cardId);
    pending.resolved = true;
    await this.deps.ledger.markFailed(
      pending.planned.effectId,
      "developer chose Investigate / Keep Live",
    );
    return {
      state: "KEPT_LIVE",
      rolledBack: false,
      previousHealthy: null,
      cardId,
      notification: `Production ${pending.request.commitSha} kept live after ${pending.request.failingCheck}. Investigate / Keep Live.`,
      redactedLogs: pending.request.redactedLogs,
      rollbackTargetId: null,
      repairTaskRequested: true,
    };
  }

  private async offer(request: RollbackRequest): Promise<RollbackDecision> {
    const planned = await this.plan(request, "pending_approval");
    const cardId = this.cardId(request);
    this.pending.set(cardId, { request, planned, resolved: false });
    const card: ProductionRollbackCard = {
      cardId,
      severity: "P0",
      interruptNow: true,
      shipRunId: request.shipRunId,
      env: request.env,
      previousSha: request.previousSha,
      previousDeploymentId: request.previousDeploymentId,
      summary: `Production ${request.failingCheck} failed for ${request.commitSha}`,
      evidence: {
        failingCheck: request.failingCheck,
        consoleErrors: request.consoleErrors,
        redactedLogs: request.redactedLogs,
        screenshotSha256: request.screenshotSha256,
      },
      actions: [
        {
          id: "approve-rollback",
          label: `Approve Rollback to ${request.previousSha} Now`,
        },
        { id: "keep-live", label: "Investigate / Keep Live" },
      ],
    };
    await this.deps.cards.raise(card);
    return this.awaiting(request, cardId);
  }

  private awaiting(request: RollbackRequest, cardId: string): RollbackDecision {
    return {
      state: "AWAITING_PROD_ROLLBACK_APPROVAL",
      rolledBack: false,
      previousHealthy: null,
      cardId,
      notification: `P0 production alert: ${request.failingCheck}. Approve Rollback to ${request.previousSha} Now, or Investigate / Keep Live.`,
      redactedLogs: request.redactedLogs,
      rollbackTargetId: null,
      repairTaskRequested: true,
    };
  }

  private async execute(
    request: RollbackRequest,
    approval: EffectApprovalStatus,
  ): Promise<RollbackDecision> {
    const planned = await this.plan(request, approval);
    const phrase =
      approval === "auto_allowed"
        ? `${request.env} automatic rollback`
        : "approved rollback";
    return this.dispatch(request, planned, phrase);
  }

  private async plan(
    request: RollbackRequest,
    approval: EffectApprovalStatus,
  ): Promise<PlannedEffect> {
    return this.deps.ledger.plan({
      effectType: "rollback",
      targetEnv: request.env,
      idempotencyKey: this.idempotencyKey(request),
      canonicalPayload: {
        env: request.env,
        fromDeploymentId: request.deploymentId,
        previousDeploymentId: request.previousDeploymentId,
        previousSha: request.previousSha,
        failingCheck: request.failingCheck,
      },
      approvalStatus: approval,
    });
  }

  private async dispatch(
    request: RollbackRequest,
    planned: PlannedEffect,
    phrase: string,
  ): Promise<RollbackDecision> {
    await this.deps.ledger.markDispatched(planned.effectId);
    try {
      const rolled = await this.deps.adapter.rollback(
        request.env,
        request.previousDeploymentId,
        planned.effectId,
      );
      let previousHealthy = false;
      let healthNote = "";
      try {
        await verifyHealthAndBuildId(
          {
            env: request.env,
            liveUrl: rolled.liveUrl,
            expectedCommitSha: rolled.buildId,
            maxWaitMs: 0,
          },
          {
            ...(this.deps.clock ? { clock: this.deps.clock } : {}),
            ...(this.deps.tlsProbe ? { tlsProbe: this.deps.tlsProbe } : {}),
            ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
          },
        );
        previousHealthy = true;
        healthNote = "Previous release is HTTP 200.";
      } catch (error) {
        previousHealthy = false;
        healthNote = this.deps.redactor.redact(
          error instanceof Error
            ? `Previous release failed health confirmation: ${error.message}`
            : "Previous release failed health confirmation.",
        );
      }
      await this.deps.ledger.markSucceeded(planned.effectId, {
        deploymentId: rolled.deploymentId,
        buildId: rolled.buildId,
        previousHealthy: previousHealthy ? "true" : "false",
      });
      return {
        state: "ROLLED_BACK",
        rolledBack: true,
        previousHealthy,
        cardId: null,
        notification: `${phrase} to ${request.previousSha}. ${healthNote}`,
        redactedLogs: request.redactedLogs,
        rollbackTargetId: request.previousDeploymentId,
        repairTaskRequested: true,
      };
    } catch (error) {
      const reason = this.deps.redactor.redact(
        error instanceof Error ? error.message : String(error),
      );
      await this.deps.ledger.markFailed(planned.effectId, reason);
      throw error;
    }
  }

  private requirePending(cardId: string): PendingRollback {
    const pending = this.pending.get(cardId);
    if (!pending || pending.resolved) {
      throw new Error(`No open production rollback card ${cardId}`);
    }
    return pending;
  }

  private idempotencyKey(request: RollbackRequest): string {
    return `rollback:${request.env}:${request.deploymentId}:${request.previousDeploymentId}:${request.failingCheck}`;
  }

  private cardId(request: RollbackRequest): string {
    return `p0-${request.shipRunId}-${sha256(this.idempotencyKey(request)).slice(0, 12)}`;
  }
}
