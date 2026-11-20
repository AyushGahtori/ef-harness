import { describe, expect, it } from "vitest";
import type { SQLOutputValue } from "node:sqlite";
import {
  DisputeCounterexampleError,
  DisputeReferenceError,
  localComputeFailureFingerprint,
  localPropertyExample,
  type HiddenCheckFailure,
  type HiddenExample,
} from "../../src/hint-ladder/index.js";
import {
  POOL,
  RULE_TEXT,
  arm,
  createClock,
  nullableText,
  numberCell,
  openHarness,
  temporaryFile,
  textCell,
  type OpenedDb,
} from "./harness-db.js";

const SEALED = ["INPUT_ORANGE", "EXPECTED_ORANGE", "INPUT_RED", "EXPECTED_RED", "INPUT_GOLD", "EXPECTED_GOLD"];

describe("failure fingerprint port", () => {
  it("ignores path separators, line numbers, timestamps, and ports", () => {
    const windows = localComputeFailureFingerprint({
      failureClass: "Wrong Value",
      ruleOrCheckId: "R17",
      filePath: "C:\\src\\kitchen\\cutoff.ts:10:2",
      detail: "timeout at 2024-01-02T03:04:05Z port 54321",
    });
    const posix = localComputeFailureFingerprint({
      failureClass: "wrong_value",
      ruleOrCheckId: "R17",
      filePath: "src/kitchen/cutoff.ts:80:9",
      detail: "timeout at 1999-12-31T00:00:00.000Z port 11111",
    });
    expect(windows).toBe(posix);
    expect(windows).toMatch(/^[0-9a-f]{64}$/);
  });

  it("synthesizes a stable spare that is not one of the sealed checks", () => {
    const request = {
      ruleId: "R17",
      ruleText: RULE_TEXT,
      failedCheckId: "H1",
      sealedCheckIds: ["H1"],
      seed: "T07:1:fp",
    };
    const first = localPropertyExample(request);
    const second = localPropertyExample(request);
    expect(first).toEqual(second);
    expect(first.checkId).not.toBe("H1");
  });
});

describe("hint ladder", () => {
  it("reproduces schema R6, survives restart, discloses one spare, and resets on a new brief", () => {
    const temp = temporaryFile();
    const clock = createClock();
    const calls: OpenedDb["calls"] = [];
    const open = (bootstrap: boolean) =>
      openHarness({
        file: temp.file,
        bootstrap,
        clock,
        runner: {
          run(request) {
            calls.push(request);
            return { token: "ACTUAL_OUTPUT_GREEN_2" };
          },
        },
        generator: {
          synthesize() {
            throw new Error("property generator should not run");
          },
        },
      });
    try {
      const first = open(true);
      const step1 = first.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
      expect(step1.kind).toBe("step_1");
      if (step1.kind !== "step_1") return;
      expect(step1.ladderStep).toBe(1);
      expect(step1.hint).toEqual({ ruleId: "R17", ruleText: RULE_TEXT, failureType: "wrong_value" });
      expect(Object.keys(step1.hint).sort()).toEqual(["failureType", "ruleId", "ruleText"]);
      assertAbsent(step1, [...SEALED, "INPUT_BLUE", "ACTUAL_OUTPUT_GREEN_2"]);
      expect(ladder(first).ladderStep).toBe(1);
      expect(ladder(first).lastFingerprint).toBe("fp-a");
      expect(task(first).state).toBe("CODING");
      expect(task(first).holder).toBe("A1");
      first.db.close();

      const restarted = open(false);
      expect(ladder(restarted).ladderStep).toBe(1);
      expect(ladder(restarted).lastFingerprint).toBe("fp-a");
      expect(ladder(restarted).disclosed).toEqual([]);
      arm(restarted.db);
      const step2 = restarted.controller.processHiddenFailure(hidden({ fingerprint: "fp-b" }));
      expect(step2.kind).toBe("step_2");
      if (step2.kind !== "step_2") return;
      expect(step2.ladderStep).toBe(2);
      expect(step2.disclosedCheckId).toBe("H2");
      expect(step2.synthesized).toBe(false);
      expect(step2.hint.freshInput).toEqual({ token: "INPUT_BLUE" });
      expect(step2.hint.expectedOutput).toEqual({ token: "EXPECTED_BLUE" });
      expect(step2.hint.candidateActualOutput).toEqual({ token: "ACTUAL_OUTPUT_GREEN_2" });
      assertAbsent(step2, SEALED);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.checkId).toBe("H2");
      expect(ladder(restarted).disclosed).toEqual(["H2"]);
      expect(ladder(restarted).sameFingerprint).toBe(1);
      restarted.db.close();

      const persisted = open(false);
      expect(ladder(persisted).ladderStep).toBe(2);
      expect(ladder(persisted).lastFingerprint).toBe("fp-b");
      expect(ladder(persisted).disclosed).toEqual(["H2"]);
      arm(persisted.db);
      const step3 = persisted.controller.processHiddenFailure(hidden({ fingerprint: "fp-b" }));
      expect(step3.kind).toBe("step_3");
      if (step3.kind !== "step_3") return;
      expect(step3.ladderStep).toBe(3);
      expect(step3.escalation.route).toBe("model_level");
      expect(step3.escalation.fromLevel).toBe("Junior");
      expect(step3.escalation.toLevel).toBe("Mid");
      expect(step3.escalation.state).toBe("ESCALATED");
      expect(step3.taskState).toBe("ESCALATED");
      expect(step3.history).toHaveLength(3);
      assertAbsent(step3, [...SEALED, "INPUT_BLUE", "EXPECTED_BLUE", "ACTUAL_OUTPUT_GREEN_2"]);
      expect(calls).toHaveLength(1);
      expect(task(persisted).level).toBe("Mid");
      expect(task(persisted).holder).toBeNull();
      expect(ladder(persisted).ladderStep).toBe(3);
      expect(ladder(persisted).sameFingerprint).toBe(2);
      expect(ladder(persisted).disclosed).toEqual(["H2"]);
      expect(eventPayloads(persisted, "FreshExampleDisclosed").join("\n")).not.toContain("INPUT_ORANGE");
      expect(eventPayloads(persisted, "FreshExampleDisclosed").join("\n")).toContain("INPUT_BLUE");
      expect(deliveriesMissing(persisted)).toEqual([]);

      const reset = persisted.controller.processHiddenFailure(
        hidden({ fingerprint: "fp-b", briefVersion: 2 }),
      );
      expect(reset.kind).toBe("step_1");
      expect(reset.ladderStep).toBe(1);
      expect(ladder(persisted).briefVersion).toBe(2);
      expect(ladder(persisted).ladderStep).toBe(1);
      expect(ladder(persisted).sameFingerprint).toBe(1);
      expect(ladder(persisted).lastFingerprint).toBe("fp-b");
      expect(ladder(persisted).disclosed).toEqual([]);
      expect(task(persisted).state).toBe("READY");
      persisted.db.close();
    } finally {
      temp.cleanup();
    }
  });

  it("filters already disclosed spares and refuses to open the last hidden case", () => {
    const filtered = openHarness();
    filtered.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    filtered.db.prepare(`UPDATE verification_state SET disclosed_checks = '["H2"]' WHERE task = 'T07'`).run();
    arm(filtered.db);
    const next = filtered.controller.processHiddenFailure(
      hidden({ fingerprint: "fp-b", pool: POOL }),
    );
    expect(next.kind).toBe("step_2");
    if (next.kind !== "step_2") return;
    expect(next.disclosedCheckId).toBe("H3");
    expect(next.synthesized).toBe(false);
    expect(ladder(filtered).disclosed).toEqual(["H2", "H3"]);
    assertAbsent(next, ["INPUT_ORANGE", "INPUT_BLUE", "INPUT_GOLD"]);
    filtered.db.close();

    const synthesized = openHarness({
      generator: {
        synthesize: () => ({
          checkId: "GEN-1",
          input: { token: "INPUT_GENERATED" },
          expectedOutput: { token: "EXPECTED_GENERATED" },
        }),
      },
    });
    synthesized.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    synthesized.db
      .prepare(`UPDATE verification_state SET disclosed_checks = '["H2","H3"]' WHERE task = 'T07'`)
      .run();
    arm(synthesized.db);
    const fresh = synthesized.controller.processHiddenFailure(hidden({ fingerprint: "fp-b" }));
    expect(fresh.kind).toBe("step_2");
    if (fresh.kind !== "step_2") return;
    expect(fresh.synthesized).toBe(true);
    expect(fresh.disclosedCheckId).toBe("GEN-1");
    expect(fresh.hint.freshInput).toEqual({ token: "INPUT_GENERATED" });
    expect(ladder(synthesized).disclosed).toEqual(["H2", "H3", "GEN-1"]);
    assertAbsent(fresh, ["INPUT_ORANGE", "EXPECTED_ORANGE"]);
    synthesized.db.close();
  });

  it("rolls back the ladder when the fresh-example probe throws", () => {
    const opened = openHarness({
      runner: {
        run() {
          throw new Error("probe failed");
        },
      },
    });
    opened.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    arm(opened.db);
    expect(() => opened.controller.processHiddenFailure(hidden({ fingerprint: "fp-b" }))).toThrow(
      "probe failed",
    );
    expect(ladder(opened).ladderStep).toBe(1);
    expect(ladder(opened).lastFingerprint).toBe("fp-a");
    expect(ladder(opened).disclosed).toEqual([]);
    expect(eventPayloads(opened, "FreshExampleDisclosed")).toEqual([]);
    opened.db.close();
  });

  it("sends two identical attempts up a level and two workers to the author", () => {
    const same = openHarness();
    same.controller.processHiddenFailure(hidden({ fingerprint: "fp-same" }));
    arm(same.db);
    const escalated = same.controller.processHiddenFailure(hidden({ fingerprint: "fp-same" }));
    expect(escalated.kind).toBe("step_3");
    if (escalated.kind !== "step_3") return;
    expect(escalated.escalation.route).toBe("model_level");
    expect(escalated.escalation.toLevel).toBe("Mid");
    expect(same.controller.checkCrossWorkerPattern({
      taskId: "T07",
      ruleId: "R17",
      fingerprint: "fp-same",
    })).toBeNull();
    same.db.close();

    const crossed = openHarness();
    crossed.controller.processHiddenFailure(
      hidden({ fingerprint: "fp-same", checkId: "AC-31", attemptId: "A1", workerLevel: "Mid", model: "mid-model" }),
    );
    arm(crossed.db, "A2");
    const author = crossed.controller.processHiddenFailure(
      hidden({
        fingerprint: "fp-same",
        checkId: "AC-31",
        attemptId: "A2",
        workerLevel: "Senior",
        model: "senior-model",
      }),
    );
    expect(author.kind).toBe("step_3");
    if (author.kind !== "step_3") return;
    expect(author.escalation.route).toBe("task_author");
    expect(author.escalation.authorMessage).toBe(
      "Two distinct workers failed R17 identically — check brief & test AC-31 for ambiguity",
    );
    expect(author.escalation.toLevel).toBeNull();
    expect(task(crossed).level).toBe("Junior");
    expect(task(crossed).state).toBe("ESCALATED");
    expect(crossed.calls).toEqual([]);
    expect(
      crossed.controller.checkCrossWorkerPattern({
        taskId: "T07",
        ruleId: "R17",
        fingerprint: "fp-same",
      })?.message,
    ).toBe("Two distinct workers failed R17 identically — check brief & test AC-31 for ambiguity");
    crossed.db.close();
  });

  it("stops at EXHAUSTED for Manager and routes an unclear brief to the author", () => {
    const manager = openHarness();
    manager.db.prepare(`UPDATE task_runtime SET level = 'Manager' WHERE task = 'T07'`).run();
    manager.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    arm(manager.db);
    const exhausted = manager.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    expect(exhausted.kind).toBe("step_3");
    if (exhausted.kind !== "step_3") return;
    expect(exhausted.taskState).toBe("EXHAUSTED");
    expect(exhausted.escalation.route).toBe("exhausted");
    expect(exhausted.escalation.toLevel).toBeNull();
    expect(exhausted.escalation.decisionCard?.options).toEqual(["revise brief", "fix by hand", "waive"]);
    expect(exhausted.escalation.routedTo).toBe("ask-owner-responder@1");
    expect(task(manager).level).toBe("Manager");
    manager.db.close();

    const unclear = openHarness();
    unclear.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    arm(unclear.db);
    unclear.controller.processHiddenFailure(hidden({ fingerprint: "fp-b" }));
    arm(unclear.db);
    const author = unclear.controller.processHiddenFailure(
      hidden({ fingerprint: "fp-c", evidence: "unclear_brief" }),
    );
    expect(author.kind).toBe("step_3");
    if (author.kind !== "step_3") return;
    expect(author.escalation.route).toBe("task_author");
    expect(author.escalation.reason).toContain("unclear brief");
    expect(task(unclear).level).toBe("Junior");
    expect(task(unclear).state).toBe("ESCALATED");
    unclear.db.close();
  });

  it("resets a finished ladder when the brief changes before the next failure", () => {
    const opened = openHarness();
    opened.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    arm(opened.db);
    opened.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    expect(ladder(opened).ladderStep).toBe(3);
    opened.controller.resetOnBriefChange("T07", 4);
    expect(ladder(opened).briefVersion).toBe(4);
    expect(ladder(opened).ladderStep).toBe(0);
    expect(ladder(opened).lastFingerprint).toBeNull();
    expect(ladder(opened).disclosed).toEqual([]);
    arm(opened.db);
    const again = opened.controller.processHiddenFailure(hidden({ fingerprint: "fp-a", briefVersion: 4 }));
    expect(again.ladderStep).toBe(1);
    expect(again.kind).toBe("step_1");
    opened.db.close();
  });

  it("does not record contract mismatches or other non-implementation attributions", () => {
    const opened = openHarness();
    const mismatch = opened.controller.processHiddenFailure(
      hidden({
        fingerprint: "fp-a",
        attribution: "contract_mismatch",
        visibleMessage: "No button named 'Print' on /kitchen",
      }),
    );
    expect(mismatch).toEqual({
      kind: "contract_mismatch",
      recordedHiddenFailure: false,
      taskState: "CLEAN_VERIFY",
      hint: { message: "No button named 'Print' on /kitchen" },
    });
    expect(countRows(opened, "verification_state")).toBe(0);
    expect(countRows(opened, "outbox")).toBe(0);

    opened.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    const before = ladder(opened);
    const environment = opened.controller.processHiddenFailure(
      hidden({ fingerprint: "fp-other", attribution: "environment", visibleMessage: "postgres crashed" }),
    );
    expect(environment.kind).toBe("non_ladder");
    if (environment.kind !== "non_ladder") return;
    expect(environment.recordedHiddenFailure).toBe(false);
    expect(environment.attribution).toBe("environment");
    expect(ladder(opened)).toEqual(before);
    opened.db.close();
  });

  it("counts static failures apart from the hidden ladder and escalates on the third identical fingerprint", () => {
    const opened = openHarness();
    opened.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    const hiddenBefore = ladder(opened);
    opened.controller.processStaticFailure({
      taskId: "T07",
      briefVersion: 1,
      fingerprint: "static-a",
      outcome: "fail",
    });
    opened.controller.processStaticFailure({
      taskId: "T07",
      briefVersion: 1,
      fingerprint: "static-b",
      outcome: "fail",
    });
    expect(ladder(opened).staticFailures).toBe(1);
    expect(ladder(opened).ladderStep).toBe(hiddenBefore.ladderStep);
    const passed = opened.controller.processStaticFailure({
      taskId: "T07",
      briefVersion: 1,
      fingerprint: "static-b",
      outcome: "pass",
    });
    expect(passed.staticFailures).toBe(0);
    expect(passed.escalated).toBe(false);
    expect(ladder(opened).ladderStep).toBe(1);
    expect(ladder(opened).lastFingerprint).toBe("fp-a");

    const first = opened.controller.processStaticFailure(staticFail("static-a"));
    const second = opened.controller.processStaticFailure(staticFail("static-a"));
    expect(first.escalated).toBe(false);
    expect(second.staticFailures).toBe(2);
    expect(task(opened).state).toBe("CODING");
    const third = opened.controller.processStaticFailure(staticFail("static-a"));
    expect(third.escalated).toBe(true);
    expect(third.recordedHiddenFailure).toBe(false);
    expect(third.ladderStep).toBe(1);
    expect(third.escalation?.source).toBe("static_audit");
    expect(ladder(opened).ladderStep).toBe(1);
    expect(ladder(opened).lastFingerprint).toBe("fp-a");
    expect(ladder(opened).staticFailures).toBe(3);
    expect(task(opened).state).toBe("ESCALATED");
    expect(eventPayloads(opened, "HintLadderAdvanced")).toHaveLength(1);
    opened.db.close();
  });

  it("keeps a static streak across a reopened state database", () => {
    const temp = temporaryFile();
    const clock = createClock();
    try {
      const first = openHarness({ file: temp.file, bootstrap: true, clock });
      first.controller.processStaticFailure(staticFail("static-a"));
      first.controller.processStaticFailure(staticFail("static-a"));
      expect(ladder(first).staticFailures).toBe(2);
      expect(ladder(first).ladderStep).toBe(0);
      first.db.close();
      const second = openHarness({ file: temp.file, bootstrap: false, clock });
      const third = second.controller.processStaticFailure(staticFail("static-a"));
      expect(third.escalated).toBe(true);
      expect(third.ladderStep).toBe(0);
      expect(ladder(second).staticFailures).toBe(3);
      second.db.close();
    } finally {
      temp.cleanup();
    }
  });

  it("pauses a dispute without changing the attempt, the ladder, or the check", () => {
    const opened = openHarness();
    opened.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    const before = ladder(opened);
    const attemptBefore = textCell(
      opened.db.prepare(`SELECT state FROM attempts WHERE id = 'A1'`).get() as
        | Record<string, SQLOutputValue>
        | undefined,
      "state",
    );
    expect(() =>
      opened.controller.handleTestDispute({
        taskId: "T07",
        attemptId: "A1",
        referenceId: "R17",
        counterexample: "   ",
      }),
    ).toThrow(DisputeCounterexampleError);
    expect(() =>
      opened.controller.handleTestDispute({
        taskId: "T07",
        attemptId: "A1",
        referenceId: "R17",
        counterexample: {},
      }),
    ).toThrow(DisputeCounterexampleError);
    expect(() =>
      opened.controller.handleTestDispute({
        taskId: "T07",
        attemptId: "A1",
        referenceId: "NOPE",
        counterexample: "cutoff equality is still open",
      }),
    ).toThrow(DisputeReferenceError);
    expect(task(opened).state).toBe("CODING");

    const byRule = opened.controller.handleTestDispute({
      taskId: "T07",
      attemptId: "A1",
      referenceId: "R17",
      counterexample: { input: { at: "10:45:00" }, note: "Equality at cutoff is still open" },
    });
    expect(byRule.citedRuleId).toBe("R17");
    expect(byRule.citedCheckId).toBeNull();
    expect(byRule.ruleText).toBe(RULE_TEXT);
    expect(byRule.penalized).toBe(false);
    expect(byRule.routedTo).toBe("ask-owner-responder@1");
    expect(byRule.pausedAttemptState).toBe(attemptBefore);
    expect(byRule.status).toBe("open");
    expect(task(opened).state).toBe("WAITING_INPUT");
    expect(textCell(opened.db.prepare(`SELECT state FROM attempts WHERE id = 'A1'`).get() as Record<string, SQLOutputValue>, "state")).toBe(
      attemptBefore,
    );
    expect(ladder(opened)).toEqual(before);
    expect(nodeVersion(opened, "R17")).toBe(1);
    expect(nodeVersion(opened, "H1")).toBe(1);
    expect(eventPayloads(opened, "TestDisputeOpened")).toHaveLength(1);
    expect(deliveriesMissing(opened)).toEqual([]);

    const rejected = opened.controller.applyDisputeVerdict({
      disputeId: byRule.disputeId,
      verdict: "dispute_rejected",
      authorQuote: "The rule already closes the window at 10:45.",
    });
    expect(rejected.authorQuote).toBe("The rule already closes the window at 10:45.");
    expect(rejected.record.status).toBe("rejected");
    expect(rejected.checkVersion).toBeNull();
    expect(task(opened).state).toBe("CODING");
    expect(ladder(opened)).toEqual(before);
    expect(nodeVersion(opened, "AC-31")).toBe(1);
    opened.db.close();

    const upheldDb = openHarness();
    upheldDb.controller.processHiddenFailure(hidden({ fingerprint: "fp-a" }));
    const guessed = upheldDb.controller.handleTestDispute({
      taskId: "T07",
      attemptId: "A1",
      referenceId: "H1",
      counterexample: "A guessed hidden id still needs the author.",
    });
    expect(guessed.citedCheckId).toBe("H1");
    expect(guessed.citedRuleId).toBe("R17");
    expect(nodeVersion(upheldDb, "H1")).toBe(1);
    const upheld = upheldDb.controller.applyDisputeVerdict({
      disputeId: guessed.disputeId,
      verdict: "dispute_upheld",
      correctedExpectation: { at: "10:45:00", open: true },
      authorQuote: "Cutoff equality stays open.",
    });
    expect(upheld.taskState).toBe("CLEAN_VERIFY");
    expect(upheld.checkId).toBe("H1");
    expect(upheld.checkVersion).toBe(2);
    expect(nodeVersion(upheldDb, "H1")).toBe(2);
    expect(nodeVersion(upheldDb, "AC-31")).toBe(1);
    expect(ladder(upheldDb).ladderStep).toBe(0);
    expect(ladder(upheldDb).lastFingerprint).toBeNull();
    expect(ladder(upheldDb).disclosed).toEqual([]);
    expect(task(upheldDb).pending).toBe(1);
    expect(textCell(upheldDb.db.prepare(`SELECT state FROM attempts WHERE id = 'A1'`).get() as Record<string, SQLOutputValue>, "state")).toBe(
      "running",
    );
    const fields = textCell(
      upheldDb.db.prepare(`SELECT fields FROM nodes WHERE id = 'H1'`).get() as Record<string, SQLOutputValue>,
      "fields",
    );
    expect(fields).toContain("10:45:00");
    const change = textCell(
      upheldDb.db.prepare(`SELECT class FROM node_changes WHERE id = 'H1'`).get() as Record<string, SQLOutputValue>,
      "class",
    );
    expect(change).toBe("breaking");
    const again = upheldDb.controller.processHiddenFailure(hidden({ fingerprint: "fp-new" }));
    expect(again.kind).toBe("step_1");
    expect(again.ladderStep).toBe(1);
    upheldDb.db.close();
  });
});

function hidden(overrides: {
  readonly fingerprint: string;
  readonly attemptId?: string;
  readonly model?: string;
  readonly workerLevel?: string;
  readonly briefVersion?: number;
  readonly checkId?: string;
  readonly evidence?: "unclear_brief" | "defective_expectation";
  readonly pool?: readonly HiddenExample[];
  readonly attribution?: HiddenCheckFailure["attribution"];
  readonly visibleMessage?: string;
}): HiddenCheckFailure {
  return {
    taskId: "T07",
    attemptId: overrides.attemptId ?? "A1",
    model: overrides.model ?? "mid-model",
    workerLevel: overrides.workerLevel ?? "Mid",
    briefVersion: overrides.briefVersion ?? 1,
    ruleId: "R17",
    ruleText: RULE_TEXT,
    checkId: overrides.checkId ?? "H1",
    failureType: "wrong_value",
    fingerprint: overrides.fingerprint,
    pool: overrides.pool ?? POOL.slice(0, 3),
    ...(overrides.evidence ? { evidence: overrides.evidence } : {}),
    ...(overrides.attribution ? { attribution: overrides.attribution } : {}),
    ...(overrides.visibleMessage ? { visibleMessage: overrides.visibleMessage } : {}),
  };
}

function staticFail(fingerprint: string) {
  return { taskId: "T07", briefVersion: 1, fingerprint, outcome: "fail" as const };
}

function ladder(opened: OpenedDb) {
  const row = opened.db
    .prepare(
      `SELECT brief_version, ladder_step, last_fingerprint, same_fingerprint, disclosed_checks, static_failures
         FROM verification_state WHERE task = 'T07'`,
    )
    .get() as Record<string, SQLOutputValue> | undefined;
  return {
    briefVersion: numberCell(row, "brief_version"),
    ladderStep: numberCell(row, "ladder_step"),
    lastFingerprint: nullableText(row ?? {}, "last_fingerprint"),
    sameFingerprint: numberCell(row, "same_fingerprint"),
    disclosed: JSON.parse(textCell(row, "disclosed_checks")) as unknown,
    staticFailures: numberCell(row, "static_failures"),
  };
}

function task(opened: OpenedDb) {
  const row = opened.db
    .prepare(
      `SELECT state, level, holder_attempt, submission_pending FROM task_runtime WHERE task = 'T07'`,
    )
    .get() as Record<string, SQLOutputValue> | undefined;
  return {
    state: textCell(row, "state"),
    level: textCell(row, "level"),
    holder: nullableText(row ?? {}, "holder_attempt"),
    pending: numberCell(row, "submission_pending"),
  };
}

function nodeVersion(opened: OpenedDb, id: string): number {
  const row = opened.db.prepare(`SELECT version FROM nodes WHERE id = ?`).get(id) as
    | Record<string, SQLOutputValue>
    | undefined;
  return numberCell(row, "version");
}

function eventPayloads(opened: OpenedDb, type: string): string[] {
  const rows = opened.db.prepare(`SELECT payload FROM outbox WHERE type = ? ORDER BY seq`).all(type) as Record<
    string,
    SQLOutputValue
  >[];
  return rows.map((row) => textCell(row, "payload"));
}

function deliveriesMissing(opened: OpenedDb): string[] {
  const rows = opened.db
    .prepare(
      `SELECT o.id AS id FROM outbox o
        WHERE NOT EXISTS (SELECT 1 FROM outbox_deliveries d WHERE d.event_id = o.id)`,
    )
    .all() as Record<string, SQLOutputValue>[];
  return rows.map((row) => textCell(row, "id"));
}

function countRows(opened: OpenedDb, table: "verification_state" | "outbox"): number {
  const row = opened.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
    | Record<string, SQLOutputValue>
    | undefined;
  return numberCell(row, "n");
}

function assertAbsent(payload: unknown, tokens: readonly string[]): void {
  const text = JSON.stringify(payload);
  for (const token of tokens) expect(text).not.toContain(token);
}
