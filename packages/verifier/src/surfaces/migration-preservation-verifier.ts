import { checksumsEqual, computeTableChecksums, type TableChecksum } from "./checksum.js";
import { analyzeMigrationSql } from "./destructive-sql.js";
import { createDefaultDatabaseEngine, type DatabaseEnginePort, type MigrationSession } from "./ports/database.js";
import { generateMigrationPredecessorFixture } from "./ports/synthetic-data.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { MigrationPreservationCheckSchema, type MigrationPreservationCheck } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceCheckVerifier, SurfaceVerifierContext } from "./types.js";

export interface MigrationDependencies {
  readonly database?: DatabaseEnginePort;
}

export class MigrationPreservationVerifier implements SurfaceCheckVerifier {
  readonly id = "migration-preservation";
  readonly surface = "migration";

  constructor(private readonly dependencies: MigrationDependencies = {}) {}

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(MigrationPreservationCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    if (context.env.tier < 3) {
      return [
        implementationFailure(
          check.checkId,
          context,
          `migration preservation requires a Tier 3 isolated database, received tier ${context.env.tier}`,
          { dialect: check.dialect },
        ),
      ];
    }
    const engine = this.dependencies.database ?? createDefaultDatabaseEngine();
    const session = await engine.open({ dialect: check.dialect });
    try {
      const upAnalysis = analyzeMigrationSql(check.upSql);
      const downAnalysis = check.downSql ? analyzeMigrationSql(check.downSql) : undefined;
      const fixture = generateMigrationPredecessorFixture({
        columns: check.predecessor.columns,
        seed: check.predecessor.seed,
      });
      const profileProblems = Object.entries(fixture.profile)
        .filter(([, ok]) => !ok)
        .map(([name]) => name);
      if (profileProblems.length > 0) {
        return [
          implementationFailure(
            `${check.checkId}:preservation`,
            context,
            `predecessor fixture is missing ${profileProblems.join(", ")}`,
            { dialect: check.dialect, tier: 3 },
          ),
        ];
      }
      session.exec(check.predecessor.createSql);
      const columnNames = check.predecessor.columns.map((column) => column.name);
      session.insert(check.table, columnNames, fixture.rows);
      const preRows = session.query(selectSql(check.table, [check.primaryKey, ...check.unchangedColumns]));
      const pre = computeTableChecksums({
        primaryKey: check.primaryKey,
        columns: check.unchangedColumns,
        rows: preRows,
      });
      const first = await session.apply(check.upSql, check.statementTimeoutMs);
      if (!first.ok) {
        return [
          implementationFailure(
            `${check.checkId}:preservation`,
            context,
            first.timedOut ? `migration hit statement_timeout: ${first.message}` : `migration failed: ${first.message}`,
            {
              ...upAnalysis,
              dialect: check.dialect,
              tier: 3,
              statements: first.statements,
              timedOut: first.timedOut,
              fixture: fixture.profile,
            },
          ),
          implementationFailure(`${check.checkId}:idempotence`, context, "re-run skipped because the first migration failed", {
            dialect: check.dialect,
          }),
        ];
      }
      const preservation = this.assertPost(session, check, context, pre, upAnalysis, first.statements, fixture.profile);
      const second = await session.apply(check.upSql, check.statementTimeoutMs);
      const postRows = safeRows(session, check.postTable, [check.primaryKey, ...check.unchangedColumns]);
      const post = computeTableChecksums({
        primaryKey: check.primaryKey,
        columns: check.unchangedColumns,
        rows: postRows,
      });
      const idempotence = this.idempotence(check, context, session, second, pre, post, upAnalysis);
      const results = [preservation, idempotence];
      if (check.downSql && downAnalysis && preservation.status === "pass" && idempotence.status === "pass") {
        results.push(await this.down(session, check, context, pre, downAnalysis));
      }
      return results;
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    } finally {
      await session.close();
    }
  }

  private assertPost(
    session: MigrationSession,
    check: MigrationPreservationCheck,
    context: SurfaceVerifierContext,
    pre: TableChecksum,
    analysis: ReturnType<typeof analyzeMigrationSql>,
    statements: readonly string[],
    fixture: ReturnType<typeof generateMigrationPredecessorFixture>["profile"],
  ): SurfaceCheckResult {
    const checkId = `${check.checkId}:preservation`;
    const problems: string[] = [];
    let post: TableChecksum | undefined;
    try {
      const rows = session.query(selectSql(check.postTable, [check.primaryKey, ...check.unchangedColumns]));
      post = computeTableChecksums({
        primaryKey: check.primaryKey,
        columns: check.unchangedColumns,
        rows,
      });
      problems.push(...checksumsEqual(pre, post, check.unchangedColumns));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    for (const rule of check.transformations) {
      try {
        const rows = session.query(rule.sql);
        const sample = rows[0];
        if (!sample) {
          problems.push(`${rule.description}: no sample row`);
          continue;
        }
        for (const [key, expected] of Object.entries(rule.expect)) {
          if (sample[key] !== expected) {
            problems.push(`${rule.description}: ${key} ${String(sample[key])} !== ${String(expected)}`);
          }
        }
      } catch (error) {
        problems.push(`${rule.description}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      const read = session.query(check.readSql);
      if (read.length === 0) problems.push("app read path returned no rows");
    } catch (error) {
      problems.push(`app read path failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const integrity = session.validateIntegrity();
    if (!integrity.integrityOk) problems.push("integrity_check failed");
    if (integrity.foreignKeyViolations > 0) problems.push(`${integrity.foreignKeyViolations} foreign key violations`);
    const indexes = session.listIndexes(check.postTable);
    for (const expected of check.expectedIndexes) {
      if (!indexes.includes(expected)) problems.push(`missing index ${expected}`);
    }
    const details = {
      ...analysis,
      dialect: check.dialect,
      tier: 3 as const,
      statementTimeoutMs: check.statementTimeoutMs,
      statements,
      fixture,
      pre,
      post,
      indexes,
    };
    if (problems.length > 0) {
      return implementationFailure(checkId, context, problems.join("; "), details);
    }
    return passing(checkId, context, "row counts, unchanged checksums, transforms, indexes, and the read path held", details);
  }

  private idempotence(
    check: MigrationPreservationCheck,
    context: SurfaceVerifierContext,
    session: MigrationSession,
    second: { ok: boolean; timedOut: boolean; message?: string; statements: readonly string[] },
    pre: TableChecksum,
    post: TableChecksum,
    analysis: ReturnType<typeof analyzeMigrationSql>,
  ): SurfaceCheckResult {
    const checkId = `${check.checkId}:idempotence`;
    const drift = checksumsEqual(pre, post, check.unchangedColumns);
    if (second.timedOut) {
      return implementationFailure(checkId, context, `re-run hit statement_timeout: ${second.message}`, {
        ...analysis,
        dialect: check.dialect,
        statements: second.statements,
      });
    }
    if (!second.ok) {
      if (check.allowCleanRefusalOnRerun && drift.length === 0) {
        const integrity = session.validateIntegrity();
        if (integrity.integrityOk && integrity.foreignKeyViolations === 0) {
          return passing(checkId, context, `re-run refused cleanly without altering preserved data: ${second.message ?? ""}`, {
            ...analysis,
            dialect: check.dialect,
            statements: second.statements,
            cleanRefusal: true,
            statementTimeoutMs: check.statementTimeoutMs,
          });
        }
      }
      return implementationFailure(
        checkId,
        context,
        `re-run was not idempotent and did not refuse cleanly: ${second.message}`,
        { ...analysis, dialect: check.dialect, statements: second.statements },
      );
    }
    if (drift.length > 0) {
      return implementationFailure(checkId, context, `re-run changed preserved data: ${drift.join("; ")}`, {
        dialect: check.dialect,
      });
    }
    return passing(checkId, context, "re-running the migration kept unchanged checksums", {
      ...analysis,
      dialect: check.dialect,
      statements: second.statements,
      statementTimeoutMs: check.statementTimeoutMs,
    });
  }

  private async down(
    session: MigrationSession,
    check: MigrationPreservationCheck,
    context: SurfaceVerifierContext,
    pre: TableChecksum,
    analysis: ReturnType<typeof analyzeMigrationSql>,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:down-migration`;
    const downSql = check.downSql ?? "";
    const outcome = await session.apply(downSql, check.statementTimeoutMs);
    if (!outcome.ok) {
      return implementationFailure(checkId, context, `down migration failed: ${outcome.message}`, {
        ...analysis,
        dialect: check.dialect,
      });
    }
    const rows = session.query(selectSql(check.table, [check.primaryKey, ...check.unchangedColumns]));
    const restored = computeTableChecksums({
      primaryKey: check.primaryKey,
      columns: check.unchangedColumns,
      rows,
    });
    const drift = checksumsEqual(pre, restored, check.unchangedColumns);
    if (drift.length > 0) {
      return implementationFailure(checkId, context, `down migration did not round-trip: ${drift.join("; ")}`, {
        ...analysis,
        dialect: check.dialect,
      });
    }
    return passing(checkId, context, "down migration restored unchanged predecessor checksums", {
      ...analysis,
      dialect: check.dialect,
      statements: outcome.statements,
    });
  }
}

function selectSql(table: string, columns: readonly string[]): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error(`unsafe table ${table}`);
  const list = columns.map((column) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) throw new Error(`unsafe column ${column}`);
    return `"${column}"`;
  });
  return `SELECT ${list.join(", ")} FROM "${table}"`;
}

function safeRows(session: MigrationSession, table: string, columns: readonly string[]): Record<string, unknown>[] {
  try {
    return session.query(selectSql(table, columns));
  } catch {
    return [];
  }
}
