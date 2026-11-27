import { MigrationRegistryError } from "./errors.js";
import type { MigrationDefinition, MigrationKind, TargetDb } from "./types.js";

const KINDS: readonly MigrationKind[] = ["additive", "rebuild", "data"];
const TARGETS: readonly TargetDb[] = ["global", "state", "code-index"];

export function maxKnownSchemaVersion(
  migrations: readonly MigrationDefinition[],
  targetDb: TargetDb,
  baselineSchemaVersion: number,
): number {
  let max = baselineSchemaVersion;
  for (const migration of migrations) {
    if (migration.targetDb === targetDb && migration.version > max) max = migration.version;
  }
  return max;
}

export function pendingMigrations(
  migrations: readonly MigrationDefinition[],
  targetDb: TargetDb,
  userVersion: number,
): MigrationDefinition[] {
  return migrations.filter((migration) => migration.targetDb === targetDb && migration.version > userVersion);
}

/**
 * Registry must be contiguous per database, starting at baseline+1.
 * Empty registries are valid: production schema stays pinned at version 1.
 */
export function validateMigrationRegistry(
  migrations: readonly MigrationDefinition[],
  baselineSchemaVersion = 1,
): void {
  const problems: string[] = [];
  if (!Number.isSafeInteger(baselineSchemaVersion) || baselineSchemaVersion < 0) {
    problems.push("baseline schema version must be a non-negative integer");
  }
  const names = new Set<string>();
  const seenVersion: Record<TargetDb, Set<number>> = {
    global: new Set(),
    state: new Set(),
    "code-index": new Set(),
  };
  const lastVersion: Record<TargetDb, number> = {
    global: baselineSchemaVersion,
    state: baselineSchemaVersion,
    "code-index": baselineSchemaVersion,
  };

  for (const migration of migrations) {
    if (!migration || typeof migration !== "object") {
      problems.push("migration entry is not an object");
      continue;
    }
    if (!TARGETS.includes(migration.targetDb)) {
      problems.push(`migration "${migration.name}" has targetDb "${String(migration.targetDb)}"`);
      continue;
    }
    if (!KINDS.includes(migration.kind)) {
      problems.push(`migration "${migration.name}" has kind "${String(migration.kind)}"`);
    }
    if (typeof migration.name !== "string" || migration.name.trim() === "" || /\s/.test(migration.name)) {
      problems.push("migration name must be a non-empty string without whitespace");
    } else if (names.has(migration.name)) {
      problems.push(`duplicate migration name "${migration.name}"`);
    } else {
      names.add(migration.name);
    }
    if (!Number.isSafeInteger(migration.version) || migration.version < 1) {
      problems.push(`migration "${migration.name}" version must be a positive integer`);
      continue;
    }
    if (migration.version <= baselineSchemaVersion) {
      problems.push(
        `migration "${migration.name}" version ${migration.version} collides with pinned baseline schema version ${baselineSchemaVersion}`,
      );
    }
    if (seenVersion[migration.targetDb].has(migration.version)) {
      problems.push(`duplicate ${migration.targetDb} migration version ${migration.version}`);
    }
    seenVersion[migration.targetDb].add(migration.version);
    const expected = lastVersion[migration.targetDb] + 1;
    if (migration.version !== expected) {
      problems.push(
        `${migration.targetDb} migration versions must be contiguous (${expected} expected, found ${migration.version} for "${migration.name}")`,
      );
    }
    lastVersion[migration.targetDb] = migration.version;
    if (typeof migration.apply !== "function") {
      problems.push(`migration "${migration.name}" is missing apply()`);
    }
    if (migration.check !== undefined && typeof migration.check !== "function") {
      problems.push(`migration "${migration.name}" check must be a function`);
    }
  }

  if (problems.length > 0) throw new MigrationRegistryError(problems);
}
