import { randomUUID } from "node:crypto";
import type { ApiCostLedgerEntry } from "./api-key-types.js";

/**
 * Local stand-in for Task 023 `BudgetLedger` / `BudgetLedgerRepo`.
 * Integration swaps this class for the kernel ledger and keeps the same record shape.
 */
export interface BudgetLedgerPort {
  record(entry: ApiCostLedgerEntry): void;
  listByConnection(connectionId: string): readonly ApiCostLedgerEntry[];
  listAll(): readonly ApiCostLedgerEntry[];
}

export class LocalBudgetLedger implements BudgetLedgerPort {
  private readonly entries: ApiCostLedgerEntry[] = [];

  record(entry: ApiCostLedgerEntry): void {
    this.entries.push(entry);
  }

  listByConnection(connectionId: string): readonly ApiCostLedgerEntry[] {
    return this.entries.filter((entry) => entry.connectionId === connectionId);
  }

  listAll(): readonly ApiCostLedgerEntry[] {
    return [...this.entries];
  }

  nextId(): string {
    return `cost-${randomUUID()}`;
  }
}
