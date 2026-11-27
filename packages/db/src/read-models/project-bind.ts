import type { SqliteConnection, SqliteStatement } from "../driver/types.js";
import type { SqlParams, SqlValue as DriverSqlValue } from "../driver/values.js";
import type { ProjectStateDb } from "../state-db/project-state-db.js";
import { RollupWriteForbiddenError } from "./errors.js";
import { ReadModelRepo, type ReadModelOptions } from "./repo.js";
import type { ReadModelDatabase, ReadModelStatement } from "./sql.js";
import type { SqlRow, SqlValue } from "./values.js";

const ROLLUP_WRITE =
  /\b(?:insert\s+(?:or\s+\w+\s+)?into|update|delete\s+from|replace\s+into)\s+["`[]?(rollup_feature_tasks|rollup_feature_requirements)\b/i;

/**
 * Bind board, feature rollup, and drift reads to the open `ProjectStateDb` writer.
 * The returned repo does not close that handle. `close()` is a no-op on the shared writer.
 * Rollup repairs run through `withRollupRebuild` on that same writer. A second authorizer is not
 * installed, so the driver's `ATTACH` denial stays in place.
 */
export function bindReadModels(stateDb: ProjectStateDb, options: ReadModelOptions = {}): ReadModelRepo {
  return new ReadModelRepo(readModelDatabaseFromDriver(stateDb.writer), options);
}

function readModelDatabaseFromDriver(writer: SqliteConnection): ReadModelDatabase {
  let healDepth = 0;
  return {
    get isTransaction() {
      return writer.inTransaction;
    },
    exec(sql: string): void {
      assertApplicationRollupWrite(sql, healDepth);
      writer.exec(sql);
    },
    prepare(sql: string): ReadModelStatement {
      assertApplicationRollupWrite(sql, healDepth);
      return new DriverStatement(writer.prepare(sql));
    },
    close(): void {
      return;
    },
    withRollupRebuild<T>(work: () => T): T {
      healDepth += 1;
      try {
        return work();
      } finally {
        healDepth -= 1;
      }
    },
  };
}

class DriverStatement implements ReadModelStatement {
  constructor(private readonly statement: SqliteStatement) {}

  all(params?: Record<string, SqlValue> | readonly SqlValue[]): SqlRow[] {
    return this.statement.all(asParams(params)).map((row) => asRow(row));
  }

  get(params?: Record<string, SqlValue> | readonly SqlValue[]): SqlRow | undefined {
    const row = this.statement.get(asParams(params));
    if (row === undefined || row === null) return undefined;
    return asRow(row);
  }

  run(params?: Record<string, SqlValue> | readonly SqlValue[]): { changes: number } {
    return { changes: this.statement.run(asParams(params)).changes };
  }
}

function asParams(params: Record<string, SqlValue> | readonly SqlValue[] | undefined): SqlParams | undefined {
  if (params === undefined) return undefined;
  if (isPositional(params)) return params.map((value) => asDriverValue(value));
  const bound: Record<string, DriverSqlValue> = {};
  for (const key of Object.keys(params)) {
    bound[key] = asDriverValue(params[key]);
  }
  return bound;
}

function isPositional(
  params: Record<string, SqlValue> | readonly SqlValue[],
): params is readonly SqlValue[] {
  return Array.isArray(params);
}

function asDriverValue(value: SqlValue | undefined): DriverSqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new Error("SQLite parameter is not a supported value");
}

function asRow(value: unknown): SqlRow {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  const row: SqlRow = {};
  for (const key of Object.keys(value)) {
    row[key] = asSqlValue(Reflect.get(value, key));
  }
  return row;
}

function asSqlValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  throw new Error("SQLite cell is not a supported value");
}

function assertApplicationRollupWrite(sql: string, healDepth: number): void {
  if (healDepth > 0) return;
  if (ROLLUP_WRITE.test(sql)) throw new RollupWriteForbiddenError();
}
