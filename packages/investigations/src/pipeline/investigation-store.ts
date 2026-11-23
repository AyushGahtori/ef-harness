import { DatabaseSync } from "node:sqlite";
import type {
  HypothesisLedgerEntry,
  InvestigationRecord,
  InvestigationReceipt,
  InvestigationStage,
  ProvenRootCause,
  ReproScript,
  SurgicalFix,
  SymptomCard,
  PermanentTestSpec,
} from "./types.js";

/**
 * Local `investigations` projection until `schema/state.sql` adds the M6 table.
 * Shape matches IMPLEMENTATION_TASKS.md Task 182 persistence requirements.
 */
const INVESTIGATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS investigations (
  id                   TEXT PRIMARY KEY,
  symptom_card_json    TEXT NOT NULL,
  stage                TEXT NOT NULL,
  hypothesis_ledger    TEXT NOT NULL DEFAULT '[]',
  repro_script_json    TEXT,
  proven_root_cause    TEXT,
  surgical_fix_json    TEXT,
  permanent_tests_json TEXT,
  receipt_json         TEXT,
  repro_attempts       INTEGER NOT NULL DEFAULT 0,
  repro_started_at     INTEGER,
  escalation_message   TEXT,
  instrumentation_only INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
) STRICT;
`;

export interface InvestigationStoreOptions {
  readonly database?: DatabaseSync;
  readonly now?: () => number;
}

type Row = {
  id: string;
  symptom_card_json: string;
  stage: string;
  hypothesis_ledger: string;
  repro_script_json: string | null;
  proven_root_cause: string | null;
  surgical_fix_json: string | null;
  permanent_tests_json: string | null;
  receipt_json: string | null;
  repro_attempts: number;
  repro_started_at: number | null;
  escalation_message: string | null;
  instrumentation_only: number;
  created_at: number;
  updated_at: number;
};

export class SqliteInvestigationStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(options: InvestigationStoreOptions = {}) {
    this.db = options.database ?? new DatabaseSync(":memory:");
    this.now = options.now ?? (() => Date.now());
    this.db.exec(INVESTIGATIONS_SCHEMA);
  }

  create(id: string, card: SymptomCard): InvestigationRecord {
    const ts = this.now();
    const stage: InvestigationStage = "INTAKE";
    this.db
      .prepare(
        `INSERT INTO investigations (
           id, symptom_card_json, stage, hypothesis_ledger, repro_attempts,
           instrumentation_only, created_at, updated_at
         ) VALUES (?, ?, ?, '[]', 0, 0, ?, ?)`,
      )
      .run(id, JSON.stringify(card), stage, ts, ts);
    return this.get(id)!;
  }

  get(id: string): InvestigationRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM investigations WHERE id = ?`)
      .get(id) as Row | undefined;
    if (!row) return null;
    return rowToRecord(row);
  }

  updateStage(id: string, stage: InvestigationStage): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(`UPDATE investigations SET stage = ?, updated_at = ? WHERE id = ?`)
      .run(stage, ts, id);
    return this.get(id)!;
  }

  appendHypothesis(id: string, entry: HypothesisLedgerEntry): InvestigationRecord {
    const record = this.get(id);
    if (!record) throw new Error(`investigation ${id} not found`);
    const ledger = [...record.hypothesisLedger, entry];
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET hypothesis_ledger = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(ledger), ts, id);
    return this.get(id)!;
  }

  saveReproScript(id: string, script: ReproScript): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET repro_script_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(script), ts, id);
    return this.get(id)!;
  }

  incrementReproAttempts(id: string): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET repro_attempts = repro_attempts + 1, repro_started_at = COALESCE(repro_started_at, ?), updated_at = ? WHERE id = ?`,
      )
      .run(ts, ts, id);
    return this.get(id)!;
  }

  saveProvenRootCause(id: string, rootCause: ProvenRootCause): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET proven_root_cause = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(rootCause), ts, id);
    return this.get(id)!;
  }

  saveSurgicalFix(id: string, fix: SurgicalFix): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET surgical_fix_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(fix), ts, id);
    return this.get(id)!;
  }

  savePermanentTests(id: string, tests: PermanentTestSpec): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET permanent_tests_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(tests), ts, id);
    return this.get(id)!;
  }

  saveReceipt(id: string, receipt: InvestigationReceipt): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET receipt_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(receipt), ts, id);
    return this.get(id)!;
  }

  setEscalation(id: string, message: string): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET escalation_message = ?, updated_at = ? WHERE id = ?`,
      )
      .run(message, ts, id);
    return this.get(id)!;
  }

  setInstrumentationFallback(id: string, enabled: boolean): InvestigationRecord {
    const ts = this.now();
    this.db
      .prepare(
        `UPDATE investigations SET instrumentation_only = ?, updated_at = ? WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, ts, id);
    return this.get(id)!;
  }
}

function rowToRecord(row: Row): InvestigationRecord {
  return {
    id: row.id,
    symptomCard: JSON.parse(row.symptom_card_json) as SymptomCard,
    stage: row.stage as InvestigationStage,
    hypothesisLedger: JSON.parse(row.hypothesis_ledger) as HypothesisLedgerEntry[],
    reproScript: row.repro_script_json
      ? (JSON.parse(row.repro_script_json) as ReproScript)
      : null,
    provenRootCause: row.proven_root_cause
      ? (JSON.parse(row.proven_root_cause) as ProvenRootCause)
      : null,
    surgicalFix: row.surgical_fix_json
      ? (JSON.parse(row.surgical_fix_json) as SurgicalFix)
      : null,
    permanentTests: row.permanent_tests_json
      ? (JSON.parse(row.permanent_tests_json) as PermanentTestSpec)
      : null,
    receipt: row.receipt_json ? (JSON.parse(row.receipt_json) as InvestigationReceipt) : null,
    reproAttempts: row.repro_attempts,
    reproStartedAt: row.repro_started_at,
    escalationMessage: row.escalation_message,
    instrumentationOnlyFallback: row.instrumentation_only === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}