import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openColdOpenReconciler } from "@ef-harness/steering";
import type { ColdOpenReconcilerPort, WakeReconcileResult } from "./ports.js";

export function bindColdOpenReconciler(stateDbPath: string): ColdOpenReconcilerPort {
  return {
    reconcile(input): WakeReconcileResult {
      const location = existsSync(stateDbPath) ? stateDbPath : ":memory:";
      const db = new DatabaseSync(location, location === ":memory:" ? {} : { readOnly: true });
      try {
        if (location === ":memory:") {
          db.exec(
            "CREATE TABLE inbox_items (id TEXT, subject TEXT, payload TEXT, created_at INTEGER, status TEXT)",
          );
        }
        const report = openColdOpenReconciler(db).reconcile(input);
        return {
          showWelcome: report.showWelcome,
          wakeNote: report.wakeNote,
          tokensSpent: report.tokensSpent,
        };
      } finally {
        db.close();
      }
    },
  };
}
