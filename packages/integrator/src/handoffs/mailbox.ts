import {
  COORDINATOR_ROLE,
  DEFAULT_MAILBOX_TTL,
  MAILBOX_KINDS,
  OPTIONAL_MAILBOX_FIELDS,
  REQUIRED_MAILBOX_FIELDS,
  USER_INBOX_ROLE,
  type MailboxKind,
} from "./constants.js";
import { HandoffDatabase } from "./database.js";
import { MailboxStateError, SchemaValidationError, WaitGraphDeadlockError } from "./errors.js";
import { canonicalJson, isJsonObject, sha256Text, type JsonObject, type JsonValue } from "./json.js";
import { assertCanonicalRole, type TaskHoldsPort } from "./ports.js";
import type { EscalationNotice, MailboxMessage, MailboxSubmitInput, MailboxTtlPolicy, MailboxWake, RoleClaim } from "./types.js";
import { WaitGraphCycleDetector } from "./wait-graph.js";

export interface MailboxAcceptance {
  readonly message: MailboxMessage;
  readonly deduped: boolean;
}

const KIND_SET = new Set<string>(MAILBOX_KINDS);

export function questionHash(kind: MailboxKind, contractId: string, payload: JsonObject): string {
  const semantic: JsonObject = {};
  for (const key of Object.keys(payload).sort()) {
    if (key === "requestingTaskId") continue;
    const value = payload[key];
    if (value === undefined) continue;
    semantic[key] = value;
  }
  return sha256Text(canonicalJson({ kind, contractId, semantic }));
}

export function dedupKey(targetOwnerTaskId: string, contractId: string, hash: string): string {
  return `${targetOwnerTaskId}\u0000${contractId}\u0000${hash}`;
}

export class DurableRoleMailbox {
  constructor(
    private readonly db: HandoffDatabase,
    private readonly waitGraph: WaitGraphCycleDetector,
    private readonly holds: TaskHoldsPort,
    private readonly now: () => number,
    private readonly ttl: MailboxTtlPolicy = DEFAULT_MAILBOX_TTL,
  ) {}

  submit(input: MailboxSubmitInput): MailboxAcceptance {
    const validated = validateSubmission(input);
    const hash = questionHash(validated.kind, validated.contractId, validated.payload);
    const key = dedupKey(validated.targetOwnerTaskId, validated.contractId, hash);
    const outcome = this.db.transaction(() => {
      const existing = this.db.findOpenByDedup(key);
      if (existing) {
        if (existing.waiters.includes(validated.requestingTaskId)) return { kind: "accepted" as const, message: existing, deduped: true };
        const decision = this.waitGraph.commitWait(validated.requestingTaskId, validated.targetOwnerTaskId);
        if (!decision.accepted) return { kind: "deadlock" as const, decision };
        this.db.addWaiter(existing.mailboxId, validated.requestingTaskId, this.now());
        const refreshed = this.db.getMailbox(existing.mailboxId);
        if (!refreshed) throw new MailboxStateError(existing.mailboxId, "missing");
        return { kind: "accepted" as const, message: refreshed, deduped: true };
      }
      const decision = this.waitGraph.commitWait(validated.requestingTaskId, validated.targetOwnerTaskId);
      if (!decision.accepted) return { kind: "deadlock" as const, decision };
      const mailboxId = validated.mailboxId ?? this.db.nextId("MB-");
      const message: MailboxMessage = {
        mailboxId,
        kind: validated.kind,
        targetRole: validated.targetRole,
        targetOwnerTaskId: validated.targetOwnerTaskId,
        contractId: validated.contractId,
        questionHash: hash,
        payload: validated.payload,
        status: "open",
        resolution: null,
        createdAt: this.now(),
        resolvedAt: null,
        escalatedTo: null,
        ownerTurns: 0,
        waiters: [validated.requestingTaskId],
      };
      this.db.insertMailbox(message, key);
      this.db.addWaiter(mailboxId, validated.requestingTaskId, this.now());
      return { kind: "accepted" as const, message, deduped: false };
    });
    if (outcome.kind === "deadlock") {
      if (!outcome.decision.deadlock) throw new SchemaValidationError("deadlock break was not recorded");
      throw new WaitGraphDeadlockError(outcome.decision.deadlock);
    }
    return { message: outcome.message, deduped: outcome.deduped };
  }

  resolve(mailboxId: string, answer: JsonObject): readonly MailboxWake[] {
    if (!isJsonObject(answer)) throw new SchemaValidationError("resolution must be a JSON object.");
    return this.db.transaction(() => {
      const message = this.db.getMailbox(mailboxId);
      if (!message) throw new MailboxStateError(mailboxId, "missing");
      if (message.status !== "open") throw new MailboxStateError(mailboxId, message.status);
      const createdAt = this.now();
      this.db.markResolved(mailboxId, answer, createdAt);
      const wakes: MailboxWake[] = [];
      for (const waiterTaskId of message.waiters) {
        const wake: MailboxWake = {
          wakeId: this.db.nextId("WAKE-"),
          mailboxId,
          waiterTaskId,
          resolution: answer,
          createdAt,
        };
        this.db.insertMailboxWake(wake);
        wakes.push(wake);
      }
      return wakes;
    });
  }

  listOpen(targetRole: string): readonly MailboxMessage[] {
    assertCanonicalRole(targetRole);
    return this.db.listMailboxByRole(targetRole, "open");
  }

  claim(targetRole: string, workerId: string): RoleClaim {
    assertCanonicalRole(targetRole);
    assertCanonicalRole(workerId);
    return this.db.transaction(() => {
      const open = this.db.listMailboxByRole(targetRole, "open");
      const claimId = this.db.nextId("CL-");
      const createdAt = this.now();
      this.db.insertClaim(claimId, targetRole, workerId, createdAt);
      return {
        claimId,
        targetRole,
        workerId,
        mailboxIds: open.map((item) => item.mailboxId),
        createdAt,
      };
    });
  }

  recordOwnerTurn(ownerTaskId: string): void {
    assertNode(ownerTaskId);
    this.db.incrementOwnerTurns(ownerTaskId);
  }

  sweep(now = this.now()): readonly MailboxMessage[] {
    return this.db.transaction(() => {
      const escalated: MailboxMessage[] = [];
      for (const message of this.db.listOpenMailboxes()) {
        const blocked = this.holds.isHeld(message.targetOwnerTaskId);
        const aged = now - message.createdAt >= this.ttl.maxAgeMs;
        const turns = message.ownerTurns >= this.ttl.maxOwnerTurns;
        if (!blocked && !aged && !turns) continue;
        const reason = blocked ? "owner_blocked" : aged ? "ttl_expired" : "owner_turns_exhausted";
        this.escalate(message, reason, now);
        const refreshed = this.db.getMailbox(message.mailboxId);
        if (refreshed) escalated.push(refreshed);
      }
      return escalated;
    });
  }

  wakes(waiterTaskId: string | null = null): readonly MailboxWake[] {
    return this.db.listMailboxWakes(waiterTaskId);
  }

  notices(targetRole: string | null = null): readonly EscalationNotice[] {
    return this.db.listNotices(targetRole);
  }

  get(mailboxId: string): MailboxMessage | null {
    return this.db.getMailbox(mailboxId);
  }

  private escalate(message: MailboxMessage, reason: string, now: number): void {
    const targets = [COORDINATOR_ROLE, USER_INBOX_ROLE];
    this.db.markEscalated(message.mailboxId, targets.join(","), now);
    const payload: JsonObject = {
      mailboxId: message.mailboxId,
      kind: message.kind,
      contractId: message.contractId,
      questionHash: message.questionHash,
      reason,
      waiters: [...message.waiters],
      targetRole: message.targetRole,
      targetOwnerTaskId: message.targetOwnerTaskId,
    };
    for (const targetRole of targets) {
      this.db.insertNotice({
        noticeId: this.db.nextId("NT-"),
        targetRole,
        reason,
        payload,
        createdAt: now,
      });
    }
    for (const waiterTaskId of message.waiters) {
      this.db.insertMailboxWake({
        wakeId: this.db.nextId("WAKE-"),
        mailboxId: message.mailboxId,
        waiterTaskId,
        resolution: { status: "escalated", reason, escalatedTo: targets.join(",") },
        createdAt: now,
      });
    }
  }
}

function validateSubmission(input: MailboxSubmitInput): MailboxSubmitInput & { mailboxId?: string } {
  if (!KIND_SET.has(input.kind)) {
    throw new SchemaValidationError(`mailbox kind ${String(input.kind)} is not a typed request.`);
  }
  assertCanonicalRole(input.targetRole);
  assertNode(input.targetOwnerTaskId);
  assertNode(input.contractId);
  assertNode(input.requestingTaskId);
  if (input.mailboxId !== undefined) assertNode(input.mailboxId);
  if ("workerPid" in input || "workerPid" in input.payload) {
    throw new SchemaValidationError("mailbox requests cannot address a worker pid.");
  }
  const payload = validatePayload(input.kind, input.payload);
  if (input.kind === "ContractClarificationRequest" || input.kind === "SharedTypeAdditionRequest") {
    const contract = payload["contractId"];
    if (contract !== input.contractId) {
      throw new SchemaValidationError("payload contractId must match the mailbox contractId.");
    }
  }
  return {
    kind: input.kind,
    targetRole: input.targetRole,
    targetOwnerTaskId: input.targetOwnerTaskId,
    contractId: input.contractId,
    requestingTaskId: input.requestingTaskId,
    payload,
    ...(input.mailboxId === undefined ? {} : { mailboxId: input.mailboxId }),
  };
}

function validatePayload(kind: MailboxKind, value: unknown): JsonObject {
  if (!isJsonObject(value)) throw new SchemaValidationError("mailbox payload must be an object.");
  const required = REQUIRED_MAILBOX_FIELDS[kind];
  const optional = OPTIONAL_MAILBOX_FIELDS[kind];
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new SchemaValidationError(`unexpected mailbox field ${key}.`);
  }
  for (const key of required) {
    if (!(key in value)) throw new SchemaValidationError(`missing mailbox field ${key}.`);
  }
  const payload: JsonObject = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child === undefined) continue;
    payload[key] = validateField(kind, key, child);
  }
  return payload;
}

function validateField(kind: MailboxKind, key: string, value: JsonValue): JsonValue {
  if (key === "conflictPaths") {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new SchemaValidationError("conflictPaths must be a non-empty string list.");
    }
    return value;
  }
  if (key === "fields" || key === "proposedDelta" || key === "hunks") return value;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SchemaValidationError(`${kind}.${key} must be a non-empty string.`);
  }
  return value;
}

function assertNode(value: string): void {
  if (value.trim().length === 0 || /\s/.test(value) || /^\d+$/.test(value)) {
    throw new SchemaValidationError("mailbox identity must be a canonical id, not a pid.");
  }
}
