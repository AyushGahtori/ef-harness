import { DatabaseSync } from "node:sqlite";
import { BudgetLedgerRepo, openLedgerDatabase } from "../../src/ledger/index.js";

export function createTestLedger(): { db: DatabaseSync; repo: BudgetLedgerRepo } {
  const db = openLedgerDatabase();
  const repo = new BudgetLedgerRepo(db);
  repo.registerCurrency("usd");
  return { db, repo };
}

export function microUsd(dollars: number): number {
  return dollars * 1_000_000;
}
