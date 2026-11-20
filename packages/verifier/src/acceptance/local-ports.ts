import { createHash } from "node:crypto";
import type { SqlStatement } from "./sql.js";
import { asRecord, asStringArray, changesOf, type SqlDatabase } from "./sql.js";
import type { DiffTouchPort, RuleCheckQueuePort, TurnLogArchivePort } from "./ports.js";
import type { QueuedRuleCheck } from "./types.js";

/** Reads `detected_touches` from the candidate payload until Task 077 is wired. */
export class LocalDiffTouchReader implements DiffTouchPort {
  detectTouches(input: {
    readonly task: string;
    readonly attempt: string;
    readonly commitSha: string | null;
    readonly payload: unknown;
  }): readonly string[] {
    void input.task;
    void input.attempt;
    void input.commitSha;
    const record = asRecord(input.payload);
    return asStringArray(record?.detected_touches);
  }
}

export class MemoryRuleCheckQueue implements RuleCheckQueuePort {
  readonly queued: QueuedRuleCheck[] = [];

  queueRuleChecks(request: QueuedRuleCheck): void {
    this.queued.push(request);
  }
}

/**
 * Writes the closed attempt's `turn_log` through the canonical
 * `archive_turn_log` and `purge_archived_turn_log` statements.
 * Scheduled only after `attempts.state = 'accepted'` has committed.
 */
export class LocalTurnLogArchiver implements TurnLogArchivePort {
  constructor(
    private readonly db: SqlDatabase,
    private readonly archiveTurnLog: SqlStatement,
    private readonly purgeArchivedTurnLog: SqlStatement,
    private readonly now: () => number = Date.now,
  ) {}

  archiveClosedAttemptTurnLog(attempt: string): void {
    const rows = this.db
      .prepare(
        `SELECT step, request_digest, items_artifact, tool_call, result_summary,
                result_artifact, checkpoint_commit, tokens_in, tokens_out
           FROM turn_log
          WHERE attempt = :attempt
          ORDER BY step`,
      )
      .all({ attempt });
    if (rows.length === 0) return;
    const jsonl = rows.map((row) => JSON.stringify(row)).join("\n");
    const hash = createHash("sha256").update(jsonl).digest("hex");
    const artifactId = `turn-log:${attempt}`;
    const existing = this.db.prepare(`SELECT id FROM artifacts WHERE id = :id`).get({ id: artifactId });
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, created_at)
           VALUES (:id, :hash, 'trace', :bytes, 'application/x-ndjson', 'evidence', :now)`,
        )
        .run({
          id: artifactId,
          hash,
          bytes: Buffer.byteLength(jsonl),
          now: this.now(),
        });
    }
    const archived = this.archiveTurnLog.run({
      attempt,
      artifact: artifactId,
      now: this.now(),
    });
    const archiveRow = this.db
      .prepare(`SELECT attempt FROM turn_log_archives WHERE attempt = :attempt`)
      .get({ attempt });
    if (changesOf(archived) > 0 || archiveRow) {
      this.purgeArchivedTurnLog.run({ attempt });
    }
  }
}
