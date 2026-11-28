import { DatabaseSync } from "node:sqlite";
import { CasBlobStore as DbCasBlobStore, loadCanonicalSqlAsset, type SqliteConnection } from "@ef-harness/db";
import { SqliteShipRunStore } from "../ci-loop/sqlite-ship-run-store.js";
import type { ShipRunPhase, ShipRunRecord as CiShipRun } from "../ci-loop/types.js";
import { schemaStatusFor } from "./store.js";
import type {
  CasBlobStore,
  CasPutInput,
  DeployEnvironment,
  ExternalRegistrationReceipt,
  PostDeployStateStore,
  ShipRunRecord,
  ShipRunState,
} from "./types.js";

const SIDECAR_SQL = `
CREATE TABLE IF NOT EXISTS post_deploy_runs (
  id TEXT PRIMARY KEY,
  logical_state TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  receipt_json TEXT,
  updated_at INTEGER NOT NULL,
  CHECK (receipt_json IS NULL OR json_valid(receipt_json))
) STRICT;

CREATE TABLE IF NOT EXISTS post_deploy_registrations (
  ship_run_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  created_at INTEGER NOT NULL
) STRICT;
`;

/** `state.db.ship_runs` plus registration receipts for post-deploy. */
export class SqlitePostDeployStore implements PostDeployStateStore {
  private readonly shipRuns: SqliteShipRunStore;

  constructor(private readonly db: SqliteConnection) {
    this.db.exec(SIDECAR_SQL);
    this.shipRuns = new SqliteShipRunStore(db);
  }

  saveShipRun(record: ShipRunRecord): void {
    this.db.run(
      `INSERT INTO post_deploy_runs (id, logical_state, deployment_id, receipt_json, updated_at)
       VALUES (:id, :logical_state, :deployment_id, :receipt_json, :updated_at)
       ON CONFLICT(id) DO UPDATE SET
         logical_state = excluded.logical_state,
         deployment_id = excluded.deployment_id,
         receipt_json = excluded.receipt_json,
         updated_at = excluded.updated_at`,
      {
        id: record.id,
        logical_state: record.state,
        deployment_id: record.deploymentId,
        receipt_json: record.receipt ? JSON.stringify(record.receipt) : null,
        updated_at: record.updatedAt,
      },
    );
    this.shipRuns.upsert(ciRecord(record));
  }

  getShipRun(id: string): ShipRunRecord | undefined {
    const row = asRecord(
      this.db.get(
        `SELECT id, logical_state, deployment_id, receipt_json, updated_at
           FROM post_deploy_runs WHERE id = :id`,
        { id },
      ),
    );
    if (!row) return undefined;
    const ci = this.shipRuns.get(id);
    const state = text(row, "logical_state") as ShipRunState;
    const receiptJson = nullableText(row, "receipt_json");
    return {
      id,
      kind: "deploy",
      environment: (ci?.environment ?? "preview") as DeployEnvironment,
      headSha: ci?.headSha ?? "",
      deploymentId: text(row, "deployment_id"),
      url: ci?.url ?? "",
      state,
      schemaStatus: schemaStatusFor(state),
      failureFingerprint: ci?.failureFingerprint ?? null,
      updatedAt: integer(row, "updated_at"),
      receipt: receiptJson ? (JSON.parse(receiptJson) as ShipRunRecord["receipt"]) : null,
    };
  }

  insertRegistration(receipt: ExternalRegistrationReceipt): void {
    this.db.run(
      `INSERT INTO post_deploy_registrations (ship_run_id, receipt_json, created_at)
       VALUES (:ship_run_id, :receipt_json, :created_at)`,
      {
        ship_run_id: receipt.shipRunId,
        receipt_json: JSON.stringify(receipt),
        created_at: Date.now(),
      },
    );
  }

  registrationsFor(shipRunId: string): readonly ExternalRegistrationReceipt[] {
    const rows = this.db.all(
      `SELECT receipt_json FROM post_deploy_registrations
        WHERE ship_run_id = :ship_run_id ORDER BY created_at ASC`,
      { ship_run_id: shipRunId },
    );
    const receipts: ExternalRegistrationReceipt[] = [];
    for (const row of rows) {
      const record = asRecord(row);
      if (!record) continue;
      receipts.push(JSON.parse(text(record, "receipt_json")) as ExternalRegistrationReceipt);
    }
    return receipts;
  }
}

/** Task 028 CAS adapter for smoke screenshots and redacted logs. */
export class DurablePostDeployCas implements CasBlobStore {
  constructor(
    private readonly cas: DbCasBlobStore,
    private readonly holderId: string,
  ) {}

  async put(input: CasPutInput): Promise<{ readonly id: string; readonly hash: string }> {
    const bytes = Buffer.from(input.text, "utf8");
    const stored = await this.cas.put(bytes, {
      holderKind: "project",
      holderId: this.holderId,
      format: "raw",
    });
    return { id: stored.hash, hash: stored.hash };
  }
}

export async function openPostDeployCas(input: {
  readonly rootDir: string;
  readonly holderId: string;
}): Promise<{ readonly cas: DurablePostDeployCas; close(): void }> {
  const globalDb = new DatabaseSync(":memory:");
  globalDb.exec("PRAGMA foreign_keys = ON");
  globalDb.exec(loadCanonicalSqlAsset("globalSql"));
  const cas = await DbCasBlobStore.open({
    globalDb,
    rootDir: input.rootDir,
    sleep: async () => {},
  });
  return {
    cas: new DurablePostDeployCas(cas, input.holderId),
    close() {
      globalDb.close();
    },
  };
}

function ciRecord(record: ShipRunRecord): CiShipRun {
  return {
    id: record.id,
    kind: "deploy",
    feature: null,
    effect: null,
    repo: null,
    prNumber: null,
    headSha: record.headSha,
    runId: record.deploymentId,
    environment: record.environment,
    status: record.schemaStatus,
    failureFingerprint: record.failureFingerprint,
    repairGeneration: 0,
    url: record.url,
    phase: phaseFor(record.state),
    updatedAt: record.updatedAt,
    repairPushesByFingerprint: {},
    totalRepairPushes: 0,
  };
}

function phaseFor(state: ShipRunState): ShipRunPhase {
  if (state === "SHIPPED") return "SHIPPED";
  return "DEPLOYING";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`column ${key} is not text`);
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`column ${key} is not text`);
  return value;
}

function integer(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`column ${key} is not an integer`);
}
