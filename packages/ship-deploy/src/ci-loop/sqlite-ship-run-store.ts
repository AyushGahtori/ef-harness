import type { SqliteConnection } from "@ef-harness/db";
import type { ShipRunStore } from "./contracts.js";
import type { ShipRunPhase, ShipRunRecord } from "./types.js";

export class SqliteShipRunStore implements ShipRunStore {
  constructor(private readonly db: SqliteConnection) {}

  get(id: string): ShipRunRecord | undefined {
    const row = this.db.get(
      `SELECT ship_runs.id, ship_runs.kind, ship_runs.feature, ship_runs.effect, ship_runs.repo,
              ship_runs.pr_number, ship_runs.head_sha, ship_runs.run_id, ship_runs.environment,
              ship_runs.status, ship_runs.failure_fingerprint, ship_runs.repair_generation,
              ship_runs.url, ship_runs.updated_at,
              ship_run_details.phase, ship_run_details.repair_pushes_json, ship_run_details.total_repair_pushes
         FROM ship_runs
         LEFT JOIN ship_run_details ON ship_run_details.id = ship_runs.id
        WHERE ship_runs.id = :id`,
      { id },
    );
    if (row === undefined || row === null) return undefined;
    return decode(row);
  }

  upsert(record: ShipRunRecord): void {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO ship_runs (
           id, kind, feature, effect, repo, pr_number, head_sha, run_id, environment,
           status, failure_fingerprint, repair_generation, url, updated_at
         ) VALUES (
           :id, :kind, :feature, :effect, :repo, :pr_number, :head_sha, :run_id, :environment,
           :status, :failure_fingerprint, :repair_generation, :url, :updated_at
         )
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           feature = excluded.feature,
           effect = excluded.effect,
           repo = excluded.repo,
           pr_number = excluded.pr_number,
           head_sha = excluded.head_sha,
           run_id = excluded.run_id,
           environment = excluded.environment,
           status = excluded.status,
           failure_fingerprint = excluded.failure_fingerprint,
           repair_generation = excluded.repair_generation,
           url = excluded.url,
           updated_at = excluded.updated_at`,
        {
          id: record.id,
          kind: record.kind,
          feature: record.feature,
          effect: record.effect,
          repo: record.repo,
          pr_number: record.prNumber,
          head_sha: record.headSha,
          run_id: record.runId,
          environment: record.environment,
          status: record.status,
          failure_fingerprint: record.failureFingerprint,
          repair_generation: record.repairGeneration,
          url: record.url,
          updated_at: record.updatedAt,
        },
      );
      this.db.run(
        `INSERT INTO ship_run_details (id, phase, repair_pushes_json, total_repair_pushes)
         VALUES (:id, :phase, :repair_pushes_json, :total_repair_pushes)
         ON CONFLICT(id) DO UPDATE SET
           phase = excluded.phase,
           repair_pushes_json = excluded.repair_pushes_json,
           total_repair_pushes = excluded.total_repair_pushes`,
        {
          id: record.id,
          phase: record.phase,
          repair_pushes_json: JSON.stringify(record.repairPushesByFingerprint),
          total_repair_pushes: record.totalRepairPushes,
        },
      );
    });
  }

  listOpen(): readonly ShipRunRecord[] {
    const rows = this.db.all(
      `SELECT ship_runs.id FROM ship_runs
        WHERE ship_runs.status IN ('pending', 'running')
        ORDER BY ship_runs.updated_at ASC`,
    );
    const records: ShipRunRecord[] = [];
    for (const row of rows) {
      const id = readText(row, "id");
      const record = this.get(id);
      if (record) records.push(record);
    }
    return records;
  }
}

function decode(row: unknown): ShipRunRecord {
  const phaseRaw = readNullableText(row, "phase");
  const phase = phaseRaw !== null && isPhase(phaseRaw) ? phaseRaw : "PREFLIGHT";
  return {
    id: readText(row, "id"),
    kind: readKind(readText(row, "kind")),
    feature: readNullableText(row, "feature"),
    effect: readNullableText(row, "effect"),
    repo: readNullableText(row, "repo"),
    prNumber: readNullableInt(row, "pr_number"),
    headSha: readNullableText(row, "head_sha"),
    runId: readNullableText(row, "run_id"),
    environment: readNullableText(row, "environment"),
    status: readStatus(readText(row, "status")),
    failureFingerprint: readNullableText(row, "failure_fingerprint"),
    repairGeneration: readInt(row, "repair_generation"),
    url: readNullableText(row, "url"),
    phase,
    updatedAt: readInt(row, "updated_at"),
    repairPushesByFingerprint: readPushes(readNullableText(row, "repair_pushes_json")),
    totalRepairPushes: readNullableInt(row, "total_repair_pushes") ?? 0,
  };
}

function readPushes(raw: string | null): Readonly<Record<string, number>> {
  if (raw === null || raw.length === 0) return {};
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function isPhase(value: string): value is ShipRunPhase {
  return (
    value === "PREFLIGHT" ||
    value === "PUSH_APPROVAL" ||
    value === "PUSHING" ||
    value === "PR_OPEN" ||
    value === "CI_WATCHING" ||
    value === "CI_TRIAGING" ||
    value === "CI_FIXING" ||
    value === "CI_GREEN" ||
    value === "CI_ESCALATED" ||
    value === "DEPLOYING" ||
    value === "SHIPPED"
  );
}

function readKind(value: string): ShipRunRecord["kind"] {
  if (value === "pr" || value === "ci" || value === "deploy" || value === "migration") return value;
  throw new Error(`ship_runs.kind ${value} is not supported`);
}

function readStatus(value: string): ShipRunRecord["status"] {
  if (
    value === "pending" ||
    value === "running" ||
    value === "passed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "rolled_back"
  ) {
    return value;
  }
  throw new Error(`ship_runs.status ${value} is not supported`);
}

function cell(row: unknown, key: string): unknown {
  if (row === null || typeof row !== "object") return undefined;
  return Reflect.get(row, key);
}

function readText(row: unknown, key: string): string {
  const value = cell(row, key);
  if (typeof value !== "string") throw new Error(`ship_runs.${key} is not text`);
  return value;
}

function readNullableText(row: unknown, key: string): string | null {
  const value = cell(row, key);
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`ship_runs.${key} is not text`);
  return value;
}

function readInt(row: unknown, key: string): number {
  const value = readNullableInt(row, key);
  if (value === null) throw new Error(`ship_runs.${key} is not an integer`);
  return value;
}

function readNullableInt(row: unknown, key: string): number | null {
  const value = cell(row, key);
  if (value == null) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`ship_runs.${key} is not an integer`);
}
