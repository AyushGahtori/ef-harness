import { normalizeTopic, questionKey, sha256Text } from "./text.js";
import type {
  OwnerMailboxReceipt,
  OwnerMailboxSubmit,
  OwnerRef,
  SettledFact,
  SettledFactDraft,
} from "./types.js";
import type { QuestionQueueStore } from "./database.js";

export interface SettledDecisionPort {
  lookup(input: { readonly text: string; readonly scopeId?: string; readonly criterionId?: string }): SettledFact | null;
  register(draft: SettledFactDraft): SettledFact;
  registerEntityColumn(table: string, column: string): SettledFact;
}

export interface OwnerResolutionPort {
  ownerOf(contractId: string): OwnerRef | null;
}

export interface OwnerMailboxPort {
  submit(input: OwnerMailboxSubmit): OwnerMailboxReceipt;
}

export interface CriticalPathPort {
  isCritical(taskId: string): boolean;
  mark(taskId: string, critical: boolean): void;
}

export class SqliteSettledDecisionPort implements SettledDecisionPort {
  constructor(private readonly store: QuestionQueueStore) {}

  lookup(input: { readonly text: string; readonly scopeId?: string; readonly criterionId?: string }): SettledFact | null {
    return this.store.lookupFact(input);
  }

  register(draft: SettledFactDraft): SettledFact {
    return this.store.transaction(() => this.store.registerFact(this.complete(draft)));
  }

  registerEntityColumn(table: string, column: string): SettledFact {
    return this.register({
      text: `What column name does ${table} table use for ${column}?`,
      answer: `${table}.${column}`,
      source: "entity_schema",
      tableName: table,
      columnName: column,
      topicKey: `schema:${table}.${column}`,
    });
  }

  private complete(draft: SettledFactDraft): SettledFactDraft & { readonly topicKey: string; readonly normalizedText: string } {
    return {
      ...draft,
      topicKey: draft.topicKey ?? questionKey({ text: draft.text, scopeId: draft.scopeId, criterionId: draft.criterionId }),
      normalizedText: normalizeTopic(draft.text),
    };
  }
}

export class MemoryOwnerDirectory implements OwnerResolutionPort {
  private readonly owners = new Map<string, OwnerRef>();

  register(owner: { readonly contractId: string; readonly ownerRole: string; readonly ownerTaskId: string }): void {
    this.owners.set(owner.contractId, { ownerRole: owner.ownerRole, ownerTaskId: owner.ownerTaskId });
  }

  ownerOf(contractId: string): OwnerRef | null {
    return this.owners.get(contractId) ?? null;
  }
}

interface StoredMailboxMessage extends OwnerMailboxSubmit {
  readonly mailboxId: string;
  readonly questionHash: string;
  readonly status: "open";
}

export class MemoryRoleMailbox implements OwnerMailboxPort {
  readonly messages: StoredMailboxMessage[] = [];

  submit(input: OwnerMailboxSubmit): OwnerMailboxReceipt {
    const questionHash = sha256Text(`${input.contractId}\n${normalizeTopic(input.payload.question)}`);
    const existing = this.messages.find(
      (message) => message.contractId === input.contractId && message.questionHash === questionHash && message.status === "open",
    );
    if (existing) {
      return {
        mailboxId: existing.mailboxId,
        targetRole: existing.targetRole,
        targetOwnerTaskId: existing.targetOwnerTaskId,
        deduped: true,
      };
    }
    const mailboxId = `mb-${this.messages.length + 1}`;
    this.messages.push({ ...input, mailboxId, questionHash, status: "open" });
    return {
      mailboxId,
      targetRole: input.targetRole,
      targetOwnerTaskId: input.targetOwnerTaskId,
      deduped: false,
    };
  }
}

export class MemoryCriticalPath implements CriticalPathPort {
  private readonly tasks = new Set<string>();

  mark(taskId: string, critical: boolean): void {
    if (critical) this.tasks.add(taskId);
    else this.tasks.delete(taskId);
  }

  isCritical(taskId: string): boolean {
    return this.tasks.has(taskId);
  }
}
