import {
  EXPAND_SPLIT_GUIDANCE,
  LOCK_HAZARD_GUIDANCE,
  type ClassifiedStatement,
  type DdlClassification,
  type DdlSafetyClass,
  type SchemaObjectRef,
  type SqlDialect,
} from "./types.js";
import {
  hasNotNull,
  isConstantDefault,
  normalizeWhitespace,
  readIdent,
  splitSqlStatements,
} from "./sql-text.js";
import { DestructiveDdlInExpandError } from "./errors.js";

interface AlterAction {
  safety: DdlSafetyClass;
  reason: string;
  column?: string;
  guidance?: string;
  rewrittenSql?: string;
  rewriteSteps?: readonly string[];
}

export class DdlSafetyClassifier {
  constructor(readonly dialect: SqlDialect) {}

  classify(sql: string): DdlClassification {
    const statements = splitSqlStatements(sql).map((statement) => this.classifyStatement(statement));
    const expandSql = statements.filter((statement) => statement.safety === "SAFE_ADDITIVE").map((statement) => statement.sql);
    const lockHazards = statements.filter((statement) => statement.safety === "LOCK_HAZARD");
    const contractStatements = statements.filter((statement) => statement.safety === "DESTRUCTIVE_CONTRACT");
    const mixedDestructiveIntoExpand = contractStatements.length > 0 && expandSql.length > 0;
    const contractObjects: SchemaObjectRef[] = [];
    for (const statement of contractStatements) {
      if (!statement.table) continue;
      const objectRef: SchemaObjectRef = statement.column
        ? { table: statement.table, column: statement.column }
        : { table: statement.table };
      contractObjects.push(objectRef);
    }
    return {
      dialect: this.dialect,
      statements,
      expandSql,
      lockHazards,
      contractSql: contractStatements.map((statement) => statement.sql),
      contractObjects,
      mixedDestructiveIntoExpand,
      splitGuidance: mixedDestructiveIntoExpand ? EXPAND_SPLIT_GUIDANCE : null,
    };
  }

  assertExpandOnly(sql: string): readonly ClassifiedStatement[] {
    const classification = this.classify(sql);
    if (classification.contractSql.length > 0 || classification.mixedDestructiveIntoExpand) {
      throw new DestructiveDdlInExpandError(
        `${EXPAND_SPLIT_GUIDANCE} Forbidden in Phase 3: ${classification.contractSql.join(" ")}`,
      );
    }
    if (classification.lockHazards.length > 0) {
      const first = classification.lockHazards[0];
      throw new DestructiveDdlInExpandError(
        `Phase 3 Expand accepts only SAFE_ADDITIVE DDL. ${first?.reason ?? "Lock hazard"} ${first?.guidance ?? LOCK_HAZARD_GUIDANCE}`,
      );
    }
    return classification.statements;
  }

  private classifyStatement(sql: string): ClassifiedStatement {
    const compact = normalizeWhitespace(sql);
    const upper = compact.toUpperCase();

    if (/^(DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\b/.test(upper)) {
      return destructive(sql, "DELETE/TRUNCATE is a destructive contract step", tableFrom(compact));
    }
    if (/^DROP\s+TABLE\b/.test(upper)) {
      const table = identAfter(compact, /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?/i);
      return destructive(sql, "DROP TABLE is forbidden during Expand", table);
    }
    if (/^DROP\s+(COLUMN|INDEX|VIEW|TRIGGER|SCHEMA|TYPE)\b/.test(upper)) {
      return destructive(sql, "DROP is forbidden during Expand");
    }
    if (/^CREATE\s+TABLE\b/.test(upper)) {
      return additive(sql, "CREATE TABLE is expand-eligible");
    }
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/.test(upper)) {
      return additive(sql, "CREATE VIEW is expand-eligible");
    }
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/.test(upper)) {
      return additive(sql, "CREATE TRIGGER is expand-eligible");
    }
    if (/^ALTER\s+TYPE\b/.test(upper) && /\bADD\s+VALUE\b/i.test(compact)) {
      return additive(sql, "Adding an enum value is expand-eligible");
    }
    if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/.test(upper)) {
      return this.classifyIndex(sql, compact);
    }
    if (/^ALTER\s+TABLE\b/.test(upper)) {
      return this.classifyAlter(sql, compact);
    }
    return {
      sql,
      safety: "LOCK_HAZARD",
      reason: "Unrecognized DDL is treated as a lock hazard and blocked from Expand",
      expandForbidden: true,
      guidance: LOCK_HAZARD_GUIDANCE,
    };
  }

  private classifyIndex(sql: string, compact: string): ClassifiedStatement {
    const concurrent = /\bINDEX\s+CONCURRENTLY\b/i.test(compact);
    if (concurrent || this.dialect === "sqlite") {
      return additive(
        sql,
        concurrent
          ? "CREATE INDEX CONCURRENTLY is expand-eligible"
          : "SQLite CREATE INDEX has no CONCURRENTLY form and is expand-eligible",
      );
    }
    const rewrittenSql = compact.replace(/\bINDEX\b/i, "INDEX CONCURRENTLY");
    return {
      sql,
      safety: "LOCK_HAZARD",
      reason: "CREATE INDEX without CONCURRENTLY takes a blocking lock on Postgres",
      expandForbidden: true,
      guidance: `${LOCK_HAZARD_GUIDANCE} Rewrite to CREATE INDEX CONCURRENTLY.`,
      rewrittenSql,
    };
  }

  private classifyAlter(sql: string, compact: string): ClassifiedStatement {
    const parsed = readIdent(compact.replace(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?/i, ""));
    const table = parsed?.name;
    const body = parsed?.rest ?? compact;
    if (/\bRENAME\s+(COLUMN|TO)\b/i.test(body) || /\bRENAME\s+COLUMN\b/i.test(body)) {
      const column = columnAfter(body, /\bRENAME\s+COLUMN\s+/i);
      return destructive(sql, "RENAME is forbidden during Expand", table, column);
    }
    if (/\bDROP\s+COLUMN\b/i.test(body) || /\bDROP\s+CONSTRAINT\b/i.test(body)) {
      const column = columnAfter(body, /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?/i);
      return destructive(sql, "DROP COLUMN is a Phase 6 contract step", table, column);
    }

    const actions: AlterAction[] = [];
    if (/\bALTER\s+(?:COLUMN\s+)?(?:"?[A-Za-z_][A-Za-z0-9_]*"?)\s+(?:SET\s+DATA\s+)?TYPE\b/i.test(body)) {
      const column = columnAfter(body, /\bALTER\s+(?:COLUMN\s+)?/i);
      actions.push({
        safety: "LOCK_HAZARD",
        reason: "ALTER COLUMN TYPE rewrites the table under ACCESS EXCLUSIVE",
        ...(column ? { column } : {}),
        guidance: `${LOCK_HAZARD_GUIDANCE} Add a new column, backfill, then contract the old column.`,
      });
    }
    if (/\bSET\s+NOT\s+NULL\b/i.test(body)) {
      const column = columnAfter(body, /\bALTER\s+(?:COLUMN\s+)?/i);
      actions.push({
        safety: "LOCK_HAZARD",
        reason: "SET NOT NULL is a narrowing alter and a lock hazard",
        ...(column ? { column } : {}),
        guidance: `${LOCK_HAZARD_GUIDANCE} Add CHECK (${column ?? "col"} IS NOT NULL) NOT VALID, then VALIDATE CONSTRAINT.`,
        rewriteSteps: [
          `ALTER TABLE ${table ?? "table"} ADD CONSTRAINT ${(table ?? "table")}_${column ?? "col"}_not_null CHECK (${column ?? "col"} IS NOT NULL) NOT VALID`,
          `ALTER TABLE ${table ?? "table"} VALIDATE CONSTRAINT ${(table ?? "table")}_${column ?? "col"}_not_null`,
        ],
      });
    }
    for (const added of addedColumns(body)) {
      actions.push(classifyAddedColumn(table, added.name, added.clause));
    }

    if (actions.length === 0) {
      return {
        sql,
        safety: "LOCK_HAZARD",
        reason: "Unrecognized ALTER TABLE is blocked from Expand",
        expandForbidden: true,
        ...(table ? { table } : {}),
        guidance: LOCK_HAZARD_GUIDANCE,
      };
    }
    const worst = worstAction(actions);
    const column = worst.column;
    return {
      sql,
      safety: worst.safety,
      reason: worst.reason,
      expandForbidden: worst.safety !== "SAFE_ADDITIVE",
      ...(table ? { table } : {}),
      ...(column ? { column } : {}),
      ...(worst.guidance ? { guidance: worst.guidance } : {}),
      ...(worst.rewrittenSql ? { rewrittenSql: worst.rewrittenSql } : {}),
      ...(worst.rewriteSteps ? { rewriteSteps: worst.rewriteSteps } : {}),
    };
  }
}

function classifyAddedColumn(table: string | undefined, column: string, clause: string): AlterAction {
  const notNull = hasNotNull(clause);
  const constantDefault = isConstantDefault(clause);
  if (!notNull || constantDefault) {
    return {
      safety: "SAFE_ADDITIVE",
      reason: notNull
        ? "ADD COLUMN NOT NULL with a constant default is metadata-only and expand-eligible"
        : "ADD COLUMN NULL is expand-eligible",
      column,
    };
  }
  const type = clause.replace(/\bNOT\s+NULL\b/i, "").trim() || "TEXT";
  return {
    safety: "LOCK_HAZARD",
    reason: "ADD COLUMN NOT NULL without a default rewrites a populated table and breaks App N-1",
    column,
    guidance: `${LOCK_HAZARD_GUIDANCE} Add the column nullable, backfill, then add a NOT VALID check.`,
    rewrittenSql: `ALTER TABLE ${table ?? "table"} ADD COLUMN ${column} ${type} NULL`,
    rewriteSteps: [
      `ALTER TABLE ${table ?? "table"} ADD COLUMN ${column} ${type} NULL`,
      `Backfill ${table ?? "table"}.${column} with keyset batches`,
      `ALTER TABLE ${table ?? "table"} ADD CONSTRAINT ${(table ?? "table")}_${column}_not_null CHECK (${column} IS NOT NULL) NOT VALID`,
      `ALTER TABLE ${table ?? "table"} VALIDATE CONSTRAINT ${(table ?? "table")}_${column}_not_null`,
    ],
  };
}

function addedColumns(body: string): { name: string; clause: string }[] {
  const found: { name: string; clause: string }[] = [];
  const matcher = /\bADD\s+(?:COLUMN\s+)?/gi;
  for (const match of body.matchAll(matcher)) {
    const start = (match.index ?? 0) + match[0].length;
    const parsed = readIdent(body.slice(start));
    if (!parsed) continue;
    const clause = parsed.rest.split(/,(?![^(]*\))/)[0]?.trim() ?? "";
    found.push({ name: parsed.name, clause });
  }
  return found;
}

function worstAction(actions: readonly AlterAction[]): AlterAction {
  const rank: Record<DdlSafetyClass, number> = {
    DESTRUCTIVE_CONTRACT: 3,
    LOCK_HAZARD: 2,
    SAFE_ADDITIVE: 1,
  };
  let worst = actions[0];
  if (!worst) {
    return { safety: "LOCK_HAZARD", reason: "empty ALTER", guidance: LOCK_HAZARD_GUIDANCE };
  }
  for (const action of actions) {
    if (rank[action.safety] > rank[worst.safety]) worst = action;
  }
  return worst;
}

function additive(sql: string, reason: string): ClassifiedStatement {
  return { sql, safety: "SAFE_ADDITIVE", reason, expandForbidden: false };
}

function destructive(
  sql: string,
  reason: string,
  table?: string,
  column?: string,
): ClassifiedStatement {
  return {
    sql,
    safety: "DESTRUCTIVE_CONTRACT",
    reason,
    expandForbidden: true,
    ...(table ? { table } : {}),
    ...(column ? { column } : {}),
    guidance: EXPAND_SPLIT_GUIDANCE,
  };
}

function tableFrom(sql: string): string | undefined {
  return identAfter(sql, /^(?:DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+/i);
}

function identAfter(sql: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(sql);
  if (!match) return undefined;
  return readIdent(sql.slice(match[0].length))?.name;
}

function columnAfter(sql: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(sql);
  if (!match) return undefined;
  return readIdent(sql.slice(match.index + match[0].length))?.name;
}
