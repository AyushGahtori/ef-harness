import { afterEach, describe, expect, it } from "vitest";
import {
  DuplicateCandidateError,
  IllegalTaskTransitionError,
  StaleEpochError,
  SubmissionAlreadyFinishedError,
} from "../../src/holds/index.js";
import { countRows, openHarness, queryText, readRuntime, seedTask, setRuntime, type HarnessHandle } from "./fixture.js";

let handle: HarnessHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

function setup(): HarnessHandle {
  handle = openHarness();
  seedTask(handle.db, "T07");
  seedTask(handle.db, "T08");
  return handle;
}

describe("submitAndAcceptCandidate and finishSubmission", () => {
  it("loads submit, accept, and finish statements verbatim from schema/queries.sql", () => {
    const { queries } = setup();
    const submit = queryText(queries, "submit_candidate");
    const accept = queryText(queries, "accept_submission");
    const finish = queryText(queries, "finish_submission");
    expect(submit).toContain("holder_attempt = :attempt AND epoch = :epoch");
    expect(submit).toContain("INSERT INTO candidates");
    expect(accept).toContain("state = 'STATIC_AUDIT', submission_pending = 1");
    expect(accept).toContain("state IN ('LEASED','CODING')");
    expect(finish).toContain("submission_pending = 0");
    expect(finish).toContain("epoch = :epoch AND submission_pending = 1");
    expect(finish).toContain("WHEN :next_state IN ('ESCALATED','EXHAUSTED') THEN NULL");
  });

  it("sets submission_pending atomically and keeps the lease through sweep at now = 999999999", () => {
    const { db, repo, queries } = setup();
    setRuntime(db, "T07", { state: "CODING", epoch: 2, leaseExpiresAt: 1, submissionPending: 0 });
    setRuntime(db, "T08", { state: "CODING", epoch: 1, leaseExpiresAt: 1, submissionPending: 0, attempt: "A-T08-1" });

    const receipt = repo.submitAndAcceptCandidate({
      opId: "op-submit-1",
      candidateId: "CAND-1",
      task: "T07",
      attempt: "A-T07-1",
      epoch: 2,
      commitSha: "abc123",
      payload: '{"diff":"print"}',
      now: 80,
      rev: 6,
    });
    expect(receipt).toMatchObject({
      candidateId: "CAND-1",
      task: "T07",
      attempt: "A-T07-1",
      epoch: 2,
      commitSha: "abc123",
      state: "STATIC_AUDIT",
      submissionPending: 1,
    });
    expect(readRuntime(db, "T07")).toMatchObject({
      state: "STATIC_AUDIT",
      epoch: 2,
      holderAttempt: "A-T07-1",
      leaseExpiresAt: 1,
      submissionPending: 1,
    });
    const attempt = db.prepare("SELECT state, ended_at FROM attempts WHERE id = 'A-T07-1'").get() as {
      state: string;
      ended_at: number | null;
    };
    expect(attempt).toEqual({ state: "submitted", ended_at: null });

    const swept = db.prepare(queryText(queries, "sweep_expired_leases")).all({ now: 999999999, rev: 7 }) as Array<{
      task: string;
    }>;
    expect(swept.map((row) => row.task)).toEqual(["T08"]);
    expect(readRuntime(db, "T07").submissionPending).toBe(1);
    expect(readRuntime(db, "T07").state).toBe("STATIC_AUDIT");
    expect(readRuntime(db, "T08").state).toBe("READY");
    expect(readRuntime(db, "T08").holderAttempt).toBeNull();
  });

  it("returns the original receipt for the same task, attempt, and commit without a second verification", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "LEASED", epoch: 4, leaseExpiresAt: 10 });
    const first = repo.submitAndAcceptCandidate({
      opId: "op-1",
      candidateId: "CAND-1",
      task: "T07",
      attempt: "A-T07-1",
      epoch: 4,
      commitSha: "def",
      payload: "{}",
      now: 100,
      rev: 3,
    });
    const retry = repo.submitAndAcceptCandidate({
      opId: "op-1",
      candidateId: "CAND-1",
      task: "T07",
      attempt: "A-T07-1",
      epoch: 4,
      commitSha: "def",
      payload: "{}",
      now: 250,
      rev: 3,
    });
    const renamed = repo.submitAndAcceptCandidate({
      opId: "op-2",
      candidateId: "CAND-2",
      task: "T07",
      attempt: "A-T07-1",
      epoch: 4,
      commitSha: "def",
      payload: "{}",
      now: 260,
      rev: 4,
    });
    expect(retry).toEqual(first);
    expect(renamed.candidateId).toBe("CAND-1");
    expect(countRows(db, "candidates")).toBe(1);
    expect(countRows(db, "operations")).toBe(2);
    expect(readRuntime(db, "T07").state).toBe("STATIC_AUDIT");
    expect(readRuntime(db, "T07").submissionPending).toBe(1);
  });

  it("rejects a different payload or a reused op_id for a different request", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "CODING", epoch: 1 });
    repo.submitAndAcceptCandidate({
      opId: "op-1",
      candidateId: "CAND-1",
      task: "T07",
      attempt: "A-T07-1",
      epoch: 1,
      commitSha: "def",
      payload: '{"n":1}',
      now: 5,
      rev: 2,
    });
    expect(() =>
      repo.submitAndAcceptCandidate({
        opId: "op-9",
        candidateId: "CAND-9",
        task: "T07",
        attempt: "A-T07-1",
        epoch: 1,
        commitSha: "def",
        payload: '{"n":2}',
        now: 6,
        rev: 2,
      }),
    ).toThrow(DuplicateCandidateError);
    expect(() =>
      repo.submitAndAcceptCandidate({
        opId: "op-1",
        candidateId: "CAND-1",
        task: "T07",
        attempt: "A-T07-1",
        epoch: 1,
        commitSha: "def",
        payload: '{"n":2}',
        now: 7,
        rev: 2,
      }),
    ).toThrow(DuplicateCandidateError);
    expect(countRows(db, "candidates")).toBe(1);
    const payload = db.prepare("SELECT payload FROM candidates").get() as { payload: string };
    expect(payload.payload).toBe('{"n":1}');
  });

  it("returns StaleEpochError for an older epoch and leaves candidates empty", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "CODING", epoch: 1, attempt: "A-T07-1" });
    db.prepare("UPDATE attempts SET state = 'fenced', ended_at = 90 WHERE id = 'A-T07-1'").run();
    db.prepare(
      "UPDATE task_runtime SET epoch = 2, holder_attempt = NULL, state = 'READY', lease_expires_at = NULL WHERE task = 'T07'",
    ).run();
    expect(() =>
      repo.submitAndAcceptCandidate({
        candidateId: "CAND-LATE",
        task: "T07",
        attempt: "A-T07-1",
        epoch: 1,
        commitSha: "def",
        payload: "{}",
        now: 100,
        rev: 4,
      }),
    ).toThrow(StaleEpochError);
    expect(countRows(db, "candidates")).toBe(0);
    expect(readRuntime(db, "T07")).toMatchObject({ state: "READY", epoch: 2, holderAttempt: null });
  });

  it("rejects a fenced attempt even when the holder and epoch still match", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "CODING", epoch: 5, attempt: "A-T07-1" });
    db.prepare("UPDATE attempts SET state = 'fenced' WHERE id = 'A-T07-1'").run();
    expect(() => repo.assertCurrentEpoch({ task: "T07", attempt: "A-T07-1", epoch: 5 })).toThrow(StaleEpochError);
    expect(() =>
      repo.submitAndAcceptCandidate({
        candidateId: "CAND-FENCED",
        task: "T07",
        attempt: "A-T07-1",
        epoch: 5,
        commitSha: "fff",
        payload: "{}",
        now: 3,
        rev: 2,
      }),
    ).toThrow(StaleEpochError);
    expect(countRows(db, "candidates")).toBe(0);
    expect(readRuntime(db, "T07").state).toBe("CODING");
  });

  it("rolls back the candidate when accept_submission matches no LEASED or CODING row", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "READY", epoch: 2, attempt: "A-T07-1" });
    expect(() =>
      repo.submitAndAcceptCandidate({
        candidateId: "CAND-READY",
        task: "T07",
        attempt: "A-T07-1",
        epoch: 2,
        commitSha: "ready",
        payload: "{}",
        now: 4,
        rev: 2,
      }),
    ).toThrow(IllegalTaskTransitionError);
    expect(countRows(db, "candidates")).toBe(0);
    expect(readRuntime(db, "T07").state).toBe("READY");
  });

  it("finishes only through CLEAN_VERIFY and rejects a second finish", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "CODING", epoch: 6, leaseExpiresAt: 1 });
    repo.submitAndAcceptCandidate({
      opId: "op-finish",
      candidateId: "CAND-7",
      task: "T07",
      attempt: "A-T07-1",
      epoch: 6,
      commitSha: "sha-7",
      payload: "{}",
      now: 10,
      rev: 3,
    });
    expect(() =>
      repo.finishSubmission({ task: "T07", epoch: 6, nextState: "ACCEPTED", now: 11, rev: 4 }),
    ).toThrow(IllegalTaskTransitionError);
    expect(readRuntime(db, "T07")).toMatchObject({ state: "STATIC_AUDIT", submissionPending: 1, holderAttempt: "A-T07-1" });

    const findings = repo.finishSubmission({ task: "T07", epoch: 6, nextState: "CODING", now: 12, rev: 5 });
    expect(findings).toMatchObject({
      fromState: "STATIC_AUDIT",
      nextState: "CODING",
      submissionPending: 0,
      holderAttempt: "A-T07-1",
      attemptState: "running",
      attemptEndedAt: null,
    });

    setRuntime(db, "T07", {
      state: "CODING",
      epoch: 6,
      leaseExpiresAt: 1,
      submissionPending: 0,
      attempt: "A-T07-1",
    });
    repo.submitAndAcceptCandidate({
      opId: "op-finish-2",
      candidateId: "CAND-8",
      task: "T07",
      attempt: "A-T07-1",
      epoch: 6,
      commitSha: "sha-8",
      payload: "{}",
      now: 13,
      rev: 6,
    });
    const clean = repo.transitionTaskState({ task: "T07", to: "CLEAN_VERIFY", epoch: 6, rev: 7, now: 14 });
    expect(clean).toMatchObject({ state: "CLEAN_VERIFY", submissionPending: 1, epoch: 6 });

    const accepted = repo.finishSubmission({ task: "T07", epoch: 6, nextState: "ACCEPTED", now: 15, rev: 8 });
    expect(accepted).toMatchObject({
      fromState: "CLEAN_VERIFY",
      nextState: "ACCEPTED",
      submissionPending: 0,
      holderAttempt: "A-T07-1",
      attemptState: "accepted",
      attemptEndedAt: 15,
    });
    expect(readRuntime(db, "T07").submissionPending).toBe(0);

    expect(() =>
      repo.finishSubmission({ task: "T07", epoch: 6, nextState: "ACCEPTED", now: 16, rev: 9 }),
    ).toThrow(SubmissionAlreadyFinishedError);
    expect(readRuntime(db, "T07")).toMatchObject({ state: "ACCEPTED", submissionPending: 0, holderAttempt: "A-T07-1" });
    const ended = db.prepare("SELECT ended_at FROM attempts WHERE id = 'A-T07-1'").get() as { ended_at: number };
    expect(ended.ended_at).toBe(15);
  });

  it("clears the holder when verification finishes ESCALATED or EXHAUSTED", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "STATIC_AUDIT", epoch: 2, submissionPending: 1 });
    const exhausted = repo.finishSubmission({ task: "T07", epoch: 2, nextState: "EXHAUSTED", now: 20, rev: 3 });
    expect(exhausted.holderAttempt).toBeNull();
    expect(exhausted.attemptState).toBe("rejected");
    expect(readRuntime(db, "T07").state).toBe("EXHAUSTED");

    setRuntime(db, "T08", { state: "CLEAN_VERIFY", epoch: 3, submissionPending: 1, attempt: "A-T08-1" });
    const escalated = repo.finishSubmission({ task: "T08", epoch: 3, nextState: "ESCALATED", now: 21, rev: 4 });
    expect(escalated).toMatchObject({ nextState: "ESCALATED", holderAttempt: null, attemptState: "rejected" });
    expect(readRuntime(db, "T08").holderAttempt).toBeNull();
  });

  it("rejects finishSubmission when the epoch does not match", () => {
    const { db, repo } = setup();
    setRuntime(db, "T07", { state: "CLEAN_VERIFY", epoch: 4, submissionPending: 1 });
    expect(() =>
      repo.finishSubmission({ task: "T07", epoch: 3, nextState: "ACCEPTED", now: 1, rev: 2 }),
    ).toThrow(StaleEpochError);
    expect(readRuntime(db, "T07")).toMatchObject({ state: "CLEAN_VERIFY", epoch: 4, submissionPending: 1 });
  });
});
