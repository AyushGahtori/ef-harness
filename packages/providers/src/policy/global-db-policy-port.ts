import { GlobalBrokerDb } from "@ef-harness/db";
import { PolicyDocumentError } from "./errors.js";
import type { ConnectionRecord, PolicyHistoryRecord } from "./types.js";

/**
 * Policy history and connection reads on Task 014 `GlobalBrokerDb`.
 * The v2 migration owns `policy_history`. This port does not open its own `DatabaseSync`.
 */
export class GlobalDbPolicyPort {
  private readonly global: GlobalBrokerDb;
  private readonly owned: boolean;

  constructor(root: string, global?: GlobalBrokerDb) {
    if (global) {
      this.global = global;
      this.owned = false;
    } else {
      this.global = GlobalBrokerDb.open({ root });
      this.owned = true;
    }
  }

  insertHistory(row: PolicyHistoryRecord): void {
    const current = this.latestVersion();
    if (current !== null && row.policyVersion < current) {
      throw new PolicyDocumentError("rollback", "refusing to persist an older policy version");
    }
    this.global.writer.run(
      `INSERT INTO policy_history (policy_version, published_at, sha256, applied_at, diff_summary)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(policy_version) DO UPDATE SET
         published_at = excluded.published_at,
         sha256 = excluded.sha256,
         applied_at = excluded.applied_at,
         diff_summary = excluded.diff_summary`,
      [row.policyVersion, row.publishedAt, row.sha256, row.appliedAt, row.diffSummary],
    );
  }

  listHistory(): PolicyHistoryRecord[] {
    const rows = this.global.writer.all(
      `SELECT policy_version, published_at, sha256, applied_at, diff_summary
       FROM policy_history
       ORDER BY policy_version ASC`,
    );
    return rows.flatMap((row) => {
      const mapped = asRow(row);
      return mapped ? [mapHistory(mapped)] : [];
    });
  }

  latestVersion(): number | null {
    const row = asRow(
      this.global.writer.get("SELECT MAX(policy_version) AS policy_version FROM policy_history"),
    );
    if (!row) return null;
    const version = row.policy_version;
    if (typeof version === "number" && Number.isSafeInteger(version)) return version;
    if (typeof version === "bigint") return Number(version);
    return null;
  }

  listConnections(): ConnectionRecord[] {
    return this.global.listConnections().map((row) => ({
      id: row.id,
      provider: row.provider,
      route: row.route,
      currency: row.currency,
      enabled: row.enabled,
      billing: billingForCurrency(row.currency),
    }));
  }

  close(): void {
    if (!this.owned) return;
    this.global.close();
  }
}

function mapHistory(row: Record<string, unknown>): PolicyHistoryRecord {
  return {
    policyVersion: requiredInt(row, "policy_version"),
    publishedAt: requiredText(row, "published_at"),
    sha256: requiredText(row, "sha256"),
    appliedAt: requiredText(row, "applied_at"),
    diffSummary: requiredText(row, "diff_summary"),
  };
}

function asRow(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function requiredText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new PolicyDocumentError("malformed", `policy_history.${key} was not text`);
  return value;
}

function requiredInt(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new PolicyDocumentError("malformed", `policy_history.${key} was not an integer`);
}

function billingForCurrency(currency: string): ConnectionRecord["billing"] {
  if (currency.startsWith("allowance:")) return "plan";
  if (currency === "local_slots" || currency === "local") return "local";
  return "api_key";
}
