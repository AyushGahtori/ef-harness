import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { isArchivableAttemptState } from "./constants.js";
import { AttemptNotArchivableError, AttemptNotFoundError } from "./errors.js";
import type { CanonicalQueries } from "./queries.js";
import { asNumber, asString, changesOf, withImmediate } from "./sql.js";

export interface TurnLogArchiveResult {
  readonly status: "archived" | "already_archived" | "empty";
  readonly attemptId: string;
  readonly artifactId: string | null;
  readonly steps: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly archivedAt: number | null;
}

export interface StoredTextArtifact {
  readonly artifactId: string;
  readonly hash: string;
}

interface TurnRow {
  attempt: string;
  step: number;
  request_digest: string | null;
  items_artifact: string | null;
  tool_call: string | null;
  result_summary: string | null;
  result_artifact: string | null;
  checkpoint_commit: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
}

export interface TurnLogArchiverOptions {
  readonly stateDb: DatabaseSync;
  readonly queries: CanonicalQueries;
  readonly now: () => number;
  readonly storeText: (input: {
    readonly content: string;
    readonly kind: "log";
    readonly mime: string;
    readonly retention: "evidence" | "diagnostic";
    readonly owners: readonly { ownerKind: string; ownerId: string }[];
  }) => StoredTextArtifact;
}

/**
 * Closes a terminal attempt by pinning one JSONL blob, running canonical
 * `archive_turn_log`, then canonical `purge_archived_turn_log`.
 * running, submitted, and parked attempts throw before either statement.
 */
export class TurnLogArchiver {
  constructor(private readonly options: TurnLogArchiverOptions) {}

  archiveClosedAttemptTurnLog(attemptId: string): TurnLogArchiveResult {
    const attempt = this.options.stateDb
      .prepare("SELECT state FROM attempts WHERE id = ?")
      .get(attemptId);
    if (!attempt) throw new AttemptNotFoundError(attemptId);
    const state = asString(attempt.state, "attempts.state");
    if (!isArchivableAttemptState(state)) {
      throw new AttemptNotArchivableError(attemptId, state);
    }

    const existing = this.readArchive(attemptId);
    if (existing) {
      this.purge(attemptId);
      return { ...existing, status: "already_archived" };
    }

    const rows = this.loadTurns(attemptId);
    if (rows.length === 0) {
      return {
        status: "empty",
        attemptId,
        artifactId: null,
        steps: 0,
        tokensIn: 0,
        tokensOut: 0,
        archivedAt: null,
      };
    }

    const jsonl = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const stored = this.options.storeText({
      content: jsonl,
      kind: "log",
      mime: "application/x-ndjson",
      retention: state === "accepted" ? "evidence" : "diagnostic",
      owners: [{ ownerKind: "attempt", ownerId: attemptId }],
    });
    const now = this.options.now();
    const inserted = this.options.stateDb.prepare(this.options.queries.archiveTurnLog).run({
      attempt: attemptId,
      artifact: stored.artifactId,
      now,
    });
    if (changesOf(inserted.changes) === 0) {
      return {
        status: "empty",
        attemptId,
        artifactId: null,
        steps: 0,
        tokensIn: 0,
        tokensOut: 0,
        archivedAt: null,
      };
    }
    this.purge(attemptId);
    const saved = this.readArchive(attemptId);
    if (!saved || !saved.artifactId) {
      throw new Error(`archive_turn_log did not record attempt ${attemptId}.`);
    }
    return { ...saved, status: "archived" };
  }

  private purge(attemptId: string): number {
    const result = this.options.stateDb.prepare(this.options.queries.purgeArchivedTurnLog).run({
      attempt: attemptId,
    });
    return changesOf(result.changes);
  }

  private readArchive(attemptId: string): TurnLogArchiveResult | null {
    const row = this.options.stateDb
      .prepare(
        "SELECT artifact, steps, tokens_in, tokens_out, archived_at FROM turn_log_archives WHERE attempt = ?",
      )
      .get(attemptId);
    if (!row) return null;
    return {
      status: "already_archived",
      attemptId,
      artifactId: asString(row.artifact, "turn_log_archives.artifact"),
      steps: asNumber(row.steps, "turn_log_archives.steps"),
      tokensIn: asNumber(row.tokens_in, "turn_log_archives.tokens_in"),
      tokensOut: asNumber(row.tokens_out, "turn_log_archives.tokens_out"),
      archivedAt: asNumber(row.archived_at, "turn_log_archives.archived_at"),
    };
  }

  private loadTurns(attemptId: string): TurnRow[] {
    const rows = this.options.stateDb
      .prepare(
        `SELECT attempt, step, request_digest, items_artifact, tool_call, result_summary,
                result_artifact, checkpoint_commit, tokens_in, tokens_out
           FROM turn_log WHERE attempt = ? ORDER BY step ASC`,
      )
      .all(attemptId);
    return rows.map((row) => ({
      attempt: asString(row.attempt, "turn_log.attempt"),
      step: asNumber(row.step, "turn_log.step"),
      request_digest: nullableText(row.request_digest),
      items_artifact: nullableText(row.items_artifact),
      tool_call: nullableText(row.tool_call),
      result_summary: nullableText(row.result_summary),
      result_artifact: nullableText(row.result_artifact),
      checkpoint_commit: nullableText(row.checkpoint_commit),
      tokens_in: nullableNumber(row.tokens_in),
      tokens_out: nullableNumber(row.tokens_out),
    }));
  }
}

function nullableText(value: SQLOutputValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("Expected text or null.");
  return value;
}

function nullableNumber(value: SQLOutputValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number") throw new Error("Expected a number or null.");
  return value;
}

export function countTurnLog(stateDb: DatabaseSync, attemptId: string): number {
  const row = stateDb.prepare("SELECT count(*) AS c FROM turn_log WHERE attempt = ?").get(attemptId);
  return row ? asNumber(row.c, "count") : 0;
}

export function runCanonicalPurge(
  stateDb: DatabaseSync,
  queries: CanonicalQueries,
  attemptId: string,
): number {
  return changesOf(stateDb.prepare(queries.purgeArchivedTurnLog).run({ attempt: attemptId }).changes);
}

export function runCanonicalArchiveInsert(
  stateDb: DatabaseSync,
  queries: CanonicalQueries,
  attemptId: string,
  artifactId: string,
  now: number,
): number {
  return withImmediate(stateDb, () =>
    changesOf(
      stateDb.prepare(queries.archiveTurnLog).run({
        attempt: attemptId,
        artifact: artifactId,
        now,
      }).changes,
    ),
  );
}
