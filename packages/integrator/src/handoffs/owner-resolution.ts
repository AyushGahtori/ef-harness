import type { MailboxKind } from "./constants.js";
import { HandoffDatabase } from "./database.js";
import { OwnerConflictError, OwnerMissingError, OutOfScopeWriteError, SchemaValidationError } from "./errors.js";
import type { JsonObject } from "./json.js";
import { DurableRoleMailbox } from "./mailbox.js";
import { assertCanonicalRole } from "./ports.js";
import type { ContractOwner, OwnerRoute } from "./types.js";

export function assertOwnedWrite(path: string, ownedPatterns: readonly string[]): void {
  const normalized = path.replaceAll("\\", "/");
  const allowed = ownedPatterns.some((pattern) => matches(normalized, pattern));
  if (!allowed) throw new OutOfScopeWriteError(normalized);
}

function matches(file: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  return file === pattern;
}

export class OwnerResolutionCoordinator {
  constructor(
    private readonly db: HandoffDatabase,
    private readonly mailbox: DurableRoleMailbox,
    private readonly now: () => number,
  ) {}

  registerOwner(owner: ContractOwner): ContractOwner {
    assertCanonicalRole(owner.ownerRole);
    assertToken(owner.contractId);
    assertToken(owner.ownerTaskId);
    const existing = this.db.getOwner(owner.contractId);
    if (existing) {
      if (existing.ownerTaskId !== owner.ownerTaskId || existing.ownerRole !== owner.ownerRole) {
        throw new OwnerConflictError(owner.contractId, existing.ownerTaskId);
      }
      return existing;
    }
    this.db.insertOwner(owner, this.now());
    return owner;
  }

  ownerOf(contractId: string): ContractOwner | null {
    return this.db.getOwner(contractId);
  }

  request(input: {
    readonly requestingTaskId: string;
    readonly requestingRole: string;
    readonly contractId: string;
    readonly kind: MailboxKind;
    readonly payload: JsonObject;
    readonly mailboxId?: string;
  }): OwnerRoute {
    assertCanonicalRole(input.requestingRole);
    const owner = this.db.getOwner(input.contractId);
    if (!owner) throw new OwnerMissingError(input.contractId);
    const accepted = this.mailbox.submit({
      kind: input.kind,
      targetRole: owner.ownerRole,
      targetOwnerTaskId: owner.ownerTaskId,
      contractId: input.contractId,
      requestingTaskId: input.requestingTaskId,
      payload: input.payload,
      ...(input.mailboxId === undefined ? {} : { mailboxId: input.mailboxId }),
    });
    if (
      accepted.message.targetRole !== owner.ownerRole ||
      accepted.message.targetOwnerTaskId !== owner.ownerTaskId
    ) {
      throw new OwnerConflictError(input.contractId, accepted.message.targetOwnerTaskId);
    }
    return {
      mailbox: accepted.message,
      targetRole: owner.ownerRole,
      targetOwnerTaskId: owner.ownerTaskId,
      deduped: accepted.deduped,
      peerMessages: [],
    };
  }

  seed(owners: readonly ContractOwner[]): void {
    for (const owner of owners) this.registerOwner(owner);
  }
}

function assertToken(value: string): void {
  if (value.trim().length === 0 || /\s/.test(value) || /^\d+$/.test(value)) {
    throw new SchemaValidationError("contract identity must be a canonical id.");
  }
}
