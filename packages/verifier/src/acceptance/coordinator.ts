import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentCheckIds, loadCoveragePlan } from "./coverage.js";
import { loadCanonicalQueries, requireCanonicalQuery } from "./canonical-queries.js";
import { evaluateAcceptance, type Evaluation } from "./evaluate-acceptance.js";
import { LocalDiffTouchReader, LocalTurnLogArchiver, MemoryRuleCheckQueue } from "./local-ports.js";
import { MergeInstructionsBuilder, receiptFromResults } from "./merge-instructions.js";
import type {
  CleanVerifierPort,
  DiffTouchPort,
  KnowledgeSearchPort,
  RuleCheckQueuePort,
  TurnLogArchivePort,
} from "./ports.js";
import { syncRequirementStatusInTx } from "./requirement-status.js";
import { currentRevision, readRevisionToken } from "./revision.js";
import { LocalRecordedSearchVerifier } from "./search-verifier.js";
import {
  changesOf,
  parseJsonOrNull,
  readRowNumber,
  readRowString,
  type SqlDatabase,
  type SqlStatement,
} from "./sql.js";
import {
  MAX_REVISION_RETRIES,
  SEARCH_READ_LIMIT,
  TASK_ACCEPTED_CONSUMERS,
  routeFor,
  type AcceptanceDecision,
  type AcceptanceReasonCode,
  type FinalizeCandidateAcceptanceInput,
  type MergeInstructionsV1,
  type QueuedRuleCheck,
  type RevalidatePriorEvidenceInput,
  type RevalidationDecision,
  type StampedCheckReceipt,
} from "./types.js";

export interface AcceptanceCoordinatorOptions {
  readonly db: SqlDatabase;
  readonly queriesSql?: string;
  readonly knowledgeSearch?: KnowledgeSearchPort;
  readonly diffTouches?: DiffTouchPort;
  readonly ruleCheckQueue?: RuleCheckQueuePort;
  readonly cleanVerifier?: CleanVerifierPort;
  readonly turnLogArchive?: TurnLogArchivePort;
  readonly now?: () => number;
  readonly maxRevisionRetries?: number;
}

interface Timings {
  writeLockMs: number;
  searchMs: number;
  searchRevalidations: number;
}

export class CandidateAcceptanceCoordinator {
  private readonly db: SqlDatabase;
  private readonly knowledgeSearch: KnowledgeSearchPort;
  private readonly diffTouches: DiffTouchPort;
  private readonly ruleCheckQueue: RuleCheckQueuePort;
  private readonly cleanVerifier: CleanVerifierPort | undefined;
  private readonly turnLogArchive: TurnLogArchivePort;
  private readonly now: () => number;
  private readonly maxRevisionRetries: number;
  private readonly mergeInstructions = new MergeInstructionsBuilder();
  private readonly staleReads: SqlStatement;
  private readonly staleEdges: SqlStatement;
  private readonly finishSubmission: SqlStatement;
  private readonly registerDelivery: SqlStatement;
  private readonly recomputeStatus: SqlStatement;
  private txOpen = false;
  private archiveChain: Promise<void> = Promise.resolve();

  constructor(options: AcceptanceCoordinatorOptions) {
    this.db = options.db;
    this.now = options.now ?? Date.now;
    this.maxRevisionRetries = options.maxRevisionRetries ?? MAX_REVISION_RETRIES;
    this.knowledgeSearch = options.knowledgeSearch ?? new LocalRecordedSearchVerifier(options.db);
    this.diffTouches = options.diffTouches ?? new LocalDiffTouchReader();
    this.ruleCheckQueue = options.ruleCheckQueue ?? new MemoryRuleCheckQueue();
    this.cleanVerifier = options.cleanVerifier;
    const queries = loadCanonicalQueries(
      options.queriesSql ?? fs.readFileSync(canonicalQueriesPath(), "utf8"),
    );
    this.staleReads = this.db.prepare(
      requireCanonicalQuery(queries, "stale_reads_for_acceptance"),
    );
    this.staleEdges = this.db.prepare(
      requireCanonicalQuery(queries, "stale_edge_reads_for_acceptance"),
    );
    this.finishSubmission = this.db.prepare(requireCanonicalQuery(queries, "finish_submission"));
    this.registerDelivery = this.db.prepare(requireCanonicalQuery(queries, "register_delivery"));
    this.recomputeStatus = this.db.prepare(
      requireCanonicalQuery(queries, "requirement_status_recompute"),
    );
    this.turnLogArchive =
      options.turnLogArchive ??
      new LocalTurnLogArchiver(
        options.db,
        this.db.prepare(requireCanonicalQuery(queries, "archive_turn_log")),
        this.db.prepare(requireCanonicalQuery(queries, "purge_archived_turn_log")),
        this.now,
      );
  }

  finalizeCandidateAcceptance(input: FinalizeCandidateAcceptanceInput): AcceptanceDecision {
    const timings: Timings = { writeLockMs: 0, searchMs: 0, searchRevalidations: 0 };
    let retries = 0;
    while (true) {
      const before = readRevisionToken(this.db);
      const searchStarted = Date.now();
      const search = this.knowledgeSearch.verifyRecordedSearchReads({
        attempt: input.attempt,
        limit: SEARCH_READ_LIMIT,
      });
      timings.searchMs += Date.now() - searchStarted;
      timings.searchRevalidations += 1;
      const after = readRevisionToken(this.db);
      if (before !== after) {
        retries += 1;
        if (retries > this.maxRevisionRetries) {
          return this.revisionAdvancing(input, timings);
        }
        continue;
      }
      const lockStarted = Date.now();
      this.begin();
      try {
        const locked = readRevisionToken(this.db);
        if (locked !== after) {
          this.rollback();
          timings.writeLockMs += Date.now() - lockStarted;
          retries += 1;
          if (retries > this.maxRevisionRetries) {
            return this.revisionAdvancing(input, timings);
          }
          continue;
        }
        const evaluation = evaluateAcceptance({
          db: this.db,
          staleReads: this.staleReads,
          staleEdges: this.staleEdges,
          diffTouches: this.diffTouches,
          task: input.task,
          attempt: input.attempt,
          epoch: input.epoch,
          artifactDigest: input.artifactDigest,
          search,
        });
        const decision = this.applyEvaluation(input, evaluation, timings, lockStarted);
        return decision;
      } catch (error) {
        this.rollback();
        throw error;
      }
    }
  }

  /**
   * Re-run only the current checks against an already accepted commit.
   * Compatible, clarifying, and base-sync changes stamp a new receipt.
   * The accepted commit and attempt stay in place either way.
   */
  revalidatePriorEvidence(input: RevalidatePriorEvidenceInput): RevalidationDecision {
    if (!isRevalidatable(input.changeClass)) {
      return this.revalidationSnapshot(input, {
        revalidated: false,
        reworkSuggested: false,
        reason: "breaking_change_requires_rework",
        stamped: [],
        failures: [],
      });
    }
    if (!this.cleanVerifier) {
      throw new Error("CleanVerifierPort is required to revalidate prior evidence");
    }
    const precondition = this.readRevalidationPrecondition(input);
    if (precondition) return precondition;
    const checkIds = input.checkIds ?? this.currentChecksFor(input.task, input.attempt);
    const verifier = this.cleanVerifier;
    let retries = 0;
    while (true) {
      const before = readRevisionToken(this.db);
      const receipts = verifier.rerunCurrentChecks({
        task: input.task,
        attempt: input.attempt,
        commitSha: input.commitSha,
        checkIds,
      });
      const after = readRevisionToken(this.db);
      if (before !== after) {
        retries += 1;
        if (retries > this.maxRevisionRetries) {
          return this.revalidationSnapshot(input, {
            revalidated: false,
            reworkSuggested: false,
            reason: "revision_advancing",
            stamped: [],
            failures: [],
          });
        }
        continue;
      }
      this.begin();
      try {
        if (readRevisionToken(this.db) !== after) {
          this.rollback();
          retries += 1;
          if (retries > this.maxRevisionRetries) {
            return this.revalidationSnapshot(input, {
              revalidated: false,
              reworkSuggested: false,
              reason: "revision_advancing",
              stamped: [],
              failures: [],
            });
          }
          continue;
        }
        const drifted = this.readRevalidationPrecondition(input);
        if (drifted) {
          this.rollback();
          return drifted;
        }
        const now = input.now ?? this.now();
        const stamped: StampedCheckReceipt[] = [];
        const failures: StampedCheckReceipt[] = [];
        const byId = new Map(receipts.map((receipt) => [receipt.checkId, receipt]));
        for (const checkId of checkIds) {
          const node = this.db.prepare(`SELECT version FROM nodes WHERE id = :id`).get({ id: checkId });
          const receipt = byId.get(checkId);
          const status = receipt?.status ?? "missing";
          const artifactDigest = receipt?.artifactDigest ?? "";
          const receiptId = receipt?.receipt ?? null;
          if (!node) {
            failures.push({
              checkId,
              checkVersion: 0,
              status: "missing",
              artifactDigest,
              receipt: receiptId,
            });
            continue;
          }
          const checkVersion = readRowNumber(node, "version");
          this.db
            .prepare(
              `INSERT INTO check_results(
                 check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at
               ) VALUES (
                 :check_id, :attempt, :check_version, :artifact_digest, :status, :receipt, :recorded_at
               )
               ON CONFLICT(check_id, attempt, check_version) DO UPDATE SET
                 artifact_digest = excluded.artifact_digest,
                 status = excluded.status,
                 receipt = excluded.receipt,
                 recorded_at = excluded.recorded_at`,
            )
            .run({
              check_id: checkId,
              attempt: input.attempt,
              check_version: checkVersion,
              artifact_digest: artifactDigest,
              status,
              receipt: receiptId,
              recorded_at: now,
            });
          const stampedReceipt: StampedCheckReceipt = {
            checkId,
            checkVersion,
            status,
            artifactDigest,
            receipt: receiptId,
          };
          stamped.push(stampedReceipt);
          if (status !== "pass") failures.push(stampedReceipt);
        }
        syncRequirementStatusInTx(this.db, this.recomputeStatus, input.rev ?? currentRevision(this.db));
        this.commit();
        return this.revalidationSnapshot(input, {
          revalidated: failures.length === 0,
          reworkSuggested: failures.length > 0,
          reason: failures.length === 0 ? "revalidated" : "checks_failed",
          stamped,
          failures,
        });
      } catch (error) {
        this.rollback();
        throw error;
      }
    }
  }

  flushArchives(): Promise<void> {
    return this.archiveChain;
  }

  private applyEvaluation(
    input: FinalizeCandidateAcceptanceInput,
    evaluation: Evaluation,
    timings: Timings,
    lockStarted: number,
  ): AcceptanceDecision {
    const now = input.now ?? this.now();
    const rev = input.rev ?? currentRevision(this.db);
    if (evaluation.alreadyAccepted) {
      const mergeInstructions = this.mergeFor(input, evaluation);
      this.rollback();
      timings.writeLockMs += Date.now() - lockStarted;
      return this.decision(input, evaluation, {
        accepted: true,
        mergeInstructions,
        evidencePromoted: [],
        timings,
      });
    }
    if (evaluation.primary === "accepted") {
      const finished = this.finishSubmission.run({
        task: input.task,
        epoch: input.epoch,
        next_state: "ACCEPTED",
        rev,
      });
      if (changesOf(finished) !== 1) {
        this.rollback();
        timings.writeLockMs += Date.now() - lockStarted;
        return this.decision(
          input,
          withPrimary(evaluation, "finish_submission_lost", "finish_submission changed no rows"),
          { accepted: false, mergeInstructions: null, evidencePromoted: [], timings },
        );
      }
      const attemptWrite = this.db
        .prepare(
          `UPDATE attempts
              SET state = 'accepted', ended_at = :now, outcome = 'accepted'
            WHERE id = :attempt AND state IN ('running', 'submitted')`,
        )
        .run({ now, attempt: input.attempt });
      if (changesOf(attemptWrite) !== 1) {
        this.rollback();
        timings.writeLockMs += Date.now() - lockStarted;
        return this.decision(
          input,
          withPrimary(evaluation, "attempt_not_open", "attempt was not running or submitted"),
          { accepted: false, mergeInstructions: null, evidencePromoted: [], timings },
        );
      }
      syncRequirementStatusInTx(this.db, this.recomputeStatus, rev);
      const evidencePromoted = promoteReceiptArtifacts(this.db, input.attempt, input.artifactDigest);
      const mergeInstructions = this.mergeFor(input, evaluation);
      const eventId = `TaskAccepted:${input.task}:${input.attempt}:${input.epoch}`;
      this.db
        .prepare(
          `INSERT INTO outbox(id, type, subject, rev, payload, created_at)
           VALUES (:id, 'TaskAccepted', :subject, :rev, :payload, :now)`,
        )
        .run({
          id: eventId,
          subject: input.task,
          rev,
          now,
          payload: JSON.stringify({
            schema: "event@1",
            id: eventId,
            type: "TaskAccepted",
            task: input.task,
            attempt: input.attempt,
            epoch: input.epoch,
            commit: evaluation.commitSha,
            revision: rev,
            merge_instructions: mergeInstructions,
            evidence_artifacts: evidencePromoted,
          }),
        });
      for (const consumer of TASK_ACCEPTED_CONSUMERS) {
        this.registerDelivery.run({ event_id: eventId, consumer });
      }
      this.commit();
      timings.writeLockMs += Date.now() - lockStarted;
      this.enqueueArchive(input.attempt);
      return this.decision(input, evaluation, {
        accepted: true,
        mergeInstructions,
        evidencePromoted,
        timings,
      });
    }
    if (evaluation.primary === "user_pause") {
      const evidencePromoted = promoteReceiptArtifacts(this.db, input.attempt, input.artifactDigest);
      this.commit();
      timings.writeLockMs += Date.now() - lockStarted;
      return this.decision(input, evaluation, {
        accepted: false,
        mergeInstructions: null,
        evidencePromoted,
        timings,
      });
    }
    if (isArchiveReason(evaluation.primary)) {
      this.db
        .prepare(
          `UPDATE attempts
              SET state = 'rejected', ended_at = :now, outcome = :outcome
            WHERE id = :attempt AND state IN ('running', 'submitted')`,
        )
        .run({
          now,
          attempt: input.attempt,
          outcome: archiveOutcome(evaluation.primary),
        });
      this.db
        .prepare(
          `UPDATE task_runtime
              SET submission_pending = 0, updated_rev = :rev
            WHERE task = :task
              AND holder_attempt = :attempt
              AND state NOT IN ('ACCEPTED', 'MERGED_TO_FEATURE')`,
        )
        .run({ rev, task: input.task, attempt: input.attempt });
      this.commit();
      timings.writeLockMs += Date.now() - lockStarted;
      return this.decision(input, evaluation, {
        accepted: false,
        mergeInstructions: null,
        evidencePromoted: [],
        timings,
      });
    }
    const queued = routeFor(evaluation.primary) === "repair_checks" ? evaluation.queuedRules : [];
    this.rollback();
    timings.writeLockMs += Date.now() - lockStarted;
    this.publishQueue(queued);
    return this.decision(input, evaluation, {
      accepted: false,
      mergeInstructions: null,
      evidencePromoted: [],
      timings,
    });
  }

  private mergeFor(
    input: FinalizeCandidateAcceptanceInput,
    evaluation: Evaluation,
  ): MergeInstructionsV1 | null {
    if (!evaluation.commitSha) return null;
    return this.mergeInstructions.build({
      task: input.task,
      commit: evaluation.commitSha,
      payload: evaluation.payload,
      receipt: receiptFromResults(evaluation.receiptHints, input.receipt, input.attempt),
      contractsVerified: evaluation.contracts,
    });
  }

  private decision(
    input: FinalizeCandidateAcceptanceInput,
    evaluation: Evaluation,
    applied: {
      readonly accepted: boolean;
      readonly mergeInstructions: MergeInstructionsV1 | null;
      readonly evidencePromoted: readonly string[];
      readonly timings: Timings;
    },
  ): AcceptanceDecision {
    const outcome = readOutcome(this.db, input.task, input.attempt);
    return {
      accepted: applied.accepted,
      task: input.task,
      attempt: input.attempt,
      epoch: input.epoch,
      reason: evaluation.primary,
      reasons: evaluation.reasons,
      route: routeFor(evaluation.primary),
      staleNodes: evaluation.staleNodes,
      staleEdges: evaluation.staleEdges,
      searchDivergences: evaluation.searchDivergences,
      unmetChecks: evaluation.unmetChecks,
      queuedRules: evaluation.queuedRules,
      unexpectedTouches: evaluation.unexpectedTouches,
      holds: evaluation.holds,
      mergeInstructions: applied.mergeInstructions,
      evidencePromoted: applied.evidencePromoted,
      preservedCommit: evaluation.commitSha,
      downstreamUnlocked: outcome.downstreamUnlocked,
      attemptState: outcome.attemptState,
      taskState: outcome.taskState,
      submissionPending: outcome.submissionPending,
      writeLockMs: applied.timings.writeLockMs,
      searchMs: applied.timings.searchMs,
      searchRevalidations: applied.timings.searchRevalidations,
    };
  }

  private revisionAdvancing(
    input: FinalizeCandidateAcceptanceInput,
    timings: Timings,
  ): AcceptanceDecision {
    const evaluation = withPrimary(
      blankEvaluation(),
      "revision_advancing",
      "meta.last_rev kept advancing during recorded-search revalidation",
    );
    return this.decision(input, evaluation, {
      accepted: false,
      mergeInstructions: null,
      evidencePromoted: [],
      timings,
    });
  }

  private currentChecksFor(task: string, attempt: string): string[] {
    const candidate = this.db
      .prepare(
        `SELECT commit_sha, payload FROM candidates
          WHERE task = :task AND attempt = :attempt
          ORDER BY received_at DESC LIMIT 1`,
      )
      .get({ task, attempt });
    const payload = candidate ? parseJsonOrNull(readRowString(candidate, "payload")) : null;
    const plan = loadCoveragePlan(
      this.db,
      task,
      this.diffTouches,
      payload,
      candidate ? readRowString(candidate, "commit_sha") : null,
      attempt,
    );
    return currentCheckIds(plan);
  }

  private readRevalidationPrecondition(input: RevalidatePriorEvidenceInput): RevalidationDecision | null {
    const attempt = this.db
      .prepare(`SELECT state FROM attempts WHERE id = :attempt AND task = :task`)
      .get({ attempt: input.attempt, task: input.task });
    const runtime = this.db
      .prepare(`SELECT state FROM task_runtime WHERE task = :task`)
      .get({ task: input.task });
    const candidate = this.db
      .prepare(
        `SELECT commit_sha FROM candidates
          WHERE task = :task AND attempt = :attempt AND commit_sha = :commit`,
      )
      .get({ task: input.task, attempt: input.attempt, commit: input.commitSha });
    if (!attempt || readRowString(attempt, "state") !== "accepted") {
      return this.revalidationSnapshot(input, {
        revalidated: false,
        reworkSuggested: false,
        reason: "attempt_not_accepted",
        stamped: [],
        failures: [],
      });
    }
    if (!runtime || readRowString(runtime, "state") !== "ACCEPTED") {
      return this.revalidationSnapshot(input, {
        revalidated: false,
        reworkSuggested: false,
        reason: "task_not_accepted",
        stamped: [],
        failures: [],
      });
    }
    if (!candidate) {
      return this.revalidationSnapshot(input, {
        revalidated: false,
        reworkSuggested: false,
        reason: "commit_mismatch",
        stamped: [],
        failures: [],
      });
    }
    return null;
  }

  private revalidationSnapshot(
    input: RevalidatePriorEvidenceInput,
    result: {
      readonly revalidated: boolean;
      readonly reworkSuggested: boolean;
      readonly reason: string;
      readonly stamped: readonly StampedCheckReceipt[];
      readonly failures: readonly StampedCheckReceipt[];
    },
  ): RevalidationDecision {
    const outcome = readOutcome(this.db, input.task, input.attempt);
    const commit = this.db
      .prepare(
        `SELECT commit_sha FROM candidates
          WHERE task = :task AND attempt = :attempt AND commit_sha = :commit`,
      )
      .get({ task: input.task, attempt: input.attempt, commit: input.commitSha });
    return {
      revalidated: result.revalidated,
      codePreserved: commit !== undefined && outcome.attemptState === "accepted" && outcome.taskState === "ACCEPTED",
      reworkSuggested: result.reworkSuggested,
      task: input.task,
      attempt: input.attempt,
      commitSha: input.commitSha,
      reason: result.reason,
      attemptState: outcome.attemptState,
      taskState: outcome.taskState,
      stamped: result.stamped,
      failures: result.failures,
    };
  }

  private publishQueue(rules: readonly QueuedRuleCheck[]): void {
    for (const rule of rules) this.ruleCheckQueue.queueRuleChecks(rule);
  }

  private enqueueArchive(attempt: string): void {
    const run = (): Promise<void> =>
      new Promise((resolve, reject) => {
        queueMicrotask(() => {
          try {
            this.turnLogArchive.archiveClosedAttemptTurnLog(attempt);
            resolve();
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    this.archiveChain = this.archiveChain.then(run, run);
  }

  private begin(): void {
    this.db.exec("BEGIN IMMEDIATE");
    this.txOpen = true;
  }

  private commit(): void {
    this.db.exec("COMMIT");
    this.txOpen = false;
  }

  private rollback(): void {
    if (!this.txOpen) return;
    this.db.exec("ROLLBACK");
    this.txOpen = false;
  }
}

export function canonicalQueriesPath(): string {
  return path.join(repositoryRoot(), "schema", "queries.sql");
}

export function canonicalStatePath(): string {
  return path.join(repositoryRoot(), "schema", "state.sql");
}

function repositoryRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let hop = 0; hop < 8; hop += 1) {
    if (fs.existsSync(path.join(dir, "schema", "queries.sql"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("schema/queries.sql was not found from the acceptance module");
}

function promoteReceiptArtifacts(db: SqlDatabase, attempt: string, digest: string): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM artifacts
        WHERE retention = 'diagnostic'
          AND (
            hash = :digest
            OR id IN (
              SELECT receipt FROM check_results
               WHERE attempt = :attempt AND receipt IS NOT NULL
            )
          )
        ORDER BY id`,
    )
    .all({ digest, attempt });
  const update = db.prepare(
    `UPDATE artifacts SET retention = 'evidence' WHERE id = :id AND retention = 'diagnostic'`,
  );
  const ids: string[] = [];
  for (const row of rows) {
    const id = readRowString(row, "id");
    update.run({ id });
    ids.push(id);
  }
  return ids;
}

function readOutcome(
  db: SqlDatabase,
  task: string,
  attempt: string,
): {
  taskState: string | null;
  attemptState: string | null;
  submissionPending: number | null;
  downstreamUnlocked: boolean;
} {
  const runtime = db
    .prepare(
      `SELECT t.state AS state, t.submission_pending AS submission_pending, s.done AS done
         FROM task_runtime t
         JOIN task_states s ON s.state = t.state
        WHERE t.task = :task`,
    )
    .get({ task });
  const attemptRow = db
    .prepare(`SELECT state FROM attempts WHERE id = :attempt`)
    .get({ attempt });
  return {
    taskState: runtime ? readRowString(runtime, "state") : null,
    attemptState: attemptRow ? readRowString(attemptRow, "state") : null,
    submissionPending: runtime ? readRowNumber(runtime, "submission_pending") : null,
    downstreamUnlocked: runtime ? readRowNumber(runtime, "done") === 1 : false,
  };
}

function isArchiveReason(code: AcceptanceReasonCode): boolean {
  return (
    code === "stale_epoch" ||
    code === "attempt_mismatch" ||
    code === "stale_node_reads" ||
    code === "stale_edge_reads" ||
    code === "stale_search_reads"
  );
}

function archiveOutcome(code: AcceptanceReasonCode): string {
  if (code === "stale_node_reads" || code === "stale_edge_reads" || code === "stale_search_reads") {
    return `reverify:${code}`;
  }
  return "superseded";
}

function isRevalidatable(changeClass: RevalidatePriorEvidenceInput["changeClass"]): boolean {
  return changeClass === "compatible" || changeClass === "clarifying" || changeClass === "base_sync";
}

function blankEvaluation(): Evaluation {
  return {
    primary: "accepted",
    reasons: [],
    staleNodes: [],
    staleEdges: [],
    searchDivergences: [],
    unmetChecks: [],
    queuedRules: [],
    unexpectedTouches: [],
    holds: [],
    commitSha: null,
    payload: null,
    receiptHints: [],
    contracts: [],
    alreadyAccepted: false,
  };
}

function withPrimary(evaluation: Evaluation, code: AcceptanceReasonCode, message: string): Evaluation {
  return {
    ...evaluation,
    primary: code,
    reasons: [...evaluation.reasons, { code, message }],
    alreadyAccepted: false,
  };
}
