import { DatabaseSync } from "node:sqlite";
import { PolicyDocumentError } from "./errors.js";
import type { ConnectionRecord, PolicyHistoryRecord } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS policy_history (
  policy_version INTEGER PRIMARY KEY,
  published_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  diff_summary TEXT NOT NULL
) STRICT;
`;

interface HistoryRow {
  policy_version: number;
  published_at: string;
  sha256: string;
  applied_at: string;
  diff_summary: string;
}

interface ConnectionRow {
  id: string;
  provider: string;
  route: string;
  currency: string;
  enabled: number;
}

/**
 * Local stand-in for GlobalDbRepo policy history until Task 014 owns the table.
 * The additive DDL is recorded in the task handoff for schema/global.sql.
 */
export class GlobalDbPolicyPort {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(SCHEMA);
  }

  insertHistory(row: PolicyHistoryRecord): void {
    const current = this.latestVersion();
    if (current !== null && row.policyVersion < current) {
      throw new PolicyDocumentError(
        "rollback",
        "refusing to persist an older policy version",
      );
    }
    this.db
      .prepare(
        `INSERT INTO policy_history (policy_version, published_at, sha256, applied_at, diff_summary)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(policy_version) DO UPDATE SET
           published_at = excluded.published_at,
           sha256 = excluded.sha256,
           applied_at = excluded.applied_at,
           diff_summary = excluded.diff_summary`,
      )
      .run(row.policyVersion, row.publishedAt, row.sha256, row.appliedAt, row.diffSummary);
  }

  listHistory(): PolicyHistoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT policy_version, published_at, sha256, applied_at, diff_summary
         FROM policy_history
         ORDER BY policy_version ASC`,
      )
      .all() as unknown as HistoryRow[];
    return rows.map((row) => ({
      policyVersion: row.policy_version,
      publishedAt: row.published_at,
      sha256: row.sha256,
      appliedAt: row.applied_at,
      diffSummary: row.diff_summary,
    }));
  }

  latestVersion(): number | null {
    const row = this.db
      .prepare("SELECT MAX(policy_version) AS policy_version FROM policy_history")
      .get() as { policy_version: number | null } | undefined;
    if (!row || row.policy_version === null) return null;
    return row.policy_version;
  }

  listConnections(): ConnectionRecord[] {
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connections'")
      .get() as { name: string } | undefined;
    if (!table) return [];
    const rows = this.db
      .prepare("SELECT id, provider, route, currency, enabled FROM connections")
      .all() as unknown as ConnectionRow[];
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      route: row.route,
      currency: row.currency,
      enabled: row.enabled === 1,
      billing: billingForCurrency(row.currency),
    }));
  }

  close(): void {
    this.db.close();
  }
}

function billingForCurrency(currency: string): ConnectionRecord["billing"] {
  if (currency.startsWith("allowance:")) return "plan";
  if (currency === "local_slots" || currency === "local") return "local";
  return "api_key";
}
