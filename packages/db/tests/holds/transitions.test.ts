import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  IllegalTaskTransitionError,
  StaleEpochError,
  TASK_STATE_FLAGS,
  TASK_STATE_TRANSITIONS,
  TASK_STATES,
  TaskHeldError,
  canonicalStateSqlPath,
  isLegalTaskTransition,
  type TaskState,
} from "../../src/holds/index.js";
import { openHarness, readRuntime, seedTask, setRuntime, type HarnessHandle } from "./fixture.js";

let handle: HarnessHandle | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
});

describe("task state machine", () => {
  it("matches every seeded task_states row, including claimable, done, and terminal flags", () => {
    const sql = readFileSync(canonicalStateSqlPath(), "utf8");
    const insert = /INSERT INTO task_states VALUES\s*([\s\S]*?);/.exec(sql);
    expect(insert?.[1]).toBeDefined();
    const parsed = [...(insert?.[1] ?? "").matchAll(/\('([A-Z_]+)',(\d),(\d),(\d)\)/g)].map((match) => ({
      state: match[1] ?? "",
      claimable: match[2] === "1",
      done: match[3] === "1",
      terminal: match[4] === "1",
    }));
    expect(parsed.map((row) => row.state)).toEqual([...TASK_STATES]);
    expect(parsed).toHaveLength(15);
    for (const row of parsed) {
      expect(TASK_STATE_FLAGS[row.state as TaskState]).toEqual({
        claimable: row.claimable,
        done: row.done,
        terminal: row.terminal,
      });
    }
    expect(TASK_STATES).not.toContain("HELD");
  });

  it("accepts every legal edge and rejects every other pair", () => {
    handle = openHarness();
    seedTask(handle.db, "T07");
    let legal = 0;
    for (const from of TASK_STATES) {
      for (const to of TASK_STATES) {
        const pending = from === "STATIC_AUDIT" || from === "CLEAN_VERIFY" ? 1 : 0;
        setRuntime(handle.db, "T07", {
          state: from,
          epoch: 4,
          submissionPending: pending,
          leaseExpiresAt: 20,
        });
        if (isLegalTaskTransition(from, to)) {
          legal += 1;
          const result = handle.repo.transitionTaskState({ task: "T07", to, epoch: 4, rev: 9, now: 30 });
          expect(result, `${from} -> ${to}`).toMatchObject({ fromState: from, state: to, epoch: 4 });
          const after = readRuntime(handle.db, "T07");
          expect(after.state, `${from} -> ${to}`).toBe(to);
          if (to === "STATIC_AUDIT" || to === "CLEAN_VERIFY") expect(after.submissionPending).toBe(1);
          if (to === "ACCEPTED") expect(after.submissionPending).toBe(0);
          if (to === "READY" || to === "ESCALATED" || to === "EXHAUSTED" || to === "CANCELLED" || to === "SUPERSEDED") {
            expect(after.holderAttempt, `${from} -> ${to}`).toBeNull();
          }
        } else {
          expect(
            () => handle?.repo.transitionTaskState({ task: "T07", to, epoch: 4, rev: 9, now: 30 }),
            `${from} -> ${to}`,
          ).toThrow(IllegalTaskTransitionError);
          expect(readRuntime(handle.db, "T07").state, `${from} -> ${to}`).toBe(from);
        }
      }
    }
    const declared = TASK_STATES.reduce((sum, state) => sum + TASK_STATE_TRANSITIONS[state].length, 0);
    expect(legal).toBe(declared);
    expect(declared).toBe(41);
  });

  it("rejects CODING -> ACCEPTED, STATIC_AUDIT -> ACCEPTED, and MERGED_TO_FEATURE -> READY", () => {
    handle = openHarness();
    seedTask(handle.db, "T07");
    setRuntime(handle.db, "T07", { state: "CODING", epoch: 1 });
    expect(() =>
      handle?.repo.transitionTaskState({ task: "T07", to: "ACCEPTED", epoch: 1, rev: 2, now: 3 }),
    ).toThrow(IllegalTaskTransitionError);
    expect(readRuntime(handle.db, "T07").state).toBe("CODING");

    setRuntime(handle.db, "T07", { state: "STATIC_AUDIT", epoch: 1, submissionPending: 1 });
    expect(() =>
      handle?.repo.transitionTaskState({ task: "T07", to: "ACCEPTED", epoch: 1, rev: 2, now: 3 }),
    ).toThrow(IllegalTaskTransitionError);
    expect(readRuntime(handle.db, "T07")).toMatchObject({ state: "STATIC_AUDIT", submissionPending: 1 });

    setRuntime(handle.db, "T07", { state: "MERGED_TO_FEATURE", epoch: 1, attempt: null, leaseExpiresAt: null });
    expect(() =>
      handle?.repo.transitionTaskState({ task: "T07", to: "READY", epoch: 1, rev: 2, now: 3 }),
    ).toThrow(IllegalTaskTransitionError);
    expect(readRuntime(handle.db, "T07").state).toBe("MERGED_TO_FEATURE");
  });

  it("refuses CLEAN_VERIFY unless submission_pending is set and the epoch matches", () => {
    handle = openHarness();
    seedTask(handle.db, "T07");
    setRuntime(handle.db, "T07", { state: "STATIC_AUDIT", epoch: 8, submissionPending: 0 });
    expect(() =>
      handle?.repo.transitionTaskState({ task: "T07", to: "CLEAN_VERIFY", epoch: 8, rev: 2, now: 3 }),
    ).toThrow(IllegalTaskTransitionError);
    expect(readRuntime(handle.db, "T07").state).toBe("STATIC_AUDIT");

    setRuntime(handle.db, "T07", { state: "STATIC_AUDIT", epoch: 8, submissionPending: 1 });
    expect(() =>
      handle?.repo.transitionTaskState({ task: "T07", to: "CLEAN_VERIFY", epoch: 7, rev: 2, now: 3 }),
    ).toThrow(StaleEpochError);
    expect(readRuntime(handle.db, "T07").epoch).toBe(8);

    const moved = handle.repo.transitionTaskState({
      task: "T07",
      to: "CLEAN_VERIFY",
      epoch: 8,
      rev: 4,
      now: 5,
    });
    expect(moved).toMatchObject({ state: "CLEAN_VERIFY", submissionPending: 1, epoch: 8 });
  });

  it("sends a human-owned task through STATIC_AUDIT before CLEAN_VERIFY and ACCEPTED", () => {
    handle = openHarness();
    seedTask(handle.db, "T07");
    setRuntime(handle.db, "T07", { state: "HUMAN_OWNED", epoch: 2, submissionPending: 0, leaseExpiresAt: null });
    const audit = handle.repo.transitionTaskState({ task: "T07", to: "STATIC_AUDIT", epoch: 2, rev: 3, now: 4 });
    expect(audit.submissionPending).toBe(1);
    const verify = handle.repo.transitionTaskState({ task: "T07", to: "CLEAN_VERIFY", epoch: 2, rev: 4, now: 5 });
    expect(verify.state).toBe("CLEAN_VERIFY");
    const accepted = handle.repo.transitionTaskState({ task: "T07", to: "ACCEPTED", epoch: 2, rev: 5, now: 6 });
    expect(accepted).toMatchObject({ state: "ACCEPTED", submissionPending: 0 });
    expect(readRuntime(handle.db, "T07").state).toBe("ACCEPTED");
  });

  it("refuses to claim or resume a held task", () => {
    handle = openHarness();
    seedTask(handle.db, "T07");
    setRuntime(handle.db, "T07", { state: "READY", epoch: 1, attempt: null, leaseExpiresAt: null });
    handle.repo.placeHold({ task: "T07", reason: "budget", source: "cap", now: 1, rev: 2 });
    expect(() =>
      handle?.repo.transitionTaskState({ task: "T07", to: "LEASED", epoch: 1, rev: 3, now: 4 }),
    ).toThrow(TaskHeldError);
    expect(readRuntime(handle.db, "T07").state).toBe("READY");

    handle.repo.releaseHold({ task: "T07", reason: "budget", source: "cap", now: 5, rev: 4 });
    setRuntime(handle.db, "T07", { state: "PARKED", epoch: 1 });
    handle.repo.placeHold({ task: "T07", reason: "ccr", source: "CCR-1", now: 6, rev: 5 });
    expect(() =>
      handle?.repo.resumeParkedTask({ task: "T07", epoch: 1, rev: 6, now: 7, trigger: "user" }),
    ).toThrow(TaskHeldError);
    expect(readRuntime(handle.db, "T07").state).toBe("PARKED");
  });

  it("rejects a stale epoch without moving SUPERSEDED or CANCELLED backward", () => {
    handle = openHarness();
    seedTask(handle.db, "T07");
    setRuntime(handle.db, "T07", { state: "SUPERSEDED", epoch: 9, attempt: null, leaseExpiresAt: null });
    expect(() =>
      handle?.repo.transitionTaskState({ task: "T07", to: "CODING", epoch: 9, rev: 2, now: 3 }),
    ).toThrow(IllegalTaskTransitionError);
    setRuntime(handle.db, "T07", { state: "CANCELLED", epoch: 9, attempt: null, leaseExpiresAt: null });
    expect(() =>
      handle?.repo.transitionTaskState({ task: "T07", to: "READY", epoch: 8, rev: 2, now: 3 }),
    ).toThrow(StaleEpochError);
    expect(readRuntime(handle.db, "T07").state).toBe("CANCELLED");
  });
});
