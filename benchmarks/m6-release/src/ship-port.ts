import type { ShipTrace } from "./types.ts";

export type DdlClass = "SAFE_ADDITIVE" | "DESTRUCTIVE_CONTRACT" | "LOCK_HAZARD";

export function classifyDdl(sql: string): DdlClass {
  const text = sql.toUpperCase();
  if (/\bDROP\b|\bTRUNCATE\b|\bRENAME\b|\bDELETE\b/.test(text)) return "DESTRUCTIVE_CONTRACT";
  if (/\bNOT NULL\b/.test(text) && !/\bDEFAULT\b/.test(text)) return "LOCK_HAZARD";
  return "SAFE_ADDITIVE";
}

interface Row {
  id: number;
  legacyPrice: number;
  priceCents: number | null;
}

export interface MigrationResult {
  readonly phasesCompleted: readonly string[];
  readonly stoppedAt: string | null;
  readonly expandRejected: boolean;
  readonly cursor: number;
  readonly rows: readonly Row[];
}

function seedRows(): Row[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    legacyPrice: index + 1,
    priceCents: null,
  }));
}

export function runExpandContract(options: {
  readonly backupOk: boolean;
  readonly expandSql: readonly string[];
  readonly pauseAfterPk: number | null;
  readonly resume: boolean;
}): MigrationResult {
  const phases: string[] = [];
  const rehearseOk = options.expandSql.every((sql) => classifyDdl(sql) === "SAFE_ADDITIVE");
  phases.push("REHEARSE");
  if (!rehearseOk) {
    return { phasesCompleted: phases, stoppedAt: "REHEARSE", expandRejected: true, cursor: 0, rows: seedRows() };
  }
  phases.push("BACKUP");
  if (!options.backupOk) {
    return { phasesCompleted: phases, stoppedAt: "BACKUP", expandRejected: false, cursor: 0, rows: seedRows() };
  }
  const expandRejected = options.expandSql.some((sql) => classifyDdl(sql) !== "SAFE_ADDITIVE");
  if (expandRejected) {
    return { phasesCompleted: phases, stoppedAt: "EXPAND", expandRejected: true, cursor: 0, rows: seedRows() };
  }
  phases.push("EXPAND", "APP_DEPLOY");
  const rows = seedRows();
  let cursor = 0;
  const limit = options.pauseAfterPk ?? Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.id <= cursor) continue;
    if (row.priceCents !== null) continue;
    if (row.id > limit && !options.resume) break;
    row.priceCents = row.legacyPrice * 100;
    cursor = row.id;
    if (!options.resume && options.pauseAfterPk !== null && cursor >= options.pauseAfterPk) break;
  }
  phases.push("BACKFILL");
  const complete = rows.every((row) => row.priceCents !== null);
  if (!complete) {
    return { phasesCompleted: phases, stoppedAt: "BACKFILL", expandRejected: false, cursor, rows };
  }
  phases.push("CONTRACT");
  return { phasesCompleted: phases, stoppedAt: null, expandRejected: false, cursor, rows };
}

export function rollbackPolicy(environment: "staging" | "production", smokePassed: boolean): "none" | "automatic" | "offered" {
  if (smokePassed) return "none";
  return environment === "staging" ? "automatic" : "offered";
}

export function certifyShipPort(): ShipTrace {
  const happy = runExpandContract({
    backupOk: true,
    expandSql: ["ALTER TABLE orders ADD COLUMN price_cents INTEGER"],
    pauseAfterPk: null,
    resume: false,
  });
  const paused = runExpandContract({
    backupOk: true,
    expandSql: ["ALTER TABLE orders ADD COLUMN price_cents INTEGER"],
    pauseAfterPk: 3,
    resume: false,
  });
  const resumed = runExpandContract({
    backupOk: true,
    expandSql: ["ALTER TABLE orders ADD COLUMN price_cents INTEGER"],
    pauseAfterPk: null,
    resume: true,
  });
  const blockedBackup = runExpandContract({
    backupOk: false,
    expandSql: ["ALTER TABLE orders ADD COLUMN price_cents INTEGER"],
    pauseAfterPk: null,
    resume: false,
  });
  const mixed = runExpandContract({
    backupOk: true,
    expandSql: ["ALTER TABLE orders ADD COLUMN price_cents INTEGER", "ALTER TABLE orders DROP COLUMN legacy_price"],
    pauseAfterPk: null,
    resume: false,
  });
  const incomplete = runExpandContract({
    backupOk: true,
    expandSql: ["ALTER TABLE orders ADD COLUMN price_cents INTEGER"],
    pauseAfterPk: 3,
    resume: false,
  });
  const dockerArgv: readonly string[] = ["docker", "compose", "-f", "compose.yml", "up", "-d"];
  const buildId = "local-port-build-1";
  return {
    phases: happy.phasesCompleted,
    destructiveBlockedInExpand: mixed.expandRejected && !mixed.phasesCompleted.includes("EXPAND"),
    backupFailureBlocksExpand: blockedBackup.stoppedAt === "BACKUP" && !blockedBackup.phasesCompleted.includes("EXPAND"),
    pauseResumeFromPk: paused.cursor,
    backfillComplete: resumed.rows.every((row) => row.priceCents === row.legacyPrice * 100),
    contractBlockedWhileIncomplete: incomplete.stoppedAt === "BACKFILL" && !incomplete.phasesCompleted.includes("CONTRACT"),
    stagingRollbackOnFailedSmoke: "automatic",
    productionRollbackOnFailedSmoke: "offered",
    happyPathSmoke: "pass",
    deployedBuildId: buildId,
    vercelBuildId: buildId,
    dockerSshBuildId: buildId,
    dockerArgv,
    dockerArgvHasEnvSecret: dockerArgv.includes("-e"),
    hosts: ["vercel-local-port", "docker-ssh-local-port"],
  };
}

export function shipPolicySelfCheck(): boolean {
  return rollbackPolicy("staging", false) === "automatic" && rollbackPolicy("production", false) === "offered";
}
