import type { GitRunner } from "./git-runner.js";
import { stripTrailingNewline } from "./git-runner.js";
import {
  GitCommandError,
  InvalidRefLeaseArgumentError,
  LeaseExpiredError,
  ProtectedBranchError,
  RefLeaseHeldError,
  RefLeaseNotHeldError,
  StaleRefLeaseError,
} from "./errors.js";
import {
  identityEnv,
  readCommitterIdentity,
  resolveCommitIdentities,
  type CommitAuthor,
} from "./identity.js";
import {
  ZERO_OID,
  assertAttemptRef,
  assertFeatureRef,
  assertIntegrationRef,
  assertLeasableRef,
  classifyAutomatedWrite,
  isProtectedWipRef,
  isSha,
  normalizeExpectedSha,
  normalizeSha,
  type LandingAuthorization,
} from "./namespace.js";
import type { RefLeaseStateDb, SqlValue } from "./state-db.js";
import {
  findAcceptedCommitsSince,
  parseHarnessTrailers,
  readCommitParents,
  renderCommitMessage,
  type AcceptedHarnessCommit,
  type FindAcceptedCommitsInput,
  type HarnessCommitTrailers,
  type ParsedHarnessTrailers,
} from "./trailers.js";

export interface RefLease {
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly expectedSha: string | null;
  readonly expiresAt: number | null;
}

export interface RefLeaseManagerOptions {
  readonly database: RefLeaseStateDb;
  readonly git: GitRunner;
  readonly repoPath: string;
  readonly developerBaseRef?: string;
  readonly clock?: () => number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface AcquireRefLeaseInput {
  readonly ref: string;
  readonly holder: string;
  readonly ttlMs: number;
  readonly nowMs?: number;
}

export interface RenewRefLeaseInput {
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly ttlMs: number;
  readonly nowMs?: number;
}

export interface ReleaseRefLeaseInput {
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly nowMs?: number;
}

export interface AdvanceRefCasInput {
  readonly ref: string;
  readonly newSha: string;
  readonly expectedOldSha: string;
  readonly holder?: string;
  readonly epoch?: number;
  readonly nowMs?: number;
  readonly landingAuthorization?: LandingAuthorization;
}

export type CasAdvanceResult =
  | {
      readonly ok: true;
      readonly ref: string;
      readonly newSha: string;
      readonly previousSha: string;
    }
  | {
      readonly ok: false;
      readonly reason: "cas_mismatch";
      readonly actualSha: string;
    };

export interface CreateSquashCommitInput {
  readonly featureRef: string;
  readonly holder: string;
  readonly epoch: number;
  readonly treeSha: string;
  readonly parentSha: string;
  readonly message: string;
  readonly trailers: HarnessCommitTrailers;
  readonly author: CommitAuthor;
  readonly nowMs?: number;
}

export interface CreateMergeCommitInput {
  readonly integrationRef: string;
  readonly featureRef: string;
  readonly holder: string;
  readonly epoch: number;
  readonly treeSha: string;
  readonly integrationSha: string;
  readonly featureSha: string;
  readonly message: string;
  readonly trailers: HarnessCommitTrailers;
  readonly author: CommitAuthor;
  readonly nowMs?: number;
}

export type CommitPublishResult =
  | {
      readonly ok: true;
      readonly sha: string;
      readonly parents: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: "cas_mismatch";
      readonly actualSha: string;
      readonly commitSha: string;
    };

export interface DeleteMergedAttemptBranchInput {
  readonly attemptRef: string;
  readonly featureRef: string;
  readonly holder: string;
  readonly epoch: number;
  readonly taskState: string;
  readonly mergedAtMs: number;
  readonly retentionMs: number;
  readonly nowMs?: number;
}

export type DeleteAttemptBranchResult =
  | { readonly ok: true; readonly deletedSha: string }
  | {
      readonly ok: false;
      readonly reason: "not_merged_to_feature" | "retention_active" | "not_ancestor" | "missing_ref";
    }
  | { readonly ok: false; readonly reason: "cas_mismatch"; readonly actualSha: string };

export interface RefReconciliation {
  readonly ref: string;
  readonly previousExpectedSha: string | null;
  readonly actualSha: string | null;
  readonly status: "in_sync" | "caught_up" | "external_advance" | "missing_ref";
  readonly alreadyApplied: boolean;
  readonly trailers: ParsedHarnessTrailers | null;
  readonly taskId: string | null;
  readonly checkReceipt: string | null;
}

interface LeaseRow {
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly expectedSha: string | null;
  readonly expiresAt: number | null;
}

const HOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,200}$/;

export class RefLeaseManager {
  private readonly database: RefLeaseStateDb;
  private readonly git: GitRunner;
  private readonly repoPath: string;
  private readonly developerBaseRef: string;
  private readonly clock: () => number;
  private readonly env?: NodeJS.ProcessEnv;

  constructor(options: RefLeaseManagerOptions) {
    this.database = options.database;
    this.git = options.git;
    this.repoPath = options.repoPath;
    this.developerBaseRef = options.developerBaseRef ?? "refs/heads/main";
    this.clock = options.clock ?? (() => Date.now());
    if (options.env !== undefined) this.env = options.env;
  }

  async acquireRefLease(input: AcquireRefLeaseInput): Promise<RefLease> {
    const ref = assertLeasableRef(input.ref).ref;
    const holder = requireHolder(input.holder);
    const ttlMs = requireTtl(input.ttlMs);
    const now = input.nowMs ?? this.now();
    return this.database.transaction(async () => {
      const current = this.readRow(ref);
      if (current && this.isActive(current, now) && current.holder === holder) {
        const expiresAt = now + ttlMs;
        this.database.run(
          "UPDATE ref_leases SET expires_at = ? WHERE ref = ? AND holder = ? AND epoch = ?",
          [expiresAt, ref, holder, current.epoch],
        );
        return toLease({ ...current, expiresAt });
      }
      if (current && this.isActive(current, now)) {
        throw new RefLeaseHeldError(ref, current.holder, current.epoch, current.expiresAt);
      }
      const epoch = current ? current.epoch + 1 : 1;
      const expectedSha = (await this.readOptionalSha(ref)) ?? current?.expectedSha ?? null;
      if (current) {
        this.database.run(
          "UPDATE ref_leases SET holder = ?, epoch = ?, expected_sha = ?, expires_at = ? WHERE ref = ?",
          [holder, epoch, expectedSha, now + ttlMs, ref],
        );
      } else {
        this.database.run(
          "INSERT INTO ref_leases (ref, holder, epoch, expected_sha, expires_at) VALUES (?, ?, ?, ?, ?)",
          [ref, holder, epoch, expectedSha, now + ttlMs],
        );
      }
      return {
        ref,
        holder,
        epoch,
        expectedSha,
        expiresAt: now + ttlMs,
      };
    });
  }

  async renewRefLease(input: RenewRefLeaseInput): Promise<RefLease> {
    const ref = assertLeasableRef(input.ref).ref;
    const holder = requireHolder(input.holder);
    const epoch = requireEpoch(input.epoch);
    const ttlMs = requireTtl(input.ttlMs);
    const now = input.nowMs ?? this.now();
    return this.database.transaction(() => {
      const current = this.requireCurrent(ref, holder, epoch, now);
      const expiresAt = now + ttlMs;
      const changes = this.database.run(
        "UPDATE ref_leases SET expires_at = ? WHERE ref = ? AND holder = ? AND epoch = ?",
        [expiresAt, ref, holder, epoch],
      );
      if (changes !== 1) {
        throw new RefLeaseNotHeldError(ref, `Could not renew the lease for ${ref}.`);
      }
      return toLease({ ...current, expiresAt });
    });
  }

  async releaseRefLease(input: ReleaseRefLeaseInput): Promise<void> {
    const ref = assertLeasableRef(input.ref).ref;
    const holder = requireHolder(input.holder);
    const epoch = requireEpoch(input.epoch);
    const now = input.nowMs ?? this.now();
    return this.database.transaction(() => {
      this.requireCurrent(ref, holder, epoch, now);
      const changes = this.database.run(
        "UPDATE ref_leases SET expires_at = 0 WHERE ref = ? AND holder = ? AND epoch = ?",
        [ref, holder, epoch],
      );
      if (changes !== 1) {
        throw new RefLeaseNotHeldError(ref, `Could not release the lease for ${ref}.`);
      }
    });
  }

  readRefLease(ref: string): RefLease | null {
    const row = this.readRow(assertLeasableRef(ref).ref);
    return row ? toLease(row) : null;
  }

  async advanceRefCas(input: AdvanceRefCasInput): Promise<CasAdvanceResult> {
    const newSha = normalizeSha(input.newSha, "newSha");
    if (newSha === ZERO_OID) {
      throw new InvalidRefLeaseArgumentError("newSha cannot be the zero OID.");
    }
    const expectedOldSha = normalizeExpectedSha(input.expectedOldSha);
    const now = input.nowMs ?? this.now();
    const target = classifyAutomatedWrite(
      input.ref,
      this.developerBaseRef,
      input.landingAuthorization,
      now,
    );
    if (target.zone === "harness" && target.leasable) {
      const holder = requireHolder(input.holder ?? "");
      const epoch = requireEpoch(input.epoch ?? Number.NaN);
      return this.database.transaction(async () => {
        this.requireCurrent(target.ref, holder, epoch, now);
        return this.compareAndSwap(target.ref, newSha, expectedOldSha, holder, epoch, now);
      });
    }
    return this.compareAndSwap(target.ref, newSha, expectedOldSha, null, null, now);
  }

  async createSquashCommit(input: CreateSquashCommitInput): Promise<CommitPublishResult> {
    assertFeatureRef(input.featureRef);
    const treeSha = normalizeSha(input.treeSha, "treeSha");
    const parentSha = normalizeSha(input.parentSha, "parentSha");
    const now = input.nowMs ?? this.now();
    const committer = await readCommitterIdentity(this.git, this.repoPath, this.env);
    this.requireCurrent(input.featureRef, requireHolder(input.holder), requireEpoch(input.epoch), now);
    return this.publishCommit({
      ref: input.featureRef,
      holder: input.holder,
      epoch: input.epoch,
      treeSha,
      parents: [parentSha],
      expectedParents: 1,
      expectedOldSha: parentSha,
      message: input.message,
      trailers: input.trailers,
      author: input.author,
      committer,
      now,
    });
  }

  async createMergeCommit(input: CreateMergeCommitInput): Promise<CommitPublishResult> {
    assertIntegrationRef(input.integrationRef);
    assertFeatureRef(input.featureRef);
    const treeSha = normalizeSha(input.treeSha, "treeSha");
    const integrationSha = normalizeSha(input.integrationSha, "integrationSha");
    const featureSha = normalizeSha(input.featureSha, "featureSha");
    if (integrationSha === featureSha) {
      throw new InvalidRefLeaseArgumentError(
        "A feature integration merge needs two distinct parents and is never a fast-forward.",
      );
    }
    const now = input.nowMs ?? this.now();
    const committer = await readCommitterIdentity(this.git, this.repoPath, this.env);
    this.requireCurrent(
      input.integrationRef,
      requireHolder(input.holder),
      requireEpoch(input.epoch),
      now,
    );
    return this.publishCommit({
      ref: input.integrationRef,
      holder: input.holder,
      epoch: input.epoch,
      treeSha,
      parents: [integrationSha, featureSha],
      expectedParents: 2,
      expectedOldSha: integrationSha,
      message: input.message,
      trailers: input.trailers,
      author: input.author,
      committer,
      now,
    });
  }

  parseHarnessTrailers(message: string): ParsedHarnessTrailers {
    return parseHarnessTrailers(message);
  }

  async findAcceptedCommitsSince(input: FindAcceptedCommitsInput): Promise<readonly AcceptedHarnessCommit[]> {
    const untilRef = input.untilRef ?? "refs/heads/harness/integration";
    classifyAutomatedWrite(untilRef, this.developerBaseRef, undefined, this.now());
    return findAcceptedCommitsSince(this.git, this.repoPath, { ...input, untilRef }, this.env);
  }

  async reconcileRefLeases(): Promise<readonly RefReconciliation[]> {
    const rows = this.database
      .all(
        "SELECT ref, holder, epoch, expected_sha, expires_at FROM ref_leases ORDER BY ref",
        [],
      )
      .map((row) => parseRow(row));
    const reports: RefReconciliation[] = [];
    for (const row of rows) reports.push(await this.reconcileOne(row));
    return reports;
  }

  async deleteMergedAttemptBranch(input: DeleteMergedAttemptBranchInput): Promise<DeleteAttemptBranchResult> {
    if (isProtectedWipRef(input.attemptRef) || isProtectedWipRef(input.featureRef)) {
      throw new ProtectedBranchError(input.attemptRef);
    }
    assertAttemptRef(input.attemptRef);
    assertFeatureRef(input.featureRef);
    const now = input.nowMs ?? this.now();
    const holder = requireHolder(input.holder);
    const epoch = requireEpoch(input.epoch);
    this.requireCurrent(input.featureRef, holder, epoch, now);
    if (input.taskState !== "MERGED_TO_FEATURE") {
      return { ok: false, reason: "not_merged_to_feature" };
    }
    requireTimestamp("mergedAtMs", input.mergedAtMs);
    requireTimestamp("retentionMs", input.retentionMs);
    if (now < input.mergedAtMs + input.retentionMs) {
      return { ok: false, reason: "retention_active" };
    }
    const attemptSha = await this.readOptionalSha(input.attemptRef);
    if (!attemptSha) return { ok: false, reason: "missing_ref" };
    const ancestor = await this.git.execGit({
      cwd: this.repoPath,
      args: ["merge-base", "--is-ancestor", attemptSha, input.featureRef],
      ...(this.env !== undefined ? { env: this.env } : {}),
    });
    if (ancestor.exitCode === 1) return { ok: false, reason: "not_ancestor" };
    if (ancestor.exitCode !== 0) {
      throw new GitCommandError("merge-base --is-ancestor", ancestor.exitCode, ancestor.stderr);
    }
    const deleted = await this.git.execGit({
      cwd: this.repoPath,
      args: ["update-ref", "-d", input.attemptRef, attemptSha],
      ...(this.env !== undefined ? { env: this.env } : {}),
    });
    if (deleted.exitCode === 0) return { ok: true, deletedSha: attemptSha };
    const actualSha = (await this.readOptionalSha(input.attemptRef)) ?? ZERO_OID;
    if (actualSha !== attemptSha) {
      return { ok: false, reason: "cas_mismatch", actualSha };
    }
    throw new GitCommandError("update-ref -d", deleted.exitCode, deleted.stderr);
  }

  private async publishCommit(input: {
    readonly ref: string;
    readonly holder: string;
    readonly epoch: number;
    readonly treeSha: string;
    readonly parents: readonly string[];
    readonly expectedParents: 1 | 2;
    readonly expectedOldSha: string;
    readonly message: string;
    readonly trailers: HarnessCommitTrailers;
    readonly author: CommitAuthor;
    readonly committer: { readonly name: string; readonly email: string };
    readonly now: number;
  }): Promise<CommitPublishResult> {
    const identities = resolveCommitIdentities(input.author, input.committer, this.env);
    const message = await renderCommitMessage(
      this.git,
      this.repoPath,
      input.message,
      input.trailers,
      this.env,
    );
    const commitEnv = identityEnv(identities.author, identities.committer, input.now, this.env);
    const args = ["commit-tree", input.treeSha];
    for (const parent of input.parents) args.push("-p", parent);
    args.push("-F", "-");
    const created = await this.git.execGit({
      cwd: this.repoPath,
      args,
      stdin: message,
      env: commitEnv,
    });
    if (created.exitCode !== 0) {
      throw new GitCommandError("commit-tree", created.exitCode, created.stderr);
    }
    const sha = normalizeSha(stripTrailingNewline(created.stdout).trim(), "commit-tree");
    const parents = await readCommitParents(this.git, this.repoPath, sha, commitEnv);
    if (parents.length !== input.expectedParents || parents.some((parent, index) => parent !== input.parents[index])) {
      throw new InvalidRefLeaseArgumentError(
        input.expectedParents === 1
          ? "Task to feature squash commits must have exactly one parent."
          : "Feature to integration commits must be two-parent merge commits, never a fast-forward.",
      );
    }
    const advanced = await this.advanceRefCas({
      ref: input.ref,
      holder: input.holder,
      epoch: input.epoch,
      newSha: sha,
      expectedOldSha: input.expectedOldSha,
      nowMs: input.now,
    });
    if (!advanced.ok) {
      return { ok: false, reason: "cas_mismatch", actualSha: advanced.actualSha, commitSha: sha };
    }
    return { ok: true, sha, parents };
  }

  private async compareAndSwap(
    ref: string,
    newSha: string,
    expectedOldSha: string,
    holder: string | null,
    epoch: number | null,
    now: number,
  ): Promise<CasAdvanceResult> {
    const updated = await this.git.execGit({
      cwd: this.repoPath,
      args: ["update-ref", ref, newSha, expectedOldSha],
      ...(this.env !== undefined ? { env: this.env } : {}),
    });
    if (updated.exitCode === 0) {
      if (holder !== null && epoch !== null) {
        const changes = this.database.run(
          `UPDATE ref_leases
           SET expected_sha = ?
           WHERE ref = ? AND holder = ? AND epoch = ?
             AND (expires_at IS NULL OR expires_at > ?)`,
          [newSha, ref, holder, epoch, now],
        );
        if (changes !== 1) {
          throw new RefLeaseNotHeldError(
            ref,
            `Git advanced ${ref} but the ref lease was no longer current.`,
          );
        }
      }
      return { ok: true, ref, newSha, previousSha: expectedOldSha };
    }
    const actualSha = (await this.readOptionalSha(ref)) ?? ZERO_OID;
    if (actualSha !== expectedOldSha) {
      return { ok: false, reason: "cas_mismatch", actualSha };
    }
    throw new GitCommandError("update-ref", updated.exitCode, updated.stderr);
  }

  private async reconcileOne(row: LeaseRow): Promise<RefReconciliation> {
    const actualSha = await this.readOptionalSha(row.ref);
    if (!actualSha) {
      return {
        ref: row.ref,
        previousExpectedSha: row.expectedSha,
        actualSha: null,
        status: "missing_ref",
        alreadyApplied: false,
        trailers: null,
        taskId: null,
        checkReceipt: null,
      };
    }
    const trailers = await this.trailersOf(actualSha);
    const accepted = trailers.task !== null && trailers.checks !== null;
    if (actualSha === row.expectedSha) {
      return {
        ref: row.ref,
        previousExpectedSha: row.expectedSha,
        actualSha,
        status: "in_sync",
        alreadyApplied: false,
        trailers,
        taskId: trailers.task,
        checkReceipt: trailers.checks,
      };
    }
    this.database.run("UPDATE ref_leases SET expected_sha = ? WHERE ref = ?", [actualSha, row.ref]);
    if (accepted) {
      return {
        ref: row.ref,
        previousExpectedSha: row.expectedSha,
        actualSha,
        status: "caught_up",
        alreadyApplied: true,
        trailers,
        taskId: trailers.task,
        checkReceipt: trailers.checks,
      };
    }
    return {
      ref: row.ref,
      previousExpectedSha: row.expectedSha,
      actualSha,
      status: "external_advance",
      alreadyApplied: false,
      trailers,
      taskId: trailers.task,
      checkReceipt: trailers.checks,
    };
  }

  private async trailersOf(sha: string): Promise<ParsedHarnessTrailers> {
    const body = await this.git.execGit({
      cwd: this.repoPath,
      args: ["log", "-1", "--format=%B", sha],
      ...(this.env !== undefined ? { env: this.env } : {}),
    });
    if (body.exitCode !== 0) return parseHarnessTrailers("");
    return parseHarnessTrailers(body.stdout);
  }

  private requireCurrent(ref: string, holder: string, epoch: number, now: number): LeaseRow {
    const current = this.readRow(ref);
    if (!current) throw new RefLeaseNotHeldError(ref);
    if (current.epoch !== epoch) {
      throw new StaleRefLeaseError(ref, holder, epoch, current.epoch);
    }
    if (current.holder !== holder) throw new RefLeaseNotHeldError(ref);
    if (current.expiresAt !== null && current.expiresAt <= now) {
      throw new LeaseExpiredError(ref, holder, epoch, current.expiresAt);
    }
    return current;
  }

  private isActive(row: LeaseRow, now: number): boolean {
    return row.expiresAt === null || row.expiresAt > now;
  }

  private readRow(ref: string): LeaseRow | null {
    const row = this.database.get(
      "SELECT ref, holder, epoch, expected_sha, expires_at FROM ref_leases WHERE ref = ?",
      [ref],
    );
    return row ? parseRow(row) : null;
  }

  private async readOptionalSha(ref: string): Promise<string | null> {
    const result = await this.git.execGit({
      cwd: this.repoPath,
      args: ["rev-parse", "--verify", "--end-of-options", ref],
      ...(this.env !== undefined ? { env: this.env } : {}),
    });
    if (result.exitCode !== 0) return null;
    const sha = stripTrailingNewline(result.stdout).trim().toLowerCase();
    return isSha(sha) ? sha : null;
  }

  private now(): number {
    const value = this.clock();
    if (!Number.isFinite(value)) {
      throw new InvalidRefLeaseArgumentError("Clock returned a non-finite timestamp.");
    }
    return value;
  }
}

function parseRow(row: Readonly<Record<string, SqlValue>>): LeaseRow {
  const ref = row.ref;
  const holder = row.holder;
  const epoch = row.epoch;
  const expected = row.expected_sha;
  const expires = row.expires_at;
  if (typeof ref !== "string" || typeof holder !== "string") {
    throw new InvalidRefLeaseArgumentError("ref_leases row is malformed.");
  }
  return {
    ref,
    holder,
    epoch: finiteInteger(epoch, "epoch"),
    expectedSha: typeof expected === "string" ? expected : null,
    expiresAt: expires === null ? null : finiteInteger(expires, "expires_at"),
  };
}

function finiteInteger(value: SqlValue | undefined, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) return numeric;
  }
  throw new InvalidRefLeaseArgumentError(`ref_leases.${field} is not an integer.`);
}

function toLease(row: LeaseRow): RefLease {
  return {
    ref: row.ref,
    holder: row.holder,
    epoch: row.epoch,
    expectedSha: row.expectedSha,
    expiresAt: row.expiresAt,
  };
}

function requireHolder(holder: string): string {
  if (!HOLDER_RE.test(holder)) {
    throw new InvalidRefLeaseArgumentError("Lease holder must be a non-empty token.");
  }
  return holder;
}

function requireEpoch(epoch: number): number {
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new InvalidRefLeaseArgumentError("Lease epoch must be a positive integer.");
  }
  return epoch;
}

function requireTtl(ttlMs: number): number {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new InvalidRefLeaseArgumentError("Lease ttlMs must be a positive integer.");
  }
  return ttlMs;
}

function requireTimestamp(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidRefLeaseArgumentError(`${label} must be a non-negative integer.`);
  }
}

export {
  findAcceptedCommitsSince,
  parseHarnessTrailers,
  type AcceptedHarnessCommit,
  type HarnessCommitTrailers,
  type ParsedHarnessTrailers,
};
