import type { WaitGraphDeadlockBreak } from "./types.js";

export class SchemaValidationError extends Error {
  readonly code = "schema_invalid" as const;

  constructor(readonly detail: string) {
    super(detail);
    this.name = "SchemaValidationError";
  }
}

export class ImmutableHandoffError extends Error {
  readonly code = "immutable_handoff" as const;

  constructor(readonly handoffId: string) {
    super(`Handoff ${handoffId} is write-once and cannot be mutated.`);
    this.name = "ImmutableHandoffError";
  }
}

export class InvalidPinError extends Error {
  readonly code = "invalid_pin" as const;

  constructor(readonly field: "pinnedBaseCommitSha" | "pinnedSliceSha256") {
    super(`${field} is not a canonical pinned digest.`);
    this.name = "InvalidPinError";
  }
}

export class UnverifiedSliceError extends Error {
  readonly code = "unverified_slice" as const;

  constructor(readonly pinnedSliceSha256: string) {
    super(`Pinned slice ${pinnedSliceSha256} is not in the packet catalog.`);
    this.name = "UnverifiedSliceError";
  }
}

export class PinMismatchError extends Error {
  readonly code = "pin_mismatch" as const;

  constructor(readonly attemptId: string, readonly handoffId: string) {
    super(`Attempt ${attemptId} pins do not match handoff ${handoffId}.`);
    this.name = "PinMismatchError";
  }
}

export class CasBlobMissingError extends Error {
  readonly code = "cas_blob_missing" as const;

  constructor(readonly hash: string) {
    super(`CAS blob ${hash} is missing.`);
    this.name = "CasBlobMissingError";
  }
}

export class CasIntegrityError extends Error {
  readonly code = "cas_integrity" as const;

  constructor(readonly hash: string) {
    super(`CAS blob ${hash} does not match its content digest.`);
    this.name = "CasIntegrityError";
  }
}

export class RoleAddressError extends Error {
  readonly code = "role_address" as const;

  constructor(readonly role: string, readonly reason: "empty" | "pid") {
    super(
      reason === "pid"
        ? `Mailbox target ${role} is an ephemeral worker pid. Address a canonical role.`
        : "Mailbox target role is empty.",
    );
    this.name = "RoleAddressError";
  }
}

export class FreeFormChatRejectedError extends Error {
  readonly code = "NO_FREE_FORM_CHAT" as const;

  constructor() {
    super(
      "No free-form peer-chat tool exists. Only typed schema-validated mailbox and handoff artifacts are accepted.",
    );
    this.name = "FreeFormChatRejectedError";
  }
}

export class WaitGraphDeadlockError extends Error {
  readonly code = "wait_graph_deadlock" as const;

  constructor(readonly deadlock: WaitGraphDeadlockBreak) {
    super(
      `Wait edge ${deadlock.fromNode} -> ${deadlock.toNode} rejected; cycle ${deadlock.cycle.join(" -> ")}.`,
    );
    this.name = "WaitGraphDeadlockError";
  }
}

export class OwnerConflictError extends Error {
  readonly code = "owner_conflict" as const;

  constructor(readonly contractId: string, readonly existingOwnerTaskId: string) {
    super(`Contract ${contractId} already has canonical owner ${existingOwnerTaskId}.`);
    this.name = "OwnerConflictError";
  }
}

export class OwnerMissingError extends Error {
  readonly code = "owner_missing" as const;

  constructor(readonly contractId: string) {
    super(`Contract ${contractId} has no canonical owner.`);
    this.name = "OwnerMissingError";
  }
}

export class OutOfScopeWriteError extends Error {
  readonly code = "out_of_scope_write" as const;

  constructor(readonly path: string) {
    super(`Path ${path} is outside the caller's owned write scope.`);
    this.name = "OutOfScopeWriteError";
  }
}

export class MailboxStateError extends Error {
  readonly code = "mailbox_state" as const;

  constructor(readonly mailboxId: string, readonly status: string) {
    super(`Mailbox ${mailboxId} is ${status} and cannot accept that transition.`);
    this.name = "MailboxStateError";
  }
}

export class HandoffNotFoundError extends Error {
  readonly code = "handoff_missing" as const;

  constructor(readonly handoffId: string) {
    super(`Handoff ${handoffId} does not exist.`);
    this.name = "HandoffNotFoundError";
  }
}

export class RangeLimitError extends Error {
  readonly code = "RANGE_LIMIT_EXCEEDED" as const;

  constructor(readonly limit: number, readonly max: number) {
    super(`harness.read_result limit ${limit} exceeds ${max} bytes.`);
    this.name = "RangeLimitError";
  }
}
