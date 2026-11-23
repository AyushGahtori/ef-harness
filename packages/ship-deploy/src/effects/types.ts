export const TARGET_ENVS = ["preview", "staging", "production", "git_remote"] as const;
export type TargetEnv = (typeof TARGET_ENVS)[number];

export const EFFECT_EXEC_STATES = [
  "planned",
  "dispatched",
  "succeeded",
  "failed",
  "unknown_outcome",
] as const;
export type EffectExecStatus = (typeof EFFECT_EXEC_STATES)[number];

export const APPROVAL_STATUSES = [
  "pending_approval",
  "approved",
  "denied",
  "auto_allowed",
  "approval_stale_payload_changed",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Logical row mirrored from frozen `effects` plus decoded JSON sidecars. */
export interface EffectRecord {
  readonly effectId: string;
  readonly effectType: string;
  readonly targetEnv: TargetEnv;
  readonly canonicalPayloadHash: string;
  readonly idempotencyKey: string;
  readonly writerEpoch: number | null;
  readonly approvalStatus: ApprovalStatus;
  readonly boundApprovalPayloadHash: string | null;
  readonly execStatus: EffectExecStatus;
  readonly payloadJson: unknown;
  readonly remoteReceiptJson: unknown | null;
  readonly createdAt: number;
  readonly dispatchedAt: number | null;
  readonly finishedAt: number | null;
}

export interface EffectIntent {
  readonly effectType: string;
  readonly targetEnv: TargetEnv;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly writerEpoch: number;
}

export interface ProjectRuntimeFence {
  readonly writerEpoch: number;
  readonly state: "RUNNING" | "STOPPED";
}

export type ReconcileOutcome =
  | { readonly kind: "succeeded"; readonly receipt: unknown }
  | { readonly kind: "safe_to_retry" }
  | { readonly kind: "ambiguous"; readonly reason: string };

export type EffectReconciler = (input: {
  readonly idempotencyKey: string;
  readonly canonicalPayloadHash: string;
  readonly effectType: string;
  readonly payload: unknown;
}) => Promise<ReconcileOutcome> | ReconcileOutcome;

export interface ApprovalGrant {
  readonly effectId: string;
  readonly boundPayloadHash: string;
  readonly grantedAt: number;
  readonly allowCiRepairPushes?: boolean;
}

export interface EnvApprovalPolicyOptions {
  readonly previewAutoDeployOptIn?: boolean;
}

export interface EffectAuditEntry {
  readonly effectId: string;
  readonly effectType: string;
  readonly targetEnv: TargetEnv;
  readonly approvalStatus: ApprovalStatus;
  readonly execStatus: EffectExecStatus;
  readonly canonicalPayloadHash: string;
  readonly createdAt: number;
  readonly finishedAt: number | null;
}