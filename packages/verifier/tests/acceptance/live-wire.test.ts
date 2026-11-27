import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CasBlobStore,
  bindCoordinatorWriteQueue,
  bindLifecycles,
  bindOutbox,
  bindTaskHolds,
  openProjectStateDb,
  type CoordinatorWriteQueue,
  type ProjectStateDb,
  type SqliteConnection,
} from "@ef-harness/db";
import { RefLeaseManager, bindRefLeaseStateDb, createDirectGitRunner } from "@ef-harness/git-engine";
import { afterEach, describe, expect, it } from "vitest";
import { acceptVerifiedCandidate } from "../../src/acceptance/live-bind.js";
import { EMPTY_SEARCH_RESULT_HASH } from "../../src/acceptance/search-hash.js";

const TASK = "T07";
const ATTEMPT = "A-T07-1";
const EPOCH = 3;
const FEATURE_REF = "refs/heads/harness/f/F12";
const HOLDER = "c25-acceptance";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe("live candidate acceptance", () => {
  it("advances the feature ref and commits the done state with an outbox event", async () => {
    const stack = await openStack();
    const decision = await accept(stack, "happy", { epoch: EPOCH, expectedOldSha: stack.oldSha });
    expect(decision.accepted).toBe(true);
    expect(decision.reason).toBe("accepted");
    expect(taskRow(stack.stateDb.writer)).toEqual({ state: "ACCEPTED", pending: 0, done: 1 });
    expect(attemptRow(stack.stateDb.writer).state).toBe("accepted");
    expect(outboxTypes(stack.stateDb.writer)).toContain("TaskAccepted");
    expect(git(stack.repo, ["rev-parse", FEATURE_REF])).toBe(stack.newSha);
  });

  it("quarantines a late submission when the fencing epoch does not match", async () => {
    const stack = await openStack();
    const decision = await accept(stack, "stale", { epoch: EPOCH - 1, expectedOldSha: stack.oldSha });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toBe("stale_epoch");
    expect(decision.route).toBe("rejected");
    expect(taskRow(stack.stateDb.writer)).toEqual({ state: "CLEAN_VERIFY", pending: 0, done: 0 });
    expect(attemptRow(stack.stateDb.writer)).toMatchObject({ state: "rejected", outcome: "superseded" });
    expect(outboxTypes(stack.stateDb.writer)).not.toContain("TaskAccepted");
    expect(git(stack.repo, ["rev-parse", FEATURE_REF])).toBe(stack.oldSha);
  });

  it("does not mark the task done when a hard hold is active or the ref compare-and-swap fails", async () => {
    const held = await openStack();
    held.holds.placeHold({ task: TASK, reason: "governor", source: "c25", now: 5, rev: 1 });
    const blocked = await accept(held, "hold", { epoch: EPOCH, expectedOldSha: held.oldSha });
    expect(blocked.accepted).toBe(false);
    expect(blocked.reason).toBe("blocking_hold");
    expect(taskRow(held.stateDb.writer)).toEqual({ state: "CLEAN_VERIFY", pending: 1, done: 0 });
    expect(git(held.repo, ["rev-parse", FEATURE_REF])).toBe(held.oldSha);

    const missed = await openStack();
    const refused = await accept(missed, "cas", { epoch: EPOCH, expectedOldSha: missed.newSha });
    expect(refused.accepted).toBe(false);
    expect(refused.reason).toBe("ref_cas_failed");
    expect(refused.route).toBe("blocked");
    expect(taskRow(missed.stateDb.writer)).toEqual({ state: "CLEAN_VERIFY", pending: 1, done: 0 });
    expect(git(missed.repo, ["rev-parse", FEATURE_REF])).toBe(missed.oldSha);
  });
});

interface Stack {
  readonly repo: string;
  readonly stateDb: ProjectStateDb;
  readonly queue: CoordinatorWriteQueue;
  readonly holds: ReturnType<typeof bindTaskHolds>;
  readonly lifecycles: ReturnType<typeof bindLifecycles>;
  readonly outbox: ReturnType<typeof bindOutbox>;
  readonly cas: CasBlobStore;
  readonly refs: RefLeaseManager;
  readonly oldSha: string;
  readonly newSha: string;
  readonly digest: string;
  readonly refEpoch: number;
}

async function openStack(): Promise<Stack> {
  const root = mkdtempSync(path.join(tmpdir(), "ef-c25-accept-"));
  const repo = path.join(root, "repo");
  const opened: {
    stateDb?: ProjectStateDb;
    globalDb?: DatabaseSync;
    queue?: CoordinatorWriteQueue;
  } = {};
  closers.push(async () => {
    if (opened.queue) await opened.queue.drainAndClose();
    if (opened.stateDb && !opened.stateDb.isClosed()) opened.stateDb.close();
    opened.globalDb?.close();
    rmSync(root, { recursive: true, force: true });
  });
  const { oldSha, newSha } = initRepo(repo);
  const stateDb = openProjectStateDb({
    projectId: `C25${path.basename(root).replace(/[^A-Za-z0-9._-]/g, "").slice(-24)}`,
    rootDir: path.join(root, "state"),
  });
  opened.stateDb = stateDb;
  const globalDb = new DatabaseSync(":memory:");
  opened.globalDb = globalDb;
  globalDb.exec("PRAGMA foreign_keys = ON");
  globalDb.exec(readFileSync(schemaPath("global.sql"), "utf8"));
  const cas = await CasBlobStore.open({
    globalDb,
    rootDir: path.join(root, "cas"),
    sleep: async () => {},
  });
  const put = await cas.putBlob(Buffer.from("c25 evidence\n"), {
    holderKind: "project",
    holderId: "F12",
    format: "raw",
  });
  seedCandidate(stateDb.writer, newSha, put.hash);
  const queue = bindCoordinatorWriteQueue(stateDb, {
    coalesceWindowMs: 0,
    pruneIntervalMs: Number.POSITIVE_INFINITY,
  });
  opened.queue = queue;
  const refs = new RefLeaseManager({
    database: bindRefLeaseStateDb(stateDb),
    git: createDirectGitRunner(),
    repoPath: repo,
  });
  const lease = await refs.acquireRefLease({ ref: FEATURE_REF, holder: HOLDER, ttlMs: 120_000 });
  const stack: Stack = {
    repo,
    stateDb,
    queue,
    holds: bindTaskHolds(stateDb),
    lifecycles: bindLifecycles(stateDb),
    outbox: bindOutbox(stateDb),
    cas,
    refs,
    oldSha,
    newSha,
    digest: put.hash,
    refEpoch: lease.epoch,
  };
  return stack;
}

function accept(
  stack: Stack,
  label: string,
  input: { readonly epoch: number; readonly expectedOldSha: string },
): ReturnType<typeof acceptVerifiedCandidate> {
  return acceptVerifiedCandidate(
    {
      stateDb: stack.stateDb,
      queue: stack.queue,
      holds: stack.holds,
      lifecycles: stack.lifecycles,
      outbox: stack.outbox,
      cas: stack.cas,
      refs: stack.refs,
    },
    {
      opId: `accept-${label}-${stack.digest.slice(0, 8)}`,
      task: TASK,
      attempt: ATTEMPT,
      epoch: input.epoch,
      artifactDigest: stack.digest,
      featureRef: FEATURE_REF,
      expectedOldSha: input.expectedOldSha,
      newSha: stack.newSha,
      refHolder: HOLDER,
      refEpoch: stack.refEpoch,
    },
  );
}

function seedCandidate(writer: SqliteConnection, commit: string, digest: string): void {
  const payload = JSON.stringify({
    schema: "candidate@1",
    task: TASK,
    attempt: ATTEMPT,
    epoch: EPOCH,
    commit,
    changed_paths: ["src/kitchen/print.ts"],
    diffstat: { files: 1, insertions: 12, deletions: 0 },
    exports_changed: [{ symbol: "KitchenPage", kind: "added" }],
    dependency_intents: [],
    migration_intents: [],
    wiring_needs: [{ kind: "route", path: "/kitchen", component: "KitchenPage" }],
    contracts_verified: [{ id: "C-014", v: 1 }],
    detected_touches: [],
  });
  writer.exec("BEGIN IMMEDIATE");
  try {
    writer.prepare(
      `INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'planner', 'test', 0)`,
    ).run();
    writer.prepare(`UPDATE meta SET value = ? WHERE key = 'last_rev'`).run(["1"]);
    const node = writer.prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, ?, 1, ?, ?, '', ?, 'CS-1', 1, 1)`,
    );
    const add = (id: string, kind: string, title: string, fields: Record<string, unknown> = {}): void => {
      node.run([id, kind, `h-${id}-1`, title, JSON.stringify({ feature: "F12", ...fields })]);
    };
    add("F12", "feature", "Kitchen print");
    add("R17", "rule", "Cutoff rule");
    add("SI-212", "spec_item", "Locked totals after cutoff");
    add(TASK, "task", "Kitchen print page", { touches: ["route"] });
    add("AC-31", "check", "Totals grouped by dish");
    add("C-014", "contract", "kitchen-totals");
    add("C-EMPTY", "contract", "unused-contract");
    const edge = writer.prepare(
      `INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, 'CS-1', 1)`,
    );
    edge.run([TASK, "implements", "SI-212"]);
    edge.run(["AC-31", "verifies", "SI-212"]);
    edge.run([TASK, "consumes_contract", "C-014"]);
    writer
      .prepare(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
         VALUES (?, 'F12', 'CLEAN_VERIFY', 'Mid', ?, 1, 1)`,
      )
      .run([TASK, EPOCH]);
    writer
      .prepare(
        `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
         VALUES (?, ?, 1, ?, 1, 'own', 'm', 'c', 'base-1', 'submitted', 1)`,
      )
      .run([ATTEMPT, TASK, EPOCH]);
    writer.prepare(`UPDATE task_runtime SET holder_attempt = ? WHERE task = ?`).run([ATTEMPT, TASK]);
    writer
      .prepare(
        `INSERT INTO candidates(id, task, attempt, epoch, commit_sha, payload, received_at)
         VALUES ('CAND-1', ?, ?, ?, ?, ?, 1)`,
      )
      .run([TASK, ATTEMPT, EPOCH, commit, payload]);
    writer
      .prepare(
        `INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)
         VALUES ('AC-31', ?, 1, ?, 'pass', 'VR-C25', 10)`,
      )
      .run([ATTEMPT, digest]);
    writer
      .prepare(
        `INSERT INTO artifacts(id, hash, kind, bytes, retention, created_at) VALUES
          ('ART-DIGEST', ?, 'diff', 20, 'diagnostic', 1),
          ('VR-C25', 'receipt-hash', 'trace', 8, 'diagnostic', 1)`,
      )
      .run([digest]);
    writer
      .prepare(
        `INSERT INTO read_sets(attempt, node, version, hash, how) VALUES (?, 'R17', 1, 'hash-r17', 'pushed')`,
      )
      .run([ATTEMPT]);
    writer
      .prepare(
        `INSERT INTO edge_read_sets(attempt, node, dir, type, version) VALUES (?, 'C-EMPTY', 'in', 'consumes_contract', 0)`,
      )
      .run([ATTEMPT]);
    writer
      .prepare(
        `INSERT INTO search_reads(attempt, query_hash, query, result_hash, rev) VALUES (?, 'q-empty', ?, ?, 1)`,
      )
      .run([ATTEMPT, JSON.stringify({ query: "no-such-fact-c25", filters: {} }), EMPTY_SEARCH_RESULT_HASH]);
    writer.exec("COMMIT");
  } catch (error) {
    writer.exec("ROLLBACK");
    throw error;
  }
}

function taskRow(writer: SqliteConnection): { state: string; pending: number; done: number } {
  const row = writer
    .prepare(
      `SELECT t.state AS state, t.submission_pending AS pending, s.done AS done
         FROM task_runtime t JOIN task_states s ON s.state = t.state
        WHERE t.task = ?`,
    )
    .get([TASK]);
  return { state: text(row, "state"), pending: number(row, "pending"), done: number(row, "done") };
}

function attemptRow(writer: SqliteConnection): { state: string; outcome: string | null } {
  const row = writer.prepare(`SELECT state, outcome FROM attempts WHERE id = ?`).get([ATTEMPT]);
  const outcome = cell(row, "outcome");
  return { state: text(row, "state"), outcome: typeof outcome === "string" ? outcome : null };
}

function outboxTypes(writer: SqliteConnection): string[] {
  return writer
    .prepare(`SELECT type FROM outbox WHERE subject = ? ORDER BY seq`)
    .all([TASK])
    .map((row) => text(row, "type"));
}

function cell(row: unknown, key: string): unknown {
  if (row === null || typeof row !== "object") throw new Error(`missing row for ${key}`);
  return Reflect.get(row, key);
}

function text(row: unknown, key: string): string {
  const value = cell(row, key);
  if (typeof value !== "string") throw new Error(`${key} is not text`);
  return value;
}

function number(row: unknown, key: string): number {
  const value = cell(row, key);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`${key} is not a number`);
}

function schemaPath(name: string): string {
  return fileURLToPath(new URL(`../../../../schema/${name}`, import.meta.url));
}

function initRepo(repo: string): { oldSha: string; newSha: string } {
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Ada Lovelace"]);
  git(repo, ["config", "user.email", "ada@example.com"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(repo, "README.md"), "seed\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "seed"]);
  const oldSha = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(repo, "README.md"), "candidate\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "candidate"]);
  const newSha = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["update-ref", FEATURE_REF, oldSha]);
  return { oldSha, newSha };
}

function git(repo: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}
