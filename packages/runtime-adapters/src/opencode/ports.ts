import type { JobTerminateResult, WindowsJobObjectPort } from "./job-object.js";
import { InMemoryWindowsJobObject } from "./job-object.js";
import type { NormalizedUsageReceipt } from "./types.js";

export interface SandboxSelection {
  readonly tier: "A" | "B" | "C" | "D";
  readonly hold: boolean;
  readonly reason: string;
}

export interface SandboxTierSelectorPort {
  select(input: { readonly taskId: string; readonly mode: "wrapped" | "stripped" }): SandboxSelection;
}

export class InMemorySandboxSelector implements SandboxTierSelectorPort {
  constructor(private readonly selection: SandboxSelection = { tier: "A", hold: false, reason: "tier-a" }) {}

  select(): SandboxSelection {
    return this.selection;
  }
}

export interface PacingDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface AllowancePacingPort {
  mayStartTurn(connectionId: string): PacingDecision;
}

export class AllowAllPacing implements AllowancePacingPort {
  mayStartTurn(): PacingDecision {
    return { allowed: true, reason: "ok" };
  }
}

export class DenyPacing implements AllowancePacingPort {
  constructor(private readonly reason: string) {}

  mayStartTurn(): PacingDecision {
    return { allowed: false, reason: this.reason };
  }
}

export interface BudgetLedgerPort {
  record(entry: NormalizedUsageReceipt): void;
}

export class InMemoryBudgetLedger implements BudgetLedgerPort {
  readonly entries: NormalizedUsageReceipt[] = [];

  record(entry: NormalizedUsageReceipt): void {
    this.entries.push(entry);
  }
}

export interface AttemptCheckpointRecord {
  readonly attemptId: string;
  readonly adapterId: "opencode";
  readonly adapterVersion: string;
  readonly nativeSessionId: string;
  readonly pinnedBaseCommitSha: string;
  readonly mustChecklist: readonly string[];
  readonly writeScope: readonly string[];
  readonly lastStepSummary: string;
}

export interface AttemptCheckpointStorePort {
  save(record: AttemptCheckpointRecord): void;
  get(attemptId: string): AttemptCheckpointRecord | null;
}

export class InMemoryCheckpointStore implements AttemptCheckpointStorePort {
  private readonly records = new Map<string, AttemptCheckpointRecord>();

  save(record: AttemptCheckpointRecord): void {
    this.records.set(record.attemptId, record);
  }

  get(attemptId: string): AttemptCheckpointRecord | null {
    return this.records.get(attemptId) ?? null;
  }
}

export interface SteeringClassifierPort {
  classify(note: string): "additive" | "contradictory";
}

export class PrefixSteeringClassifier implements SteeringClassifierPort {
  classify(note: string): "additive" | "contradictory" {
    return note.startsWith("CONTRADICTION:") ? "contradictory" : "additive";
  }
}

export type { JobTerminateResult, WindowsJobObjectPort };
export { InMemoryWindowsJobObject };
