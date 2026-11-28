import { randomUUID } from "node:crypto";
import { canonicalPayloadHash } from "./canonical-hash.js";
import { EnvApprovalPolicyEngine } from "./approval-policy.js";
import { LeaseEpochFencingGuard } from "./fencing.js";
import { PayloadHashMismatchError } from "./errors.js";
import { assertNoRawSecretsInPayload, redactEffectPayload } from "./redactor.js";
import { SqliteEffectStore } from "./store.js";
import { UnknownOutcomeReconciler } from "./reconciler.js";
import type { LeaseEpochFencingGuardPort } from "./fencing.js";
import type {
  EffectAuditEntry,
  EffectIntent,
  EffectRecord,
  ProjectRuntimeFence,
} from "./types.js";

export interface EffectPlan {
  readonly effectId: string;
  readonly effectType: string;
  readonly targetEnv: EffectIntent["targetEnv"];
  readonly canonicalPayloadHash: string;
  readonly idempotencyKey: string;
  readonly approvalRequired: boolean;
  readonly humanSummary: string;
  readonly redactedPayload: unknown;
}

export interface ExternalEffectLedgerOptions {
  readonly store?: SqliteEffectStore;
  readonly policy?: EnvApprovalPolicyEngine;
  readonly previewAutoDeployOptIn?: boolean;
  readonly now?: () => number;
}

export class StoreFencePort implements LeaseEpochFencingGuardPort {
  constructor(private readonly store: SqliteEffectStore) {}

  readFence(): ProjectRuntimeFence {
    return this.store.readRuntimeFence();
  }
}

export class ExternalEffectLedger {
  readonly store: SqliteEffectStore;
  readonly policy: EnvApprovalPolicyEngine;
  readonly fencing: LeaseEpochFencingGuard;
  readonly reconciler: UnknownOutcomeReconciler;
  private readonly now: () => number;
  private networkCallCount = 0;

  constructor(options: ExternalEffectLedgerOptions = {}) {
    this.store = options.store ?? new SqliteEffectStore(options.now ? { now: options.now } : {});
    this.policy =
      options.policy ??
      new EnvApprovalPolicyEngine(
        options.previewAutoDeployOptIn === undefined
          ? {}
          : { previewAutoDeployOptIn: options.previewAutoDeployOptIn },
      );
    this.fencing = new LeaseEpochFencingGuard(new StoreFencePort(this.store));
    this.reconciler = new UnknownOutcomeReconciler(this.store);
    this.now = options.now ?? (() => Date.now());
  }

  getNetworkCallCount(): number {
    return this.networkCallCount;
  }

  planEffect(intent: EffectIntent, autoApprove?: boolean): EffectPlan {
    const hash = canonicalPayloadHash(intent.payload);
    const redacted = redactEffectPayload(intent.payload);
    const policy = this.policy.evaluate(intent.effectType, intent.targetEnv, autoApprove);
    const effectId = `eff-${randomUUID()}`;
    return {
      effectId,
      effectType: intent.effectType,
      targetEnv: intent.targetEnv,
      canonicalPayloadHash: hash,
      idempotencyKey: intent.idempotencyKey,
      approvalRequired: policy.requiresExplicitApproval,
      humanSummary: policy.summary,
      redactedPayload: redacted,
    };
  }

  recordPlanned(intent: EffectIntent, autoApprove?: boolean): EffectRecord {
    assertNoRawSecretsInPayload(intent.payload);
    const existing = this.store.findByIdempotency(intent.idempotencyKey);
    const hash = canonicalPayloadHash(intent.payload);
    if (existing) {
      if (existing.canonicalPayloadHash !== hash) {
        throw new PayloadHashMismatchError(intent.idempotencyKey, existing.canonicalPayloadHash, hash);
      }
      if (existing.execStatus === "succeeded") {
        return existing;
      }
    }
    const approvalStatus = this.policy.initialApprovalStatus(intent.effectType, intent.targetEnv, autoApprove);
    const record: EffectRecord = {
      effectId: existing?.effectId ?? `eff-${randomUUID()}`,
      effectType: intent.effectType,
      targetEnv: intent.targetEnv,
      canonicalPayloadHash: hash,
      idempotencyKey: intent.idempotencyKey,
      writerEpoch: intent.writerEpoch,
      approvalStatus,
      boundApprovalPayloadHash: approvalStatus === "auto_allowed" ? hash : null,
      execStatus: "planned",
      payloadJson: redactEffectPayload(intent.payload),
      remoteReceiptJson: existing?.remoteReceiptJson ?? null,
      createdAt: existing?.createdAt ?? this.now(),
      dispatchedAt: null,
      finishedAt: null,
    };
    if (!existing) {
      this.store.insertPlanned(record);
    }
    return record;
  }

  approveEffect(effectId: string, boundPayloadHash: string): EffectRecord {
    const current = this.store.get(effectId);
    if (!current) {
      throw new Error(`effect ${effectId} not found`);
    }
    if (current.canonicalPayloadHash !== boundPayloadHash) {
      this.store.updateApproval(effectId, "approval_stale_payload_changed", boundPayloadHash);
      throw new Error("approval_stale_payload_changed");
    }
    this.store.updateApproval(effectId, "approved", boundPayloadHash);
    return this.store.get(effectId)!;
  }

  denyEffect(effectId: string): void {
    this.store.updateApproval(effectId, "denied", null);
  }

  replaySucceededReceipt(
    effectType: string,
    idempotencyKey: string,
    payload: unknown,
  ): unknown {
    const hash = canonicalPayloadHash(payload);
    const existing = this.store.findByIdempotency(idempotencyKey);
    if (!existing) {
      return null;
    }
    if (existing.effectType !== effectType) {
      throw new PayloadHashMismatchError(idempotencyKey, existing.canonicalPayloadHash, hash);
    }
    if (existing.canonicalPayloadHash !== hash) {
      throw new PayloadHashMismatchError(idempotencyKey, existing.canonicalPayloadHash, hash);
    }
    if (existing.execStatus === "succeeded") {
      return existing.remoteReceiptJson;
    }
    return null;
  }

  /**
   * Write-ahead dispatch: fences epoch, transitions to `sent`, then invokes the network executor.
   */
  async dispatchEffect<T>(
    effectId: string,
    writerEpoch: number,
    executor: () => Promise<T>,
    options?: { autoApprove?: boolean },
  ): Promise<T> {
    const record = this.store.get(effectId);
    if (!record) {
      throw new Error(`effect ${effectId} not found`);
    }
    this.policy.assertDispatchAllowed(record, options);
    this.fencing.assertDispatchAllowed(writerEpoch);
    const fence = new StoreFencePort(this.store).readFence();
    try {
      this.store.atomicDispatchTransition(effectId, writerEpoch, fence.state);
    } catch (error) {
      throw error;
    }
    try {
      this.networkCallCount += 1;
      const receipt = await executor();
      this.store.markSucceeded(effectId, receipt);
      return receipt;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ETIMEDOUT|ETIMEOUT|timeout|ECONNRESET/i.test(message)) {
        this.store.markUnknownOutcome(effectId);
      } else {
        this.store.markFailed(effectId, { error: message });
      }
      throw error;
    }
  }

  auditHistory(): EffectAuditEntry[] {
    return this.store.listAudit().map((row) => ({
      effectId: row.effectId,
      effectType: row.effectType,
      targetEnv: row.targetEnv,
      approvalStatus: row.approvalStatus,
      execStatus: row.execStatus,
      canonicalPayloadHash: row.canonicalPayloadHash,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
    }));
  }

  setRuntimeFence(writerEpoch: number, state: "RUNNING" | "STOPPED"): void {
    this.store.setRuntimeFence(writerEpoch, state);
  }
}