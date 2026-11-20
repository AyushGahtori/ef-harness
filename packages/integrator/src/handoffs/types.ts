import type { ArtifactType, MailboxKind } from "./constants.js";
import type { JsonObject, JsonValue } from "./json.js";

export interface HandoffArtifact {
  readonly handoffId: string;
  readonly fromRole: string;
  readonly toRole: string;
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly artifactType: ArtifactType;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly schemaVersion: number;
  readonly summary: JsonObject;
  readonly blobSha256: string;
  readonly blobBytes: number;
  readonly priorHandoffId: string | null;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly createdAt: number;
}

export interface PutHandoffInput {
  readonly handoffId: string;
  readonly fromRole: string;
  readonly toRole: string;
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly artifactType: ArtifactType;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly schemaVersion: number;
  readonly summary: JsonObject;
  readonly payload: Uint8Array;
  readonly priorHandoffId?: string;
}

export interface SupersedeHandoffInput {
  readonly handoffId: string;
  readonly fromRole: string;
  readonly toRole: string;
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly artifactType: ArtifactType;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly schemaVersion: number;
  readonly summary: JsonObject;
  readonly payload: Uint8Array;
}

export interface ActiveAttempt {
  readonly attemptId: string;
  readonly taskId: string;
  readonly role: string;
  readonly workerId: string;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly boundHandoffId: string;
  readonly createdAt: number;
}

export interface BindAttemptInput {
  readonly attemptId: string;
  readonly taskId: string;
  readonly role: string;
  readonly workerId: string;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly handoffId: string;
}

export interface HandoffWake {
  readonly wakeId: string;
  readonly taskId: string;
  readonly previousHandoffId: string;
  readonly freshHandoffId: string;
  readonly freshPinnedBaseCommitSha: string;
  readonly freshPinnedSliceSha256: string;
  readonly createdAt: number;
}

export type EscalationTarget = "coordinator" | "contract_owner" | "developer";

export interface WaitGraphDeadlockBreak {
  readonly breakId: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly cycle: readonly string[];
  readonly escalatedTo: EscalationTarget;
  readonly notifiedRoles: readonly string[];
  readonly createdAt: number;
}

export interface GraphEdge {
  readonly kind: "depends_on" | "waits_on";
  readonly fromNode: string;
  readonly toNode: string;
}

export interface WaitDecision {
  readonly accepted: boolean;
  readonly cycle: readonly string[] | null;
  readonly deadlock: WaitGraphDeadlockBreak | null;
}

export interface MailboxMessage {
  readonly mailboxId: string;
  readonly kind: MailboxKind;
  readonly targetRole: string;
  readonly targetOwnerTaskId: string;
  readonly contractId: string;
  readonly questionHash: string;
  readonly payload: JsonObject;
  readonly status: "open" | "resolved" | "escalated";
  readonly resolution: JsonObject | null;
  readonly createdAt: number;
  readonly resolvedAt: number | null;
  readonly escalatedTo: string | null;
  readonly ownerTurns: number;
  readonly waiters: readonly string[];
}

export interface MailboxSubmitInput {
  readonly kind: MailboxKind;
  readonly targetRole: string;
  readonly targetOwnerTaskId: string;
  readonly contractId: string;
  readonly requestingTaskId: string;
  readonly payload: JsonObject;
  readonly mailboxId?: string;
}

export interface MailboxWake {
  readonly wakeId: string;
  readonly mailboxId: string;
  readonly waiterTaskId: string;
  readonly resolution: JsonObject;
  readonly createdAt: number;
}

export interface EscalationNotice {
  readonly noticeId: string;
  readonly targetRole: string;
  readonly reason: string;
  readonly payload: JsonObject;
  readonly createdAt: number;
}

export interface MailboxTtlPolicy {
  readonly maxAgeMs: number;
  readonly maxOwnerTurns: number;
}

export interface ContractOwner {
  readonly contractId: string;
  readonly ownerRole: string;
  readonly ownerTaskId: string;
}

export interface OwnerRoute {
  readonly mailbox: MailboxMessage;
  readonly targetRole: string;
  readonly targetOwnerTaskId: string;
  readonly deduped: boolean;
  readonly peerMessages: readonly never[];
}

export interface ReadResultCaller {
  readonly taskId: string;
  readonly role: string;
}

export interface ReadResultRange {
  readonly offset: number;
  readonly limit: number;
}

export interface ReadResultManifest {
  readonly handoffId: string;
  readonly artifactType: ArtifactType;
  readonly pinnedBaseCommitSha: string;
  readonly pinnedSliceSha256: string;
  readonly schemaVersion: number;
  readonly blobSha256: string;
  readonly blobBytes: number;
  readonly supersededBy: string | null;
  readonly supersedes: string | null;
}

export interface ReadResultSummary {
  readonly ok: true;
  readonly mode: "summary";
  readonly manifest: ReadResultManifest;
  readonly summary: JsonValue;
  readonly summaryBytes: number;
  readonly truncated: boolean;
}

export interface ReadResultPage {
  readonly ok: true;
  readonly mode: "range";
  readonly manifest: ReadResultManifest;
  readonly offset: number;
  readonly limit: number;
  readonly returned: number;
  readonly bytes: Uint8Array;
}

export interface ReadResultMiss {
  readonly ok: false;
  readonly code: "NOT_FOUND";
}

export type ReadResult = ReadResultSummary | ReadResultPage | ReadResultMiss;

export interface HandoffLineage {
  readonly artifacts: readonly HandoffArtifact[];
  readonly roles: readonly string[];
}

export interface RoleClaim {
  readonly claimId: string;
  readonly targetRole: string;
  readonly workerId: string;
  readonly mailboxIds: readonly string[];
  readonly createdAt: number;
}
