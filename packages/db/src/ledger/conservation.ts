import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { loadCanonicalQueries } from "./canonical-queries.js";
import { cell, readText, readUnits } from "./sql-values.js";

export interface ConservationMismatch {
  scopeKind: string;
  scopeId: string;
  currency: string;
  field: "reserved_units" | "spent_units";
  actual: number;
  expected: number;
}

export type ConservationAudit =
  | { ok: true }
  | { ok: false; mismatches: readonly ConservationMismatch[] };

const AUDIT_SQL = `
SELECT b.scope_kind, b.scope_id, b.currency, b.reserved_units, b.spent_units,
       (
         SELECT coalesce(sum(r.amount_units), 0)
           FROM reservation_scopes s
           JOIN reservations r ON r.id = s.reservation
          WHERE s.scope_kind = b.scope_kind
            AND s.scope_id = b.scope_id
            AND s.currency = b.currency
            AND r.state IN ('held', 'unknown')
       ) AS open_units,
       (
         SELECT coalesce(sum(r.actual_units), 0)
           FROM reservation_scopes s
           JOIN reservations r ON r.id = s.reservation
          WHERE s.scope_kind = b.scope_kind
            AND s.scope_id = b.scope_id
            AND s.currency = b.currency
            AND r.state = 'settled'
       ) AS settled_units
  FROM budgets b
`;

export function auditLedgerConservation(db: DatabaseSync): ConservationAudit {
  const mismatches: ConservationMismatch[] = [];
  for (const row of db.prepare(AUDIT_SQL).all() as Record<string, SQLOutputValue>[]) {
    const scopeKind = readText(cell(row, "scope_kind"), "scope_kind");
    const scopeId = readText(cell(row, "scope_id"), "scope_id");
    const currency = readText(cell(row, "currency"), "currency");
    const reservedUnits = readUnits(cell(row, "reserved_units"), "reserved_units");
    const spentUnits = readUnits(cell(row, "spent_units"), "spent_units");
    const openUnits = readUnits(cell(row, "open_units"), "open_units");
    const settledUnits = readUnits(cell(row, "settled_units"), "settled_units");
    if (reservedUnits !== openUnits) {
      mismatches.push({
        scopeKind,
        scopeId,
        currency,
        field: "reserved_units",
        actual: reservedUnits,
        expected: openUnits,
      });
    }
    if (spentUnits !== settledUnits) {
      mismatches.push({
        scopeKind,
        scopeId,
        currency,
        field: "spent_units",
        actual: spentUnits,
        expected: settledUnits,
      });
    }
  }
  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}

export function loadStateSchema(): string {
  return loadCanonicalQueries().stateSchema;
}
