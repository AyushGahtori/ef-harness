import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";
import type {
  HypothesisLedgerEntry,
  InvestigationRecord,
  InvestigationReceipt,
  InvestigationStage,
  PermanentTestSpec,
  ProvenRootCause,
  ReproScript,
  SurgicalFix,
  SymptomCard,
} from "./types.js";

export interface InvestigationStoreOptions {
  readonly state?: ProjectStateDb;
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

let privateStores = 0;

function openPrivateState(): ProjectStateDb {
  privateStores += 1;
  const rootDir = mkdtempSync(path.join(tmpdir(), "ef-inv-"));
  const projectId = `inv-${process.pid}-${privateStores}`;
  return openProjectStateDb({
    projectId,
    rootDir,
    appVersion: "0.0.0",
  });
}

/**
 * `state.db.investigations` through MigrationRunner v2.
 * The store does not execute DDL. `openProjectStateDb` applies it.
 */
export class SqliteInvestigationStore {
  private readonly db: ProjectStateDb;
  private readonly owns: boolean;
  private readonly now: () => number;

  constructor(options: InvestigationStoreOptions = {}) {
    if (options.state) {
      this.db = options.state;
      this.owns = false;
    } else {
      this.db = openPrivateState();
      this.owns = true;
    }
    this.now = options.now ?? (() => Date.now());
  }

  get state(): ProjectStateDb {
    return this.db;
  }

  close(): void {
    if (this.owns) this.db.close();
  }

  create(id: string, card: SymptomCard): InvestigationRecord {
    const ts = this.now();
    const stage: InvestigationStage = "INTAKE";
    this.db.writer.run(
      `INSERT INTO investigations (
         id, stage, symptom_summary, symptom_card_json, hypothesis_ledger,
         repro_attempts, instrumentation_only, created_at, updated_at
       ) VALUES (?, ?, ?, ?, '[]', 0, 0, ?, ?)`,
      [id, stage, symptomSummary(card), JSON.stringify(card), ts, ts],
    );
    return this.must(id);
  }

  get(id: string): InvestigationRecord | null {
    const row = asRow(
      this.db.writer.get(`SELECT * FROM investigations WHERE id = ?`, [id]),
    );
    if (!row) return null;
    return rowToRecord(row);
  }

  updateStage(id: string, stage: InvestigationStage): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET stage = ?, updated_at = ? WHERE id = ?`,
      [stage, ts, id],
    );
    return this.must(id);
  }

  appendHypothesis(id: string, entry: HypothesisLedgerEntry): InvestigationRecord {
    const record = this.get(id);
    if (!record) throw new Error(`investigation ${id} not found`);
    const ledger = [...record.hypothesisLedger, entry];
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET hypothesis_ledger = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(ledger), ts, id],
    );
    return this.must(id);
  }

  saveReproScript(id: string, script: ReproScript): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET repro_script_json = ?, repro_command = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(script), script.command.join(" "), ts, id],
    );
    return this.must(id);
  }

  incrementReproAttempts(id: string): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations
         SET repro_attempts = repro_attempts + 1,
             repro_started_at = COALESCE(repro_started_at, ?),
             updated_at = ?
       WHERE id = ?`,
      [ts, ts, id],
    );
    return this.must(id);
  }

  saveProvenRootCause(id: string, rootCause: ProvenRootCause): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET proven_root_cause = ?, root_cause = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(rootCause), rootCause.mechanism, ts, id],
    );
    return this.must(id);
  }

  saveSurgicalFix(id: string, fix: SurgicalFix): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET surgical_fix_json = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(fix), ts, id],
    );
    return this.must(id);
  }

  savePermanentTests(id: string, tests: PermanentTestSpec): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET permanent_tests_json = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(tests), ts, id],
    );
    return this.must(id);
  }

  saveReceipt(id: string, receipt: InvestigationReceipt): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET receipt_json = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(receipt), ts, id],
    );
    return this.must(id);
  }

  setEscalation(id: string, message: string): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET escalation_message = ?, updated_at = ? WHERE id = ?`,
      [message, ts, id],
    );
    return this.must(id);
  }

  setInstrumentationFallback(id: string, enabled: boolean): InvestigationRecord {
    const ts = this.now();
    this.db.writer.run(
      `UPDATE investigations SET instrumentation_only = ?, updated_at = ? WHERE id = ?`,
      [enabled ? 1 : 0, ts, id],
    );
    return this.must(id);
  }

  private must(id: string): InvestigationRecord {
    const record = this.get(id);
    if (!record) throw new Error(`investigation ${id} not found`);
    return record;
  }
}

function symptomSummary(card: SymptomCard): string {
  return `${card.title}: ${card.observedBehavior}`;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value;
}

function asRow(value: unknown): Row | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.stage !== "string") return null;
  const started = record.repro_started_at;
  return {
    id: record.id,
    symptom_card_json: asText(record.symptom_card_json) ?? "{}",
    stage: record.stage,
    hypothesis_ledger: asText(record.hypothesis_ledger) ?? "[]",
    repro_script_json: asText(record.repro_script_json),
    proven_root_cause: asText(record.proven_root_cause),
    surgical_fix_json: asText(record.surgical_fix_json),
    permanent_tests_json: asText(record.permanent_tests_json),
    receipt_json: asText(record.receipt_json),
    repro_attempts: asNumber(record.repro_attempts),
    repro_started_at: started === null || started === undefined ? null : asNumber(started),
    escalation_message: asText(record.escalation_message),
    instrumentation_only: asNumber(record.instrumentation_only),
    created_at: asNumber(record.created_at),
    updated_at: asNumber(record.updated_at),
  };
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
