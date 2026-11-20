import { loadCoveragePlan, type CoveragePlan } from "./coverage.js";
import type { DiffTouchPort, SearchVerification } from "./ports.js";
import { PAUSE_HOLD_REASON } from "./types.js";
import {
  parseJsonOrNull,
  readRowNumber,
  readRowString,
  readRowStringOrNull,
  type SqlDatabase,
  type SqlStatement,
} from "./sql.js";
import {
  primaryReason,
  type AcceptanceReasonCode,
  type AcceptanceReasonDetail,
  type HoldView,
  type MergeContractVerified,
  type QueuedRuleCheck,
  type SearchDivergence,
  type StaleEdgeRead,
  type StaleNodeRead,
  type UnmetCheck,
} from "./types.js";

export interface Evaluation {
  readonly primary: AcceptanceReasonCode;
  readonly reasons: readonly AcceptanceReasonDetail[];
  readonly staleNodes: readonly StaleNodeRead[];
  readonly staleEdges: readonly StaleEdgeRead[];
  readonly searchDivergences: readonly SearchDivergence[];
  readonly unmetChecks: readonly UnmetCheck[];
  readonly queuedRules: readonly QueuedRuleCheck[];
  readonly unexpectedTouches: readonly string[];
  readonly holds: readonly HoldView[];
  readonly commitSha: string | null;
  readonly payload: unknown;
  readonly receiptHints: readonly (string | null)[];
  readonly contracts: readonly MergeContractVerified[];
  readonly alreadyAccepted: boolean;
}

export function evaluateAcceptance(input: {
  readonly db: SqlDatabase;
  readonly staleReads: SqlStatement;
  readonly staleEdges: SqlStatement;
  readonly diffTouches: DiffTouchPort;
  readonly task: string;
  readonly attempt: string;
  readonly epoch: number;
  readonly artifactDigest: string;
  readonly search: SearchVerification;
}): Evaluation {
  const runtime = input.db
    .prepare(
      `SELECT state, epoch, holder_attempt, submission_pending
         FROM task_runtime WHERE task = :task`,
    )
    .get({ task: input.task });
  const attempt = input.db
    .prepare(`SELECT state FROM attempts WHERE id = :attempt AND task = :task`)
    .get({ attempt: input.attempt, task: input.task });
  const holds = loadHolds(input.db, input.task);
  const candidate = input.db
    .prepare(
      `SELECT commit_sha, payload
         FROM candidates
        WHERE task = :task AND attempt = :attempt
        ORDER BY received_at DESC
        LIMIT 1`,
    )
    .get({ task: input.task, attempt: input.attempt });
  const commitSha = candidate ? readRowString(candidate, "commit_sha") : null;
  const payload = candidate ? parseJsonOrNull(readRowString(candidate, "payload")) : null;
  const contracts = loadContracts(input.db, input.task);

  if (
    runtime &&
    attempt &&
    readRowString(attempt, "state") === "accepted" &&
    readRowString(runtime, "state") === "ACCEPTED" &&
    readRowNumber(runtime, "epoch") === input.epoch &&
    readRowStringOrNull(runtime, "holder_attempt") === input.attempt
  ) {
    return emptyEvaluation({
      primary: "already_accepted",
      reasons: [{ code: "already_accepted", message: "attempt is already accepted" }],
      holds,
      commitSha,
      payload,
      contracts,
      alreadyAccepted: true,
    });
  }

  const reasons: AcceptanceReasonDetail[] = [];
  if (!runtime) {
    reasons.push({ code: "missing_task", message: `task ${input.task} has no runtime row` });
  }
  if (!attempt) {
    reasons.push({
      code: "missing_attempt",
      message: `attempt ${input.attempt} is not open on ${input.task}`,
    });
  }
  if (runtime && attempt) {
    const holder = readRowStringOrNull(runtime, "holder_attempt");
    const epoch = readRowNumber(runtime, "epoch");
    const state = readRowString(runtime, "state");
    const pending = readRowNumber(runtime, "submission_pending");
    if (holder !== input.attempt) {
      reasons.push({
        code: "attempt_mismatch",
        message: `holder ${holder ?? "none"} does not match attempt ${input.attempt}`,
      });
    } else if (epoch !== input.epoch) {
      reasons.push({
        code: "stale_epoch",
        message: `epoch ${input.epoch} does not match task_runtime epoch ${epoch}`,
      });
    } else if (state !== "CLEAN_VERIFY") {
      reasons.push({
        code: "wrong_state",
        message: `state ${state} is not CLEAN_VERIFY`,
      });
    } else if (pending !== 1) {
      reasons.push({
        code: "submission_not_pending",
        message: "submission_pending is not 1",
      });
    }
  }
  if (!candidate) {
    reasons.push({
      code: "missing_candidate",
      message: `attempt ${input.attempt} has no candidate commit`,
    });
  }

  const blocking = holds.filter((hold) => hold.blocking);
  if (blocking.length > 0) {
    reasons.push({
      code: "blocking_hold",
      message: blocking
        .map((hold) => `blocking hold ${hold.reason} source=${hold.source}`)
        .join("; "),
    });
  }

  const coverage = loadCoveragePlan(
    input.db,
    input.task,
    input.diffTouches,
    payload,
    commitSha,
    input.attempt,
  );
  const { unmetChecks, receiptHints } = evaluateChecks(
    input.db,
    input.attempt,
    input.artifactDigest,
    coverage,
  );
  if (coverage.checks.length === 0) {
    unmetChecks.push({
      checkId: "*",
      status: "missing",
      checkVersion: null,
      currentVersion: null,
      detail: "no checks are linked at the current versions",
    });
  }
  pushCheckReasons(reasons, unmetChecks);

  const queuedRules = queueDiffRules(input.task, input.attempt, coverage, unmetChecks);
  if (queuedRules.length > 0) {
    reasons.push({
      code: "diff_detected_rule",
      message: queuedRules
        .map(
          (rule) =>
            `${rule.ruleId} entered scope from diff tags ${coverage.unexpectedTouches.join(", ")}; queued ${rule.checkIds.join(", ")}`,
        )
        .join("; "),
    });
  }

  const staleNodes = loadStaleNodes(input.db, input.staleReads, input.attempt);
  if (staleNodes.length > 0) {
    reasons.push({
      code: "stale_node_reads",
      message: staleNodes.map((node) => node.detail).join("; "),
    });
  }
  const staleEdges = loadStaleEdges(input.staleEdges, input.attempt);
  if (staleEdges.length > 0) {
    reasons.push({
      code: "stale_edge_reads",
      message: staleEdges.map((edge) => edge.detail).join("; "),
    });
  }
  if (input.search.truncated) {
    reasons.push({
      code: "search_reads_over_limit",
      message: `recorded searches exceed the ${input.search.checked} re-check limit`,
    });
  }
  if (input.search.divergences.length > 0) {
    reasons.push({
      code: "stale_search_reads",
      message: input.search.divergences
        .map((divergence) => describeSearch(divergence))
        .join("; "),
    });
  }

  const problem = reasons.length > 0;
  const pause = holds.filter((hold) => !hold.blocking);
  if (!problem && pause.length > 0 && blocking.length === 0) {
    reasons.push({
      code: "user_pause",
      message: pause
        .map(
          (hold) =>
            `${PAUSE_HOLD_REASON} hold source=${hold.source}; evidence preserved; downstream dispatch held`,
        )
        .join("; "),
    });
  }

  return {
    primary: primaryReason(reasons.map((reason) => reason.code)),
    reasons,
    staleNodes,
    staleEdges,
    searchDivergences: input.search.divergences,
    unmetChecks,
    queuedRules,
    unexpectedTouches: coverage.unexpectedTouches,
    holds,
    commitSha,
    payload,
    receiptHints,
    contracts,
    alreadyAccepted: false,
  };
}

function emptyEvaluation(input: {
  readonly primary: AcceptanceReasonCode;
  readonly reasons: readonly AcceptanceReasonDetail[];
  readonly holds: readonly HoldView[];
  readonly commitSha: string | null;
  readonly payload: unknown;
  readonly contracts: readonly MergeContractVerified[];
  readonly alreadyAccepted: boolean;
}): Evaluation {
  return {
    primary: input.primary,
    reasons: input.reasons,
    staleNodes: [],
    staleEdges: [],
    searchDivergences: [],
    unmetChecks: [],
    queuedRules: [],
    unexpectedTouches: [],
    holds: input.holds,
    commitSha: input.commitSha,
    payload: input.payload,
    receiptHints: [],
    contracts: input.contracts,
    alreadyAccepted: input.alreadyAccepted,
  };
}

function loadHolds(db: SqlDatabase, task: string): HoldView[] {
  return db
    .prepare(`SELECT reason, source FROM task_holds WHERE task = :task ORDER BY reason, source`)
    .all({ task })
    .map((row) => {
      const reason = readRowString(row, "reason");
      return {
        reason,
        source: readRowString(row, "source"),
        blocking: reason !== PAUSE_HOLD_REASON,
      };
    });
}

function loadContracts(db: SqlDatabase, task: string): MergeContractVerified[] {
  return db
    .prepare(
      `SELECT n.id AS id, n.version AS v
         FROM edges e
         JOIN nodes n ON n.id = e.dst
        WHERE e.src = :task AND e.type = 'consumes_contract' AND e.valid_to_rev IS NULL
        ORDER BY n.id`,
    )
    .all({ task })
    .map((row) => ({ id: readRowString(row, "id"), v: readRowNumber(row, "v") }));
}

function evaluateChecks(
  db: SqlDatabase,
  attempt: string,
  artifactDigest: string,
  coverage: CoveragePlan,
): { unmetChecks: UnmetCheck[]; receiptHints: (string | null)[] } {
  const unmetChecks: UnmetCheck[] = [];
  const receiptHints: (string | null)[] = [];
  for (const check of coverage.checks) {
    const node = db
      .prepare(`SELECT version FROM nodes WHERE id = :id`)
      .get({ id: check.checkId });
    if (!node) {
      unmetChecks.push({
        checkId: check.checkId,
        status: "missing",
        checkVersion: null,
        currentVersion: null,
        detail: `${check.checkId} status=missing`,
      });
      continue;
    }
    const currentVersion = readRowNumber(node, "version");
    const current = db
      .prepare(
        `SELECT check_version, artifact_digest, status, receipt
           FROM check_results
          WHERE check_id = :check_id AND attempt = :attempt AND check_version = :check_version`,
      )
      .get({
        check_id: check.checkId,
        attempt,
        check_version: currentVersion,
      });
    if (!current) {
      const older = db
        .prepare(
          `SELECT check_version, status
             FROM check_results
            WHERE check_id = :check_id AND attempt = :attempt
            ORDER BY check_version DESC
            LIMIT 1`,
        )
        .get({ check_id: check.checkId, attempt });
      if (older && readRowNumber(older, "check_version") !== currentVersion) {
        const checkVersion = readRowNumber(older, "check_version");
        unmetChecks.push({
          checkId: check.checkId,
          status: readRowString(older, "status"),
          checkVersion,
          currentVersion,
          detail: `${check.checkId} check_version=${checkVersion} current=${currentVersion}`,
        });
      } else {
        unmetChecks.push({
          checkId: check.checkId,
          status: "missing",
          checkVersion: null,
          currentVersion,
          detail: `${check.checkId} status=missing`,
        });
      }
      continue;
    }
    const status = readRowString(current, "status");
    const digest = readRowString(current, "artifact_digest");
    receiptHints.push(readRowStringOrNull(current, "receipt"));
    if (digest !== artifactDigest) {
      unmetChecks.push({
        checkId: check.checkId,
        status,
        checkVersion: currentVersion,
        currentVersion,
        detail: `${check.checkId} artifact_digest mismatch`,
      });
      continue;
    }
    if (status !== "pass") {
      unmetChecks.push({
        checkId: check.checkId,
        status,
        checkVersion: currentVersion,
        currentVersion,
        detail: `${check.checkId} status=${status}`,
      });
    }
  }
  return { unmetChecks, receiptHints };
}

function pushCheckReasons(reasons: AcceptanceReasonDetail[], unmet: readonly UnmetCheck[]): void {
  const stale = unmet.filter((check) => check.detail.includes("check_version="));
  const digest = unmet.filter((check) => check.detail.includes("artifact_digest mismatch"));
  const other = unmet.filter(
    (check) =>
      !check.detail.includes("check_version=") && !check.detail.includes("artifact_digest mismatch"),
  );
  if (stale.length > 0) {
    reasons.push({
      code: "stale_check_version",
      message: stale.map((check) => check.detail).join("; "),
    });
  }
  if (digest.length > 0) {
    reasons.push({
      code: "artifact_digest_mismatch",
      message: digest.map((check) => check.detail).join("; "),
    });
  }
  if (other.length > 0) {
    reasons.push({
      code: "unmet_checks",
      message: other.map((check) => check.detail).join("; "),
    });
  }
}

function queueDiffRules(
  task: string,
  attempt: string,
  coverage: CoveragePlan,
  unmet: readonly UnmetCheck[],
): QueuedRuleCheck[] {
  const unmetIds = new Set(unmet.map((check) => check.checkId));
  const queued: QueuedRuleCheck[] = [];
  for (const rule of coverage.rules) {
    if (!rule.fromDiff) continue;
    const ids = rule.checkIds.length > 0 ? rule.checkIds : [rule.ruleId];
    const pending = ids.filter((checkId) => unmetIds.has(checkId));
    if (pending.length === 0) continue;
    queued.push({
      task,
      attempt,
      ruleId: rule.ruleId,
      checkIds: pending,
      reason: "diff_detected_rule",
    });
  }
  return queued;
}

function loadStaleNodes(
  db: SqlDatabase,
  staleReads: SqlStatement,
  attempt: string,
): StaleNodeRead[] {
  return staleReads.all({ attempt }).map((row) => {
    const node = readRowString(row, "node");
    const readVersion = readRowNumber(row, "read_version");
    const currentVersion = readRowNumber(row, "current_version");
    const howRow = db
      .prepare(
        `SELECT how FROM read_sets
          WHERE attempt = :attempt AND node = :node AND version = :version`,
      )
      .get({ attempt, node, version: readVersion });
    const howText = howRow ? readRowString(howRow, "how") : "unknown";
    const how = howText === "pushed" || howText === "pulled" ? howText : "unknown";
    return {
      node,
      readVersion,
      currentVersion,
      how,
      detail: `${node} (read: ${readVersion}, current: ${currentVersion})`,
    };
  });
}

function loadStaleEdges(staleEdges: SqlStatement, attempt: string): StaleEdgeRead[] {
  return staleEdges.all({ attempt }).map((row) => {
    const node = readRowString(row, "node");
    const dir = readRowString(row, "dir");
    const type = readRowString(row, "type");
    const readVersion = readRowNumber(row, "read_version");
    const currentVersion = readRowNumber(row, "current_version");
    return {
      node,
      dir,
      type,
      readVersion,
      currentVersion,
      detail: `${node} ${dir} ${type} (read: ${readVersion}, current: ${currentVersion})`,
    };
  });
}

function describeSearch(divergence: SearchDivergence): string {
  const ids = (divergence.appeared.length > 0 ? divergence.appeared : divergence.currentItems)
    .map((item) => item.id)
    .join(", ");
  const label = divergence.recordedWasEmpty ? "appeared" : "current";
  return `search ${divergence.queryHash} changed; ${label} ${ids}`;
}
