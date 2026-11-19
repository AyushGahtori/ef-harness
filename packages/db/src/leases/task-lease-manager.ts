import type { DualClock, SkewObservation } from "./clock.js";
import { SleepSkewGuard, SystemDualClock } from "./clock.js";
import type { LeaseDatabase, LeaseStatement, SqlBindValue } from "./db-port.js";
import { runImmediate } from "./db-port.js";
import { LeaseFencedError } from "./errors.js";
import { globToPathPrefix } from "./glob-prefix.js";
import type { AttemptProcessProbe } from "./process-probe.js";
import { OsProcessProbe } from "./process-probe.js";
import { LEASE_QUERY_NAMES, canonicalQuery, type LeaseQueryName } from "./query-catalog.js";
import { asNullableNumber, asNumber, asString, rowField } from "./rows.js";

export const CLAIM_REFUSAL_REASONS = [
  "not_ready",
  "held",
  "dependency_open",
  "brief_stale",
  "sweep_overlap",
  "lost_race",
] as const;

export type ClaimRefusalReason = (typeof CLAIM_REFUSAL_REASONS)[number];

export type ClaimResult =
  | { readonly claimed: true; readonly epoch: number; readonly attemptId: string }
  | { readonly claimed: false; readonly reason: ClaimRefusalReason };

export interface ClaimTaskInput {
  readonly task: string;
  readonly attemptId: string;
  readonly expectedBrief: number;
  readonly expiresAt: number;
  readonly rev: number;
  readonly runtime: string;
  readonly model: string;
  readonly connection: string;
  readonly baseCommit: string;
  readonly now: number;
}

export interface RenewLeaseInput {
  readonly task: string;
  readonly attemptId: string;
  readonly epoch: number;
  readonly expiresAt: number;
}

export interface ExpiredLease {
  readonly task: string;
  readonly epoch: number;
}

export interface SweepResult {
  readonly suspended: boolean;
  readonly expired: readonly ExpiredLease[];
  readonly fenced: number;
}

export interface OpenSweepIntentInput {
  readonly leaseId: string;
  readonly sweepTask: string;
  readonly globs: readonly string[];
  readonly now: number;
}

export interface SweepIntent {
  readonly leaseId: string;
  readonly mode: "intent";
  readonly prefixes: readonly string[];
}

export interface SweepGrantResult {
  readonly granted: boolean;
  readonly mode: "intent" | "granted";
  readonly blockedBy: string | null;
}

export interface LiveLeaseExtension {
  readonly task: string;
  readonly attemptId: string;
  readonly expiresAt: number;
}

export interface ReconcileResult {
  readonly extended: readonly LiveLeaseExtension[];
  readonly expired: readonly ExpiredLease[];
  readonly fenced: number;
}

export interface TaskLeaseManagerOptions {
  readonly db: LeaseDatabase;
  readonly clock?: DualClock;
  readonly probe?: AttemptProcessProbe;
  readonly skewThresholdMs?: number;
}

const DEFAULT_LIVE_EXTENSION_MS = 60_000;

const ACTIVE_HOLDER_STATES = new Set(["LEASED", "CODING"]);

const RETIRE_CANCELLED_DEPENDENCIES_SQL = `
UPDATE edges
   SET valid_to_rev = CASE
         WHEN :rev > valid_from_rev THEN :rev
         ELSE valid_from_rev + 1
       END
 WHERE src = :task
   AND type = 'depends_on'
   AND valid_to_rev IS NULL
   AND EXISTS (
        SELECT 1
          FROM task_runtime dep
          JOIN task_states s ON s.state = dep.state
         WHERE dep.task = edges.dst
           AND s.terminal = 1
           AND s.done = 0
   )
`;

const TASK_STATE_SQL = `
SELECT t.state, s.claimable
  FROM task_runtime t
  JOIN task_states s ON s.state = t.state
 WHERE t.task = :task
`;

const NODE_VERSION_SQL = `SELECT version FROM nodes WHERE id = :task`;

const HOLD_SQL = `SELECT 1 AS held FROM task_holds WHERE task = :task LIMIT 1`;

const OPEN_DEPENDENCY_SQL = `
SELECT 1 AS open_dep
  FROM edges d
  JOIN task_runtime dep ON dep.task = d.dst
  JOIN task_states s ON s.state = dep.state
 WHERE d.src = :task
   AND d.type = 'depends_on'
   AND d.valid_to_rev IS NULL
   AND s.done = 0
 LIMIT 1
`;

const SWEEP_OVERLAP_SQL = `
SELECT 1 AS overlap
  FROM task_scopes ts
  JOIN path_lease_prefixes p
    ON (
      substr(ts.path_prefix, 1, length(p.path_prefix)) = p.path_prefix
      OR substr(p.path_prefix, 1, length(ts.path_prefix)) = ts.path_prefix
    )
  JOIN path_leases l ON l.id = p.lease AND l.holder <> :task
 WHERE ts.task = :task
 LIMIT 1
`;

const RENEW_SQL = `
UPDATE task_runtime
   SET lease_expires_at = :expires_at
 WHERE task = :task
   AND holder_attempt = :attempt
   AND epoch = :epoch
   AND state IN ('LEASED','CODING')
   AND :expires_at > lease_expires_at
`;

const DELETE_SCOPES_SQL = `DELETE FROM task_scopes WHERE task = :task`;

const INSERT_SCOPE_SQL = `
INSERT INTO task_scopes(task, path_prefix) VALUES (:task, :path_prefix)
`;

const INSERT_PREFIX_SQL = `
INSERT INTO path_lease_prefixes(lease, path_prefix) VALUES (:lease, :path_prefix)
`;

const READ_LEASE_SQL = `SELECT id, mode FROM path_leases WHERE id = :lease`;

const BLOCKING_SWEEP_SQL = `
SELECT other_lease.id AS id
  FROM path_leases self
  JOIN path_leases other_lease
    ON other_lease.id <> self.id
   AND other_lease.mode IN ('intent', 'granted')
  JOIN path_lease_prefixes mine ON mine.lease = self.id
  JOIN path_lease_prefixes other_prefix ON other_prefix.lease = other_lease.id
   AND (
        substr(mine.path_prefix, 1, length(other_prefix.path_prefix)) = other_prefix.path_prefix
        OR substr(other_prefix.path_prefix, 1, length(mine.path_prefix)) = mine.path_prefix
   )
 WHERE self.id = :lease
   AND (
        other_lease.created_at < self.created_at
        OR (other_lease.created_at = self.created_at AND other_lease.id < self.id)
   )
 ORDER BY other_lease.created_at, other_lease.id
 LIMIT 1
`;

const DELETE_LEASE_SQL = `DELETE FROM path_leases WHERE id = :lease`;

const ACTIVE_ATTEMPTS_SQL = `
SELECT task, holder_attempt, epoch, lease_expires_at
  FROM task_runtime
 WHERE holder_attempt IS NOT NULL
   AND submission_pending = 0
   AND state IN ('LEASED','CODING')
`;

const UPDATE_EXPIRY_SQL = `
UPDATE task_runtime
   SET lease_expires_at = :expires_at
 WHERE task = :task
   AND holder_attempt = :attempt
   AND epoch = :epoch
   AND submission_pending = 0
   AND state IN ('LEASED','CODING')
`;

class UnclaimedTask extends Error {
  readonly reason: ClaimRefusalReason;

  constructor(reason: ClaimRefusalReason) {
    super(reason);
    this.name = "UnclaimedTask";
    this.reason = reason;
  }
}

export class TaskLeaseManager {
  private readonly db: LeaseDatabase;
  private readonly probe: AttemptProcessProbe;
  private readonly guard: SleepSkewGuard;
  private readonly statements = new Map<string, LeaseStatement>();
  private readonly processes = new Map<string, number | null>();

  constructor(options: TaskLeaseManagerOptions) {
    this.db = options.db;
    this.probe = options.probe ?? new OsProcessProbe();
    const clock = options.clock ?? new SystemDualClock();
    this.guard =
      options.skewThresholdMs === undefined
        ? new SleepSkewGuard(clock)
        : new SleepSkewGuard(clock, options.skewThresholdMs);
    for (const name of LEASE_QUERY_NAMES) canonicalQuery(name);
  }

  claimTask(input: ClaimTaskInput): ClaimResult {
    assertClaimInput(input);
    try {
      return runImmediate(this.db, () => {
        this.stmt(RETIRE_CANCELLED_DEPENDENCIES_SQL).run({
          task: input.task,
          rev: input.rev,
        });
        const claimed = this.named("claim_task").all({
          task: input.task,
          attempt: input.attemptId,
          expires_at: input.expiresAt,
          rev: input.rev,
          expected_brief: input.expectedBrief,
        });
        const row = claimed[0];
        if (row === undefined) throw new UnclaimedTask(this.diagnoseRefusal(input));
        const epoch = asNumber(rowField(row, "epoch"), "epoch");
        this.named("create_attempt").run({
          attempt: input.attemptId,
          task: input.task,
          epoch,
          expected_brief: input.expectedBrief,
          runtime: input.runtime,
          model: input.model,
          connection: input.connection,
          base_commit: input.baseCommit,
          now: input.now,
        });
        return { claimed: true as const, epoch, attemptId: input.attemptId };
      });
    } catch (error) {
      if (error instanceof UnclaimedTask) {
        return { claimed: false, reason: error.reason };
      }
      throw error;
    }
  }

  renewLease(input: RenewLeaseInput): { expiresAt: number } {
    requireText(input.task, "task");
    requireText(input.attemptId, "attempt");
    requireInteger(input.epoch, "epoch");
    requireInteger(input.expiresAt, "expiresAt");
    runImmediate(this.db, () => {
      const changes = changeCount(
        this.stmt(RENEW_SQL).run({
          task: input.task,
          attempt: input.attemptId,
          epoch: input.epoch,
          expires_at: input.expiresAt,
        }),
      );
      if (changes !== 1) {
        throw new LeaseFencedError(input.task, input.attemptId, input.epoch);
      }
    });
    return { expiresAt: input.expiresAt };
  }

  sweepExpiredLeases(input: { readonly rev: number; readonly now?: number }): SweepResult {
    requireInteger(input.rev, "rev");
    const observation = this.guard.observe();
    if (observation.skewed || this.guard.isSweeperSuspended()) {
      return { suspended: true, expired: [], fenced: 0 };
    }
    const now = input.now ?? observation.wallNow;
    requireInteger(now, "now");
    const swept = runImmediate(this.db, () => this.expireAndFence(now, input.rev));
    return { suspended: false, expired: swept.expired, fenced: swept.fenced };
  }

  fenceAttempts(now: number): number {
    requireInteger(now, "now");
    return runImmediate(this.db, () => changeCount(this.named("fence_attempts").run({ now })));
  }

  onPowerResume(): void {
    this.guard.onPowerResume();
  }

  registerAttemptProcess(attemptId: string, pid: number | null): void {
    requireText(attemptId, "attempt");
    if (pid !== null && (!Number.isSafeInteger(pid) || pid <= 0)) {
      throw new Error("pid must be a positive integer");
    }
    this.processes.set(attemptId, pid);
  }

  registerTaskScopes(task: string, globs: readonly string[]): readonly string[] {
    requireText(task, "task");
    const prefixes = normalizePrefixes(globs);
    runImmediate(this.db, () => {
      this.stmt(DELETE_SCOPES_SQL).run({ task });
      const insert = this.stmt(INSERT_SCOPE_SQL);
      for (const prefix of prefixes) insert.run({ task, path_prefix: prefix });
    });
    return prefixes;
  }

  openSweepIntent(input: OpenSweepIntentInput): SweepIntent {
    requireText(input.leaseId, "lease");
    requireText(input.sweepTask, "sweep task");
    requireInteger(input.now, "now");
    const prefixes = normalizePrefixes(input.globs);
    if (prefixes.length === 0) {
      throw new Error("sweep intent requires at least one path prefix");
    }
    runImmediate(this.db, () => {
      this.named("open_sweep_intent").run({
        lease: input.leaseId,
        sweep_task: input.sweepTask,
        now: input.now,
      });
      const insert = this.stmt(INSERT_PREFIX_SQL);
      for (const prefix of prefixes) insert.run({ lease: input.leaseId, path_prefix: prefix });
    });
    return { leaseId: input.leaseId, mode: "intent", prefixes };
  }

  grantSweepLease(leaseId: string): SweepGrantResult {
    requireText(leaseId, "lease");
    return runImmediate(this.db, () => {
      const current = this.readLeaseMode(leaseId);
      if (current === "granted") {
        return { granted: true, mode: "granted" as const, blockedBy: null };
      }
      const blocker = this.stmt(BLOCKING_SWEEP_SQL).get({ lease: leaseId });
      if (blocker !== undefined && blocker !== null) {
        return {
          granted: false,
          mode: "intent" as const,
          blockedBy: asString(rowField(blocker, "id"), "blocking lease"),
        };
      }
      this.named("grant_sweep_lease").run({ lease: leaseId });
      const mode = this.readLeaseMode(leaseId);
      return { granted: mode === "granted", mode, blockedBy: null };
    });
  }

  releaseSweepLease(leaseId: string): { released: boolean } {
    requireText(leaseId, "lease");
    const changes = runImmediate(this.db, () =>
      changeCount(this.stmt(DELETE_LEASE_SQL).run({ lease: leaseId })),
    );
    return { released: changes === 1 };
  }

  /**
   * After a sleep or clock jump, extend leases whose OS process is still
   * alive and expire only processes that are really gone. Wall-clock expiry
   * stays suspended until this pass finishes.
   */
  reconcileLiveAttempts(input: { readonly rev: number; readonly extensionMs?: number }): ReconcileResult {
    requireInteger(input.rev, "rev");
    const extensionMs = input.extensionMs ?? DEFAULT_LIVE_EXTENSION_MS;
    if (!Number.isSafeInteger(extensionMs) || extensionMs < 1) {
      throw new Error("extensionMs must be a positive integer");
    }
    const observation = this.guard.observe();
    const result = runImmediate(this.db, () => {
      const extended: LiveLeaseExtension[] = [];
      for (const row of this.stmt(ACTIVE_ATTEMPTS_SQL).all({})) {
        const task = asString(rowField(row, "task"), "task");
        const attemptId = asString(rowField(row, "holder_attempt"), "holder_attempt");
        const epoch = asNumber(rowField(row, "epoch"), "epoch");
        const current = asNullableNumber(rowField(row, "lease_expires_at"), "lease_expires_at");
        const live = this.probe.isLive({
          attemptId,
          task,
          pid: this.pidFor(attemptId),
        });
        const expiresAt = live
          ? preservedExpiry(current, observation, extensionMs)
          : observation.wallNow - 1;
        const changes = changeCount(
          this.stmt(UPDATE_EXPIRY_SQL).run({
            task,
            attempt: attemptId,
            epoch,
            expires_at: expiresAt,
          }),
        );
        if (changes !== 1) throw new Error(`could not adjust the lease for ${task}`);
        if (live) extended.push({ task, attemptId, expiresAt });
      }
      const swept = this.expireAndFence(observation.wallNow, input.rev);
      return { extended, expired: swept.expired, fenced: swept.fenced };
    });
    this.guard.completeReconciliation();
    return result;
  }

  private expireAndFence(now: number, rev: number): { expired: ExpiredLease[]; fenced: number } {
    const expired = this.named("sweep_expired_leases")
      .all({ now, rev })
      .map((row) => ({
        task: asString(rowField(row, "task"), "task"),
        epoch: asNumber(rowField(row, "epoch"), "epoch"),
      }));
    const fenced = changeCount(this.named("fence_attempts").run({ now }));
    return { expired, fenced };
  }

  private diagnoseRefusal(input: ClaimTaskInput): ClaimRefusalReason {
    const stateRow = this.stmt(TASK_STATE_SQL).get({ task: input.task });
    if (stateRow === undefined || stateRow === null) return "not_ready";
    const state = asString(rowField(stateRow, "state"), "state");
    const claimable = asNumber(rowField(stateRow, "claimable"), "claimable") === 1;
    if (!claimable && !ACTIVE_HOLDER_STATES.has(state)) return "not_ready";
    const versionRow = this.stmt(NODE_VERSION_SQL).get({ task: input.task });
    if (versionRow === undefined || versionRow === null) return "not_ready";
    if (asNumber(rowField(versionRow, "version"), "version") !== input.expectedBrief) {
      return "brief_stale";
    }
    if (this.hasRow(HOLD_SQL, { task: input.task })) return "held";
    if (this.hasRow(OPEN_DEPENDENCY_SQL, { task: input.task })) return "dependency_open";
    if (this.hasRow(SWEEP_OVERLAP_SQL, { task: input.task })) return "sweep_overlap";
    return "lost_race";
  }

  private readLeaseMode(leaseId: string): "intent" | "granted" {
    const row = this.stmt(READ_LEASE_SQL).get({ lease: leaseId });
    if (row === undefined || row === null) throw new Error(`unknown sweep lease ${leaseId}`);
    const mode = asString(rowField(row, "mode"), "mode");
    if (mode !== "intent" && mode !== "granted") {
      throw new Error(`sweep lease ${leaseId} is in mode ${mode}`);
    }
    return mode;
  }

  private hasRow(sql: string, params: Readonly<Record<string, SqlBindValue>>): boolean {
    const row = this.stmt(sql).get(params);
    return row !== undefined && row !== null;
  }

  private pidFor(attemptId: string): number | null {
    if (!this.processes.has(attemptId)) return null;
    return this.processes.get(attemptId) ?? null;
  }

  private named(name: LeaseQueryName): LeaseStatement {
    return this.stmt(canonicalQuery(name));
  }

  private stmt(sql: string): LeaseStatement {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const prepared = this.db.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }
}

function preservedExpiry(
  current: number | null,
  observation: SkewObservation,
  extensionMs: number,
): number {
  const base = current ?? observation.wallPrev;
  const adjusted = base + observation.signedSkewMs;
  const expiresAt = adjusted > observation.wallNow ? adjusted : observation.wallNow + extensionMs;
  if (!Number.isSafeInteger(expiresAt)) {
    throw new Error("adjusted lease expiry is not a safe integer");
  }
  return expiresAt;
}

function normalizePrefixes(globs: readonly string[]): string[] {
  const prefixes = new Set<string>();
  for (const glob of globs) {
    const prefix = globToPathPrefix(glob);
    if (prefix.includes("\\")) throw new Error("path prefixes must use POSIX separators");
    prefixes.add(prefix);
  }
  return [...prefixes].sort();
}

function assertClaimInput(input: ClaimTaskInput): void {
  requireText(input.task, "task");
  requireText(input.attemptId, "attempt");
  requireText(input.runtime, "runtime");
  requireText(input.model, "model");
  requireText(input.connection, "connection");
  requireText(input.baseCommit, "base commit");
  requireInteger(input.expectedBrief, "expectedBrief");
  requireInteger(input.expiresAt, "expiresAt");
  requireInteger(input.rev, "rev");
  requireInteger(input.now, "now");
}

function requireText(value: string, label: string): void {
  if (value.length === 0) throw new Error(`${label} is required`);
}

function requireInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer`);
}

function changeCount(result: { changes: number | bigint }): number {
  return asNumber(result.changes, "changes");
}
