import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  LeaseExpiredError,
  MissingGitIdentityError,
  NamespaceViolationError,
  ProtectedBranchError,
  RefLeaseHeldError,
  StaleRefLeaseError,
  ZERO_OID,
  createDirectGitRunner,
  issueLandingAuthorization,
  openRefLeaseStateDb,
  RefLeaseManager,
  type GitExecRequest,
  type GitRunner,
} from "../../src/refs/index.js";

const INTEGRATION = "refs/heads/harness/integration";
const FEATURE = "refs/heads/harness/f/F12";
const cleaners: Array<() => void> = [];

afterEach(() => {
  for (const clean of cleaners.splice(0)) {
    try {
      clean();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/ENOTEMPTY|EBUSY|EPERM|ENOENT/.test(message)) throw error;
    }
  }
});

describe("ref leases", { timeout: 30_000 }, () => {
  it("stores ref_leases with the state schema columns", () => {
    const repo = initRepo();
    const database = openRefLeaseStateDb(path.join(repo, "state.db"));
    cleaners.push(() => database.close());
    const names = database.all("PRAGMA table_info(ref_leases)", []).map((row) => row.name);
    expect(names).toEqual(["ref", "holder", "epoch", "expected_sha", "expires_at"]);
  });

  it("fences leases by epoch and rejects a stale holder before git", () => {
    const repo = initRepo();
    const root = rev(repo);
    point(repo, INTEGRATION, root);
    const next = child(repo, root, "next");
    let now = 1_000_000;
    const runner = new RecordingGitRunner(createDirectGitRunner());
    const { manager } = openManager(repo, { clock: () => now, git: runner });

    const first = manager.acquireRefLease({ ref: INTEGRATION, holder: "holder-a", ttlMs: 5_000 });
    expect(first).toMatchObject({ epoch: 1, holder: "holder-a", expectedSha: root, expiresAt: 1_005_000 });
    expect(() => manager.acquireRefLease({ ref: INTEGRATION, holder: "holder-b", ttlMs: 5_000 })).toThrow(
      RefLeaseHeldError,
    );
    expect(manager.readRefLease(INTEGRATION)?.epoch).toBe(1);

    now = 1_004_000;
    const renewed = manager.renewRefLease({
      ref: INTEGRATION,
      holder: "holder-a",
      epoch: 1,
      ttlMs: 5_000,
    });
    expect(renewed).toMatchObject({ epoch: 1, expiresAt: 1_009_000 });

    now = 1_009_000;
    expect(() =>
      manager.renewRefLease({ ref: INTEGRATION, holder: "holder-a", epoch: 1, ttlMs: 5_000 }),
    ).toThrow(LeaseExpiredError);
    const beforeExpired = runner.calls.length;
    expect(() =>
      manager.advanceRefCas({
        ref: INTEGRATION,
        holder: "holder-a",
        epoch: 1,
        newSha: next,
        expectedOldSha: root,
      }),
    ).toThrow(LeaseExpiredError);
    expect(updateRefs(runner.calls.slice(beforeExpired))).toEqual([]);
    expect(rev(repo, INTEGRATION)).toBe(root);

    const second = manager.acquireRefLease({ ref: INTEGRATION, holder: "holder-b", ttlMs: 5_000 });
    expect(second.epoch).toBe(2);
    const beforeStale = runner.calls.length;
    expect(() =>
      manager.advanceRefCas({
        ref: INTEGRATION,
        holder: "holder-a",
        epoch: 1,
        newSha: next,
        expectedOldSha: root,
      }),
    ).toThrow(StaleRefLeaseError);
    expect(updateRefs(runner.calls.slice(beforeStale))).toEqual([]);
    expect(rev(repo, INTEGRATION)).toBe(root);

    const advanced = manager.advanceRefCas({
      ref: INTEGRATION,
      holder: "holder-b",
      epoch: 2,
      newSha: next,
      expectedOldSha: root,
    });
    expect(advanced).toEqual({ ok: true, ref: INTEGRATION, newSha: next, previousSha: root });
    expect(rev(repo, INTEGRATION)).toBe(next);
    expect(manager.readRefLease(INTEGRATION)?.expectedSha).toBe(next);
  });

  it("increments the epoch when a released holder acquires again", () => {
    const repo = initRepo();
    const root = rev(repo);
    point(repo, INTEGRATION, root);
    const { manager } = openManager(repo);
    const lease = manager.acquireRefLease({ ref: INTEGRATION, holder: "holder-a", ttlMs: 5_000 });
    manager.releaseRefLease({ ref: INTEGRATION, holder: "holder-a", epoch: lease.epoch });
    const again = manager.acquireRefLease({ ref: INTEGRATION, holder: "holder-a", ttlMs: 5_000 });
    expect(again.epoch).toBe(lease.epoch + 1);
    expect(() =>
      manager.advanceRefCas({
        ref: INTEGRATION,
        holder: "holder-a",
        epoch: lease.epoch,
        newSha: child(repo, root, "later"),
        expectedOldSha: root,
      }),
    ).toThrow(StaleRefLeaseError);
    expect(rev(repo, INTEGRATION)).toBe(root);
  });

  it("returns cas_mismatch with the actual sha when the ref moves concurrently", () => {
    const repo = initRepo();
    const root = rev(repo);
    point(repo, INTEGRATION, root);
    const side = child(repo, root, "side");
    const wanted = child(repo, root, "wanted");
    const inner = createDirectGitRunner();
    const racing = new RecordingGitRunner(inner);
    let raced = false;
    const git = wrap(racing, (request, next) => {
      if (!raced && request.args[0] === "update-ref" && request.args[1] === INTEGRATION) {
        raced = true;
        gitExec(repo, ["update-ref", INTEGRATION, side, root]);
      }
      return next();
    });
    const { manager } = openManager(repo, { git });
    manager.acquireRefLease({ ref: INTEGRATION, holder: "integrator", ttlMs: 60_000 });

    const result = manager.advanceRefCas({
      ref: INTEGRATION,
      holder: "integrator",
      epoch: 1,
      newSha: wanted,
      expectedOldSha: root,
    });

    expect(raced).toBe(true);
    expect(result).toEqual({ ok: false, reason: "cas_mismatch", actualSha: side });
    expect(rev(repo, INTEGRATION)).toBe(side);
    expect(manager.readRefLease(INTEGRATION)?.expectedSha).toBe(root);
    expect(racing.calls.some((call) => call.args[0] === "branch" || call.args[0] === "push")).toBe(false);
  });

  it("creates a missing branch with the zero OID and refuses to clobber an existing one", () => {
    const repo = initRepo();
    const root = rev(repo);
    const created = "refs/heads/harness/f/new";
    const { manager } = openManager(repo);
    manager.acquireRefLease({ ref: created, holder: "integrator", ttlMs: 60_000 });

    const first = manager.advanceRefCas({
      ref: created,
      holder: "integrator",
      epoch: 1,
      newSha: root,
      expectedOldSha: ZERO_OID,
    });
    expect(first).toMatchObject({ ok: true, newSha: root, previousSha: ZERO_OID });
    expect(rev(repo, created)).toBe(root);

    const second = manager.advanceRefCas({
      ref: created,
      holder: "integrator",
      epoch: 1,
      newSha: child(repo, root, "other"),
      expectedOldSha: ZERO_OID,
    });
    expect(second).toEqual({ ok: false, reason: "cas_mismatch", actualSha: root });
    expect(rev(repo, created)).toBe(root);
    expect(manager.readRefLease(created)?.expectedSha).toBe(root);
  });

  it("blocks developer branches without landing authorization and allows a consented landing", () => {
    const repo = initRepo();
    const root = rev(repo);
    const next = child(repo, root, "land");
    point(repo, "refs/heads/develop", root);
    const runner = new RecordingGitRunner(createDirectGitRunner());
    const { manager } = openManager(repo, {
      git: runner,
      developerBaseRef: "refs/heads/develop",
    });

    const before = runner.calls.length;
    expect(() =>
      manager.advanceRefCas({ ref: "refs/heads/main", newSha: next, expectedOldSha: root }),
    ).toThrow(NamespaceViolationError);
    expect(() =>
      manager.advanceRefCas({ ref: "refs/heads/MAIN", newSha: next, expectedOldSha: root }),
    ).toThrow(NamespaceViolationError);
    expect(() =>
      manager.advanceRefCas({ ref: "refs/heads/develop", newSha: next, expectedOldSha: root }),
    ).toThrow(NamespaceViolationError);
    expect(() =>
      manager.advanceRefCas({ ref: "refs/heads/topic", newSha: next, expectedOldSha: root }),
    ).toThrow(NamespaceViolationError);
    expect(updateRefs(runner.calls.slice(before))).toEqual([]);
    expect(rev(repo, "refs/heads/main")).toBe(root);
    expect(rev(repo, "refs/heads/develop")).toBe(root);

    expect(() =>
      issueLandingAuthorization({
        ref: "refs/heads/topic",
        consentedBy: "Ada",
        expiresAtMs: Date.now() + 60_000,
        userConsent: true,
        developerBaseRef: "refs/heads/develop",
      }),
    ).toThrow(NamespaceViolationError);

    const expired = issueLandingAuthorization({
      ref: "refs/heads/main",
      consentedBy: "Ada",
      expiresAtMs: 1,
      userConsent: true,
    });
    expect(() =>
      manager.advanceRefCas({
        ref: "refs/heads/main",
        newSha: next,
        expectedOldSha: root,
        landingAuthorization: expired,
      }),
    ).toThrow(NamespaceViolationError);

    const mainAuth = issueLandingAuthorization({
      ref: "refs/heads/main",
      consentedBy: "Ada Lovelace",
      expiresAtMs: Date.now() + 60_000,
      userConsent: true,
    });
    expect(
      manager.advanceRefCas({
        ref: "refs/heads/main",
        newSha: next,
        expectedOldSha: root,
        landingAuthorization: mainAuth,
      }),
    ).toMatchObject({ ok: true, newSha: next });
    expect(rev(repo, "refs/heads/main")).toBe(next);

    const developAuth = issueLandingAuthorization({
      ref: "refs/heads/develop",
      consentedBy: "Ada Lovelace",
      expiresAtMs: Date.now() + 60_000,
      userConsent: true,
      developerBaseRef: "refs/heads/develop",
    });
    expect(
      manager.advanceRefCas({
        ref: "refs/heads/develop",
        newSha: next,
        expectedOldSha: root,
        landingAuthorization: developAuth,
      }),
    ).toMatchObject({ ok: true, newSha: next });

    const snapshot = manager.advanceRefCas({
      ref: "refs/harness/snapshots/proj/1",
      newSha: root,
      expectedOldSha: ZERO_OID,
    });
    expect(snapshot).toMatchObject({ ok: true });
    expect(rev(repo, "refs/harness/snapshots/proj/1")).toBe(root);
    const attempt = manager.advanceRefCas({
      ref: "refs/heads/harness/t/T03b/2",
      newSha: root,
      expectedOldSha: ZERO_OID,
    });
    expect(attempt).toMatchObject({ ok: true });
    const checkpoint = manager.advanceRefCas({
      ref: "refs/harness/checkpoints/T03b/1",
      newSha: root,
      expectedOldSha: ZERO_OID,
    });
    expect(checkpoint).toMatchObject({ ok: true });
    const state = manager.advanceRefCas({
      ref: "refs/heads/harness-state",
      newSha: root,
      expectedOldSha: ZERO_OID,
    });
    expect(state).toMatchObject({ ok: true });
  });

  it("squashes a leaf into one commit and merges a feature with two parents", () => {
    const repo = initRepo();
    const root = rev(repo);
    point(repo, INTEGRATION, root);
    point(repo, FEATURE, root);
    fs.writeFileSync(path.join(repo, "widget.txt"), "widget\n");
    gitExec(repo, ["add", "widget.txt"]);
    const tree = gitExec(repo, ["write-tree"]);
    const runner = new RecordingGitRunner(createDirectGitRunner());
    const { manager } = openManager(repo, { git: runner });
    manager.acquireRefLease({ ref: FEATURE, holder: "integrator", ttlMs: 60_000 });

    const message = [
      'Land the "widget" for $5 (100%)',
      "",
      "Harness-Task: DECOY",
      "Harness-Checks: decoy-receipt",
      "This remains body text.",
    ].join("\n");
    const squash = manager.createSquashCommit({
      featureRef: FEATURE,
      holder: "integrator",
      epoch: 1,
      treeSha: tree,
      parentSha: root,
      message,
      trailers: { feature: "F12", task: "T03b", attempt: "2", checks: "receipt-abc" },
      author: { kind: "agent", role: "Worker", agentId: "A0014" },
    });

    expect(squash.ok).toBe(true);
    if (!squash.ok) return;
    expect(squash.parents).toEqual([root]);
    expect(rev(repo, FEATURE)).toBe(squash.sha);
    expect(gitExec(repo, ["rev-list", "--count", `${root}..${FEATURE}`])).toBe("1");
    expect(gitExec(repo, ["merge-base", "--is-ancestor", root, FEATURE])).toBe("");
    const squashMeta = identityOf(repo, squash.sha);
    expect(squashMeta).toMatchObject({
      authorName: "Worker A0014",
      authorEmail: "A0014@harness.local",
      committerName: "Ada Lovelace",
      committerEmail: "ada@example.com",
    });
    const squashBody = gitExec(repo, ["log", "-1", "--format=%B", squash.sha]);
    expect(squashBody).toContain('Land the "widget" for $5 (100%)');
    expect(manager.parseHarnessTrailers(squashBody)).toMatchObject({
      feature: "F12",
      task: "T03b",
      attempt: "2",
      checks: "receipt-abc",
    });
    const commitTree = runner.calls.find((call) => call.args[0] === "commit-tree");
    expect(commitTree?.args).toEqual(["commit-tree", tree, "-p", root, "-F", "-"]);
    expect(commitTree?.stdin).toContain('Land the "widget" for $5 (100%)');
    expect(commitTree?.args.join(" ")).not.toContain("$5");
    expect(commitTree?.env?.GIT_AUTHOR_NAME).toBe("Worker A0014");
    const featureUpdate = runner.calls.find(
      (call) => call.args[0] === "update-ref" && call.args[1] === FEATURE,
    );
    expect(featureUpdate?.args).toEqual(["update-ref", FEATURE, squash.sha, root]);
    expect(runner.calls.some((call) => call.args[0] === "branch" || call.args[0] === "push" || call.args[0] === "merge")).toBe(
      false,
    );

    manager.acquireRefLease({ ref: INTEGRATION, holder: "project-integrator", ttlMs: 60_000 });
    const merge = manager.createMergeCommit({
      integrationRef: INTEGRATION,
      featureRef: FEATURE,
      holder: "project-integrator",
      epoch: 1,
      treeSha: gitExec(repo, ["rev-parse", `${squash.sha}^{tree}`]),
      integrationSha: root,
      featureSha: squash.sha,
      message: "Merge feature F12",
      trailers: { feature: "F12", task: "T03b", attempt: "2", checks: "receipt-abc" },
      author: { kind: "agent", role: "Integrator", agentId: "I0007" },
    });
    expect(merge.ok).toBe(true);
    if (!merge.ok) return;
    expect(merge.parents).toEqual([root, squash.sha]);
    expect(rev(repo, INTEGRATION)).toBe(merge.sha);
    expect(rev(repo, INTEGRATION)).not.toBe(squash.sha);
    expect(gitExec(repo, ["rev-parse", `${merge.sha}^1`])).toBe(root);
    expect(gitExec(repo, ["rev-parse", `${merge.sha}^2`])).toBe(squash.sha);
    expect(identityOf(repo, merge.sha)).toMatchObject({
      authorName: "Integrator I0007",
      authorEmail: "I0007@harness.local",
      committerName: "Ada Lovelace",
      committerEmail: "ada@example.com",
    });
    expect(manager.parseHarnessTrailers(gitExec(repo, ["log", "-1", "--format=%B", merge.sha]))).toMatchObject({
      feature: "F12",
      task: "T03b",
      checks: "receipt-abc",
    });
  });

  it("preserves the developer as author for a human fix and still appends trailers", () => {
    const repo = initRepo();
    const root = rev(repo);
    point(repo, FEATURE, root);
    const tree = gitExec(repo, ["rev-parse", `${root}^{tree}`]);
    const { manager } = openManager(repo, {
      env: {
        GIT_AUTHOR_NAME: 'Ada "Lovelace" Jr',
        GIT_AUTHOR_EMAIL: "ada+box@example.com",
      },
    });
    manager.acquireRefLease({ ref: FEATURE, holder: "human", ttlMs: 60_000 });
    const published = manager.createSquashCommit({
      featureRef: FEATURE,
      holder: "human",
      epoch: 1,
      treeSha: tree,
      parentSha: root,
      message: "I fixed it myself",
      trailers: { feature: "F12", task: "T04", attempt: "1", checks: "receipt-human" },
      author: { kind: "human" },
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(identityOf(repo, published.sha)).toEqual({
      authorName: 'Ada "Lovelace" Jr',
      authorEmail: "ada+box@example.com",
      committerName: "Ada Lovelace",
      committerEmail: "ada@example.com",
    });
    expect(manager.parseHarnessTrailers(gitExec(repo, ["log", "-1", "--format=%B", published.sha]))).toMatchObject({
      task: "T04",
      checks: "receipt-human",
    });
  });

  it("fails upfront with MissingGitIdentityError when committer identity is absent", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ef-refs-"));
    cleaners.push(() => fs.rmSync(repo, { recursive: true, force: true }));
    gitExec(repo, ["init", "-b", "main"]);
    const empty = path.join(repo, "empty-gitconfig");
    fs.writeFileSync(empty, "");
    const runner = new RecordingGitRunner(createDirectGitRunner());
    const { manager } = openManager(repo, {
      git: runner,
      env: {
        GIT_CONFIG_GLOBAL: empty,
        GIT_CONFIG_SYSTEM: empty,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Should Not Bypass",
        GIT_AUTHOR_EMAIL: "bypass@example.com",
      },
    });

    expect(() =>
      manager.createSquashCommit({
        featureRef: FEATURE,
        holder: "integrator",
        epoch: 1,
        treeSha: "a".repeat(40),
        parentSha: "b".repeat(40),
        message: "should not commit",
        trailers: { feature: "F12", task: "T01", attempt: "1", checks: "receipt" },
        author: { kind: "agent", role: "Worker", agentId: "A0014" },
      }),
    ).toThrow(MissingGitIdentityError);
    try {
      manager.createMergeCommit({
        integrationRef: INTEGRATION,
        featureRef: FEATURE,
        holder: "integrator",
        epoch: 1,
        treeSha: "a".repeat(40),
        integrationSha: "b".repeat(40),
        featureSha: "c".repeat(40),
        message: "should not merge",
        trailers: { feature: "F12", task: "T01", attempt: "1", checks: "receipt" },
        author: { kind: "human" },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MissingGitIdentityError);
      expect((error as MissingGitIdentityError).missing).toEqual(["user.name", "user.email"]);
      expect((error as MissingGitIdentityError).prompt).toContain("one-time setup form");
    }
    expect(runner.calls.some((call) => call.args[0] === "commit-tree" || call.args[0] === "update-ref")).toBe(
      false,
    );
  });

  it("reconstructs accepted task ids and check receipts after a backup sha", () => {
    const repo = initRepo();
    const root = rev(repo);
    const tree = gitExec(repo, ["rev-parse", `${root}^{tree}`]);
    const before = commitMessage(repo, tree, root, trailerBody("T00", "receipt-old"));
    const accepted = commitMessage(repo, tree, before, trailerBody("T03b", "receipt-abc"));
    const plain = commitMessage(repo, tree, accepted, "A note without harness trailers\n");
    const later = commitMessage(repo, tree, plain, trailerBody("T09", "receipt-xyz"));
    point(repo, INTEGRATION, later);
    const { manager } = openManager(repo);

    const found = manager.findAcceptedCommitsSince({ sinceSha: before });
    expect(found.map((commit) => [commit.taskId, commit.checkReceipt, commit.featureId, commit.attempt])).toEqual([
      ["T03b", "receipt-abc", "F12", "1"],
      ["T09", "receipt-xyz", "F12", "1"],
    ]);
    expect(found.map((commit) => commit.sha)).toEqual([accepted, later]);
    expect(() => manager.findAcceptedCommitsSince({ sinceSha: before, untilRef: "refs/heads/main" })).toThrow(
      NamespaceViolationError,
    );
  });

  it("catches sqlite up after a crash without creating another commit", () => {
    const repo = initRepo();
    const root = rev(repo);
    point(repo, INTEGRATION, root);
    const { manager } = openManager(repo);
    manager.acquireRefLease({ ref: INTEGRATION, holder: "integrator", ttlMs: 60_000 });
    const tree = gitExec(repo, ["rev-parse", `${root}^{tree}`]);
    const landed = commitMessage(repo, tree, root, trailerBody("T03b", "receipt-abc"));
    gitExec(repo, ["update-ref", INTEGRATION, landed, root]);
    expect(manager.readRefLease(INTEGRATION)?.expectedSha).toBe(root);

    const [caught] = manager.reconcileRefLeases();
    expect(caught).toMatchObject({
      ref: INTEGRATION,
      previousExpectedSha: root,
      actualSha: landed,
      status: "caught_up",
      alreadyApplied: true,
      taskId: "T03b",
      checkReceipt: "receipt-abc",
    });
    expect(manager.readRefLease(INTEGRATION)?.expectedSha).toBe(landed);
    expect(rev(repo, INTEGRATION)).toBe(landed);

    const [again] = manager.reconcileRefLeases();
    expect(again).toMatchObject({ status: "in_sync", alreadyApplied: false, actualSha: landed });
    expect(rev(repo, INTEGRATION)).toBe(landed);
    expect(gitExec(repo, ["rev-list", "--count", INTEGRATION])).toBe("2");
  });

  it("records an external advance and lets the next compare-and-swap start from that sha", () => {
    const repo = initRepo();
    const root = rev(repo);
    point(repo, INTEGRATION, root);
    const { manager } = openManager(repo);
    manager.acquireRefLease({ ref: INTEGRATION, holder: "integrator", ttlMs: 60_000 });
    const external = child(repo, root, "developer commit from base sync");
    gitExec(repo, ["update-ref", INTEGRATION, external, root]);

    const [report] = manager.reconcileRefLeases();
    expect(report).toMatchObject({
      status: "external_advance",
      alreadyApplied: false,
      actualSha: external,
      previousExpectedSha: root,
    });
    expect(manager.readRefLease(INTEGRATION)?.expectedSha).toBe(external);

    const retried = child(repo, external, "retry merge");
    const advanced = manager.advanceRefCas({
      ref: INTEGRATION,
      holder: "integrator",
      epoch: 1,
      newSha: retried,
      expectedOldSha: external,
    });
    expect(advanced).toMatchObject({ ok: true, newSha: retried, previousSha: external });
    expect(rev(repo, INTEGRATION)).toBe(retried);
  });

  it("deletes merged attempt branches only after retention and never deletes wip branches", () => {
    const repo = initRepo();
    const root = rev(repo);
    const tree = gitExec(repo, ["rev-parse", `${root}^{tree}`]);
    const merged = child(repo, root, "merged attempt");
    const unmerged = commitMessage(repo, tree, merged, "still on the attempt\n");
    point(repo, FEATURE, merged);
    point(repo, "refs/heads/harness/t/T03b/2", merged);
    point(repo, "refs/heads/harness/t/T03b/3", unmerged);
    point(repo, "refs/heads/wip/human-export", root);
    const { manager } = openManager(repo);
    manager.acquireRefLease({ ref: FEATURE, holder: "integrator", ttlMs: 60_000 });

    expect(() =>
      manager.deleteMergedAttemptBranch({
        attemptRef: "refs/heads/wip/human-export",
        featureRef: FEATURE,
        holder: "integrator",
        epoch: 1,
        taskState: "MERGED_TO_FEATURE",
        mergedAtMs: 0,
        retentionMs: 0,
      }),
    ).toThrow(ProtectedBranchError);
    expect(rev(repo, "refs/heads/wip/human-export")).toBe(root);

    expect(
      manager.deleteMergedAttemptBranch({
        attemptRef: "refs/heads/harness/t/T03b/2",
        featureRef: FEATURE,
        holder: "integrator",
        epoch: 1,
        taskState: "ACCEPTED",
        mergedAtMs: 1_000,
        retentionMs: 0,
        nowMs: 5_000,
      }),
    ).toEqual({ ok: false, reason: "not_merged_to_feature" });
    expect(rev(repo, "refs/heads/harness/t/T03b/2")).toBe(merged);

    expect(
      manager.deleteMergedAttemptBranch({
        attemptRef: "refs/heads/harness/t/T03b/2",
        featureRef: FEATURE,
        holder: "integrator",
        epoch: 1,
        taskState: "MERGED_TO_FEATURE",
        mergedAtMs: 1_000,
        retentionMs: 5_000,
        nowMs: 5_000,
      }),
    ).toEqual({ ok: false, reason: "retention_active" });
    expect(rev(repo, "refs/heads/harness/t/T03b/2")).toBe(merged);

    expect(
      manager.deleteMergedAttemptBranch({
        attemptRef: "refs/heads/harness/t/T03b/3",
        featureRef: FEATURE,
        holder: "integrator",
        epoch: 1,
        taskState: "MERGED_TO_FEATURE",
        mergedAtMs: 1_000,
        retentionMs: 1_000,
        nowMs: 3_000,
      }),
    ).toEqual({ ok: false, reason: "not_ancestor" });
    expect(rev(repo, "refs/heads/harness/t/T03b/3")).toBe(unmerged);

    expect(
      manager.deleteMergedAttemptBranch({
        attemptRef: "refs/heads/harness/t/T03b/2",
        featureRef: FEATURE,
        holder: "integrator",
        epoch: 1,
        taskState: "MERGED_TO_FEATURE",
        mergedAtMs: 1_000,
        retentionMs: 1_000,
        nowMs: 2_000,
      }),
    ).toEqual({ ok: true, deletedSha: merged });
    expect(gitExists(repo, "refs/heads/harness/t/T03b/2")).toBe(false);
    expect(rev(repo, "refs/heads/wip/human-export")).toBe(root);
  });

  it("spawns git with shell false, long paths, and no prompt", () => {
    const calls: Array<{ args: readonly string[]; shell: false; windowsHide: true; input?: string; prompt: string | undefined }> = [];
    const runner = createDirectGitRunner({
      spawn(binary, args, options) {
        calls.push({
          args,
          shell: options.shell,
          windowsHide: options.windowsHide,
          ...(options.input !== undefined ? { input: options.input } : {}),
          prompt: options.env.GIT_TERMINAL_PROMPT,
        });
        expect(binary).toBe("git");
        return { status: 0, stdout: `${"d".repeat(40)}\n`, stderr: "" };
      },
    });
    const result = runner.execGit({
      cwd: os.tmpdir(),
      args: ["commit-tree", "e".repeat(40), "-F", "-"],
      stdin: 'quote " $ %\n',
    });
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(calls[0]).toMatchObject({
      shell: false,
      windowsHide: true,
      prompt: "0",
      input: 'quote " $ %\n',
    });
    expect(calls[0]?.args.slice(0, 2)).toEqual(["-c", "core.longpaths=true"]);
    expect(calls[0]?.args.join(" ")).not.toContain("quote");
    expect(runner.resolveGitBinary()).toBe("git");
  });
});

function openManager(
  repo: string,
  options?: {
    readonly clock?: () => number;
    readonly env?: NodeJS.ProcessEnv;
    readonly developerBaseRef?: string;
    readonly git?: GitRunner;
  },
): { manager: RefLeaseManager } {
  const database = openRefLeaseStateDb(path.join(repo, "state.db"));
  cleaners.push(() => database.close());
  const manager = new RefLeaseManager({
    database,
    git: options?.git ?? createDirectGitRunner(),
    repoPath: repo,
    ...(options?.clock ? { clock: options.clock } : {}),
    ...(options?.env ? { env: options.env } : {}),
    ...(options?.developerBaseRef ? { developerBaseRef: options.developerBaseRef } : {}),
  });
  return { manager };
}

function initRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ef-refs-"));
  cleaners.push(() => fs.rmSync(repo, { recursive: true, force: true }));
  gitExec(repo, ["init", "-b", "main"]);
  gitExec(repo, ["config", "user.name", "Ada Lovelace"]);
  gitExec(repo, ["config", "user.email", "ada@example.com"]);
  gitExec(repo, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(repo, "README.md"), "init\n");
  gitExec(repo, ["add", "README.md"]);
  gitExec(repo, ["commit", "-m", "init"]);
  return repo;
}

function rev(repo: string, ref = "HEAD"): string {
  return gitExec(repo, ["rev-parse", "--verify", "--end-of-options", ref]);
}

function point(repo: string, ref: string, sha: string): void {
  gitExec(repo, ["update-ref", ref, sha]);
}

function child(repo: string, parent: string, message: string): string {
  const tree = gitExec(repo, ["rev-parse", `${parent}^{tree}`]);
  return commitMessage(repo, tree, parent, `${message}\n`);
}

function commitMessage(repo: string, tree: string, parent: string, message: string): string {
  const stdin = message.endsWith("\n") ? message : `${message}\n`;
  return gitExec(repo, ["commit-tree", tree, "-p", parent, "-F", "-"], stdin);
}

function trailerBody(task: string, checks: string): string {
  return `Accept ${task}\n\nHarness-Feature: F12\nHarness-Task: ${task}\nHarness-Attempt: 1\nHarness-Checks: ${checks}\n`;
}

function identityOf(repo: string, sha: string): {
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
} {
  const [authorName, authorEmail, committerName, committerEmail] = gitExec(repo, [
    "log",
    "-1",
    "--format=%an%x1f%ae%x1f%cn%x1f%ce",
    sha,
  ]).split("\x1f");
  return {
    authorName: authorName ?? "",
    authorEmail: authorEmail ?? "",
    committerName: committerName ?? "",
    committerEmail: committerEmail ?? "",
  };
}

function gitExists(repo: string, ref: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--verify", "--end-of-options", ref], {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return result.status === 0;
}

function gitExec(repo: string, args: readonly string[], stdin?: string): string {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...(stdin !== undefined ? { input: stdin } : {}),
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function updateRefs(calls: readonly GitExecRequest[]): readonly (readonly string[])[] {
  return calls.filter((call) => call.args[0] === "update-ref").map((call) => call.args);
}

class RecordingGitRunner implements GitRunner {
  readonly calls: GitExecRequest[] = [];

  constructor(private readonly inner: GitRunner) {}

  resolveGitBinary(): string {
    return this.inner.resolveGitBinary();
  }

  execGit(request: GitExecRequest) {
    this.calls.push(request);
    return this.inner.execGit(request);
  }
}

function wrap(
  inner: GitRunner,
  around: (request: GitExecRequest, next: () => ReturnType<GitRunner["execGit"]>) => ReturnType<GitRunner["execGit"]>,
): GitRunner {
  return {
    resolveGitBinary: () => inner.resolveGitBinary(),
    execGit: (request) => around(request, () => inner.execGit(request)),
  };
}
