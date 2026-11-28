import { DatabaseSync } from "node:sqlite";
import { loadCanonicalSqlAsset } from "@ef-harness/db";
import { QuestionTransactionError } from "./errors.js";
import type { InterruptionTotals } from "./types.js";

export type InterruptionMetric = "owner_first_intercepted" | "duplicates_collapsed" | "human_interruption";

export class InterruptionAudit {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
  ) {
    const nodes = this.db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'nodes'").get();
    const telemetry = this.db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'telemetry'").get();
    if (nodes && !telemetry) {
      throw new QuestionTransactionError("Refusing to create telemetry inside state.db.");
    }
    if (!telemetry) this.db.exec(loadCanonicalSqlAsset("telemetrySql"));
  }

  record(buildId: string, metric: InterruptionMetric): void {
    this.db
      .prepare(`INSERT INTO telemetry(attempt, ts, kind, data) VALUES (?, ?, 'metric', ?)`)
      .run(buildId, this.now(), JSON.stringify({ metric, buildId, amount: 1 }));
  }

  totals(buildId: string): InterruptionTotals {
    const rows = this.db.prepare(`SELECT data FROM telemetry WHERE kind = 'metric' AND attempt = ?`).all(buildId) as {
      data?: unknown;
    }[];
    const totals = { intercepted: 0, duplicatesCollapsed: 0, humanInterruptions: 0 };
    for (const row of rows) {
      if (typeof row.data !== "string") continue;
      const parsed = JSON.parse(row.data) as { metric?: unknown; amount?: unknown };
      const amount = typeof parsed.amount === "number" ? parsed.amount : 0;
      if (parsed.metric === "owner_first_intercepted") totals.intercepted += amount;
      else if (parsed.metric === "duplicates_collapsed") totals.duplicatesCollapsed += amount;
      else if (parsed.metric === "human_interruption") totals.humanInterruptions += amount;
      else throw new QuestionTransactionError("Unknown interruption metric.");
    }
    return { buildId, ...totals };
  }
}
