import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ActiveDeprecatedReferenceError,
  ApprovalRequiredError,
  BackfillIncompleteError,
  ExportRequiredBeforeContractError,
} from "./errors.js";
import { buildApprovalCard } from "./ports.js";
import type { DeprecatedObjectUseProbe, EnvApprovalPolicyEngine } from "./ports.js";
import { quoteIdent } from "./sql-text.js";
import type { ApprovalCard, ExportReceipt, SchemaObjectRef, SqlSession, SqlValue, TargetEnv } from "./types.js";

export class ContractPhaseExportGuard {
  assertNoActiveReferences(
    probe: DeprecatedObjectUseProbe,
    target: SchemaObjectRef,
  ): void {
    const references = probe.activeReferences(target);
    if (references.length > 0) {
      throw new ActiveDeprecatedReferenceError(
        `${target.table}${target.column ? `.${target.column}` : ""} still referenced: ${references.join(" | ")}`,
      );
    }
  }

  assertBackfillComplete(remaining: number): void {
    if (remaining !== 0) throw new BackfillIncompleteError(remaining);
  }

  exportArchive(input: {
    session: SqlSession;
    target: SchemaObjectRef;
    format: ExportReceipt["format"];
    directory: string;
    now?: () => Date;
  }): ExportReceipt {
    let rows: Record<string, SqlValue>[];
    try {
      rows = readRows(input.session, input.target);
    } catch (error) {
      throw new ExportRequiredBeforeContractError(error instanceof Error ? error.message : String(error));
    }
    const stamp = (input.now ?? (() => new Date()))().toISOString().replace(/[-:]/g, "").replace(".", "");
    const name = `${input.target.table}-${input.target.column ?? "table"}-${stamp}.${input.format}`;
    const artifactPath = path.join(input.directory, name);
    const body = serialize(input.format, input.target, rows);
    try {
      mkdirSync(input.directory, { recursive: true });
      writeFileSync(artifactPath, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExportRequiredBeforeContractError(message);
    }
    const checksumSha256 = createHash("sha256").update(body).digest("hex");
    const reread = readFileSync(artifactPath);
    const verified = createHash("sha256").update(reread).digest("hex") === checksumSha256 && countRecords(input.format, reread.toString("utf8")) === rows.length;
    if (!verified) {
      throw new ExportRequiredBeforeContractError(`archive verification failed for ${artifactPath}`);
    }
    return {
      format: input.format,
      artifactPath,
      checksumSha256,
      rowCount: rows.length,
      verified: true,
      table: input.target.table,
      column: input.target.column ?? null,
    };
  }

  requireDestructiveApproval(input: {
    policy: EnvApprovalPolicyEngine;
    migrationId: string;
    env: TargetEnv;
    dropStatements: readonly string[];
    archives: readonly ExportReceipt[];
  }): ApprovalCard {
    const card = buildApprovalCard({
      migrationId: input.migrationId,
      env: input.env,
      kind: "destructive_contract",
      payload: {
        migrationId: input.migrationId,
        dropStatements: input.dropStatements.join("\n"),
        archivePath: input.archives.map((archive) => archive.artifactPath).join("\n"),
        archiveChecksum: input.archives.map((archive) => archive.checksumSha256).join("\n"),
        rowCount: input.archives.reduce((sum, archive) => sum + archive.rowCount, 0),
      },
    });
    const decision = input.policy.decide(card);
    if (!decision.approved || decision.payloadHash !== card.payloadHash) {
      throw new ApprovalRequiredError(
        `${card.title} listing DROP statements and archive ${String(card.payload.archivePath ?? "")} (${decision.reason})`,
      );
    }
    if (!String(card.payload.dropStatements ?? "").trim() || !String(card.payload.archivePath ?? "").trim()) {
      throw new ApprovalRequiredError("destructive approval is missing DROP statements or the archive path");
    }
    return card;
  }
}

function readRows(session: SqlSession, target: SchemaObjectRef): Record<string, SqlValue>[] {
  if (target.column) {
    const pk = primaryKey(session, target.table);
    return [...session.all(
      `SELECT ${quoteIdent(pk)} AS id, ${quoteIdent(target.column)} AS value FROM ${quoteIdent(target.table)} ORDER BY ${quoteIdent(pk)}`,
    )];
  }
  return [...session.all(`SELECT * FROM ${quoteIdent(target.table)}`)];
}

function primaryKey(session: SqlSession, table: string): string {
  if (session.dialect !== "sqlite") return "id";
  const rows = session.all(`PRAGMA table_info(${quoteIdent(table)})`);
  const pk = rows.find((row) => row.pk === 1 || row.pk === 1n);
  const name = pk?.name;
  if (typeof name === "string" && name) return name;
  return "id";
}

function serialize(format: ExportReceipt["format"], target: SchemaObjectRef, rows: readonly Record<string, SqlValue>[]): string {
  if (format === "jsonl") {
    return rows.map((row) => JSON.stringify(normalizeRow(row))).join("\n") + (rows.length > 0 ? "\n" : "");
  }
  if (format === "sql") {
    const table = `${target.table}_${target.column ?? "archive"}`;
    return rows
      .map((row) => {
        const keys = Object.keys(row);
        const values = keys.map((key) => sqlLiteral(row[key] ?? null));
        return `INSERT INTO ${quoteIdent(table)} (${keys.map((key) => quoteIdent(key)).join(", ")}) VALUES (${values.join(", ")});`;
      })
      .join("\n");
  }
  const header = rows[0] ? Object.keys(rows[0]) : target.column ? ["id", "value"] : ["row"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => csvCell(row[key] ?? null)).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function countRecords(format: ExportReceipt["format"], body: string): number {
  if (format === "jsonl") return body.split(/\n/).filter((line) => line.trim()).length;
  if (format === "sql") return body.split(/\n/).filter((line) => line.startsWith("INSERT ")).length;
  return Math.max(0, body.split(/\n/).filter((line) => line.trim()).length - 1);
}

function normalizeRow(row: Record<string, SqlValue>): Record<string, string | number | null> {
  const normalized: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return normalized;
}

function csvCell(value: SqlValue): string {
  const text = value === null ? "" : typeof value === "bigint" ? String(value) : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function sqlLiteral(value: SqlValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}
