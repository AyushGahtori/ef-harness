import { BlindUnknownOutcomeRetryForbiddenError } from "./errors.js";
import type { EffectReconciler, EffectRecord, ReconcileOutcome } from "./types.js";
import type { SqliteEffectStore } from "./store.js";

export type ReconcileResolution =
  | { readonly action: "succeeded"; readonly receipt: unknown }
  | { readonly action: "safe_to_retry" }
  | { readonly action: "escalate"; readonly reason: string };

export class UnknownOutcomeReconciler {
  private readonly reconcilers = new Map<string, EffectReconciler>();

  constructor(
    private readonly store: SqliteEffectStore,
    private readonly onEscalate?: (effectId: string, reason: string) => void,
  ) {}

  register(effectType: string, reconciler: EffectReconciler): void {
    this.reconcilers.set(effectType, reconciler);
  }

  async reconcileUnknown(effectId: string): Promise<ReconcileResolution> {
    const record = this.store.get(effectId);
    if (!record) {
      throw new Error(`effect ${effectId} not found`);
    }
    if (record.execStatus !== "unknown_outcome" && record.execStatus !== "dispatched") {
      return { action: "safe_to_retry" };
    }
    const reconciler = this.reconcilers.get(record.effectType);
    if (!reconciler) {
      const reason = `No reconciler registered for ${record.effectType}`;
      this.onEscalate?.(effectId, reason);
      return { action: "escalate", reason };
    }
    const outcome = await reconciler({
      idempotencyKey: record.idempotencyKey,
      canonicalPayloadHash: record.canonicalPayloadHash,
      effectType: record.effectType,
      payload: record.payloadJson,
    });
    return this.applyOutcome(effectId, outcome);
  }

  assertRetryAllowed(effectId: string): void {
    const record = this.store.get(effectId);
    if (record?.execStatus === "unknown_outcome") {
      throw new BlindUnknownOutcomeRetryForbiddenError(effectId);
    }
  }

  private applyOutcome(effectId: string, outcome: ReconcileOutcome): ReconcileResolution {
    if (outcome.kind === "succeeded") {
      this.store.markSucceeded(effectId, outcome.receipt);
      return { action: "succeeded", receipt: outcome.receipt };
    }
    if (outcome.kind === "safe_to_retry") {
      return { action: "safe_to_retry" };
    }
    this.onEscalate?.(effectId, outcome.reason);
    return { action: "escalate", reason: outcome.reason };
  }
}

export function summarizeReconcileProbe(record: EffectRecord): string {
  return `reconcile ${record.effectType} key=${record.idempotencyKey}`;
}