import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { BudgetLedgerRepo } from "./budget-ledger-repo.js";
import { ledgerSqlFromConnection } from "./sql-port.js";

/**
 * Bind the integer budget ledger to the open `ProjectStateDb` writer.
 * The returned repo does not close that handle.
 */
export function bindBudgetLedger(stateDb: ProjectStateDb): BudgetLedgerRepo {
  return new BudgetLedgerRepo(ledgerSqlFromConnection(stateDb.writer));
}
