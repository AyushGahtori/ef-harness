import { afterEach, describe, expect, it } from "vitest";
import {
  ManualDualClock,
  OsProcessProbe,
  SLEEP_SKEW_THRESHOLD_MS,
  SleepSkewGuard,
  type AttemptProcessProbe,
} from "../../src/leases/index.js";
import { countRows, openState, textValue, type LeaseFixture } from "./harness.js";

const open: LeaseFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("SleepSkewGuard", () => {
  it("suspends only when wall and monotonic time disagree by more than 30 seconds", () => {
    const clock = new ManualDualClock(0, 0);
    const guard = new SleepSkewGuard(clock);
    clock.set(SLEEP_SKEW_THRESHOLD_MS, 0);
    expect(guard.observe().skewed).toBe(false);
    expect(guard.isSweeperSuspended()).toBe(false);

    const backward = new ManualDualClock(0, 0);
    const backwardGuard = new SleepSkewGuard(backward);
    backward.set(-SLEEP_SKEW_THRESHOLD_MS, 0);
    expect(backwardGuard.observe().skewed).toBe(false);

    const jumped = new ManualDualClock(0, 0);
    const jumpedGuard = new SleepSkewGuard(jumped);
    jumped.set(SLEEP_SKEW_THRESHOLD_MS + 1, 0);
    const observation = jumpedGuard.observe();
    expect(observation.skewed).toBe(true);
    expect(observation.signedSkewMs).toBe(SLEEP_SKEW_THRESHOLD_MS + 1);
    expect(jumpedGuard.isSweeperSuspended()).toBe(true);
    expect(jumpedGuard.observe()).toEqual(observation);
  });

  it("suspends immediately on power resume before the clocks are sampled again", () => {
    const clock = new ManualDualClock(10, 10);
    const guard = new SleepSkewGuard(clock);
    guard.onPowerResume();
    expect(guard.isSweeperSuspended()).toBe(true);
    expect(guard.observe().skewed).toBe(true);
  });
});

describe("sleep-skew lease reconciliation", () => {
  it("does not let a 30 second matched jump look like sleep, and does suspend at 30 seconds plus 1", () => {
    const clock = new ManualDualClock(1_000_000, 5_000_000);
    const fixture = openState({ clock });
    open.push(fixture);
    fixture.seed.addTask("T1");
    expect(
      fixture.manager.claimTask(fixture.seed.claimInput("T1", "A1", { expiresAt: 1_000_000 })).claimed,
    ).toBe(true);
    clock.set(1_000_000 + SLEEP_SKEW_THRESHOLD_MS, 5_000_000);
    const swept = fixture.manager.sweepExpiredLeases({
      rev: fixture.seed.rev + 1,
      now: 1_000_000 + SLEEP_SKEW_THRESHOLD_MS,
    });
    expect(swept.suspended).toBe(false);
    expect(swept.expired.map((row) => row.task)).toEqual(["T1"]);

    const slept = new ManualDualClock(1_000_000, 5_000_000);
    const sleptFixture = openState({ clock: slept });
    open.push(sleptFixture);
    sleptFixture.seed.addTask("T2");
    expect(
      sleptFixture.manager.claimTask(sleptFixture.seed.claimInput("T2", "A2", { expiresAt: 1_000_000 })).claimed,
    ).toBe(true);
    slept.set(1_000_000 + SLEEP_SKEW_THRESHOLD_MS + 1, 5_000_000);
    const paused = sleptFixture.manager.sweepExpiredLeases({
      rev: sleptFixture.seed.rev + 1,
      now: 9_999_999_999,
    });
    expect(paused).toEqual({ suspended: true, expired: [], fenced: 0 });
    expect(textValue(sleptFixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T2")).toBe("LEASED");
    expect(countRows(sleptFixture.raw, "SELECT epoch FROM task_runtime WHERE task = ?", "T2")).toBe(1);
  });

  it("keeps four workers alive across a one hour sleep and fences only the dead process", () => {
    const wall = 1_000_000;
    const mono = 5_000_000;
    const clock = new ManualDualClock(wall, mono);
    const deadPid = 44;
    const probe: AttemptProcessProbe = {
      isLive(attempt) {
        return attempt.pid !== deadPid;
      },
    };
    const fixture = openState({ clock, probe });
    open.push(fixture);
    const expiresAt = wall + 120_000;
    for (const id of ["T1", "T2", "T3", "T4"]) {
      fixture.seed.addTask(id);
      const attemptId = `A${id.slice(1)}`;
      expect(
        fixture.manager.claimTask(fixture.seed.claimInput(id, attemptId, { expiresAt })).claimed,
      ).toBe(true);
      fixture.manager.registerAttemptProcess(attemptId, id === "T4" ? deadPid : 11);
    }
    const wallNow = wall + 3_600_000;
    const monoNow = mono + 50;
    clock.set(wallNow, monoNow);
    fixture.manager.onPowerResume();
    const paused = fixture.manager.sweepExpiredLeases({ rev: fixture.seed.rev + 1, now: wallNow });
    expect(paused).toEqual({ suspended: true, expired: [], fenced: 0 });
    for (const id of ["T1", "T2", "T3", "T4"]) {
      expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", id)).toBe("LEASED");
      expect(countRows(fixture.raw, "SELECT epoch FROM task_runtime WHERE task = ?", id)).toBe(1);
    }

    const signedSkew = wallNow - wall - (monoNow - mono);
    const reconciled = fixture.manager.reconcileLiveAttempts({ rev: fixture.seed.rev + 2 });
    expect(reconciled.extended.map((row) => row.task).sort()).toEqual(["T1", "T2", "T3"]);
    expect(reconciled.expired.map((row) => row.task)).toEqual(["T4"]);
    expect(reconciled.expired[0]?.epoch).toBe(2);
    expect(reconciled.fenced).toBe(1);
    for (const row of reconciled.extended) {
      expect(row.expiresAt).toBe(expiresAt + signedSkew);
      expect(countRows(fixture.raw, "SELECT lease_expires_at FROM task_runtime WHERE task = ?", row.task)).toBe(
        expiresAt + signedSkew,
      );
      expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", row.attemptId)).toBe("running");
      expect(countRows(fixture.raw, "SELECT epoch FROM task_runtime WHERE task = ?", row.task)).toBe(1);
    }
    expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T4")).toBe("READY");
    expect(textValue(fixture.raw, "SELECT holder_attempt FROM task_runtime WHERE task = ?", "T4")).toBeNull();
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A4")).toBe("fenced");

    const resumedWall = expiresAt + signedSkew + 1;
    const resumedMono = monoNow + (resumedWall - wallNow);
    clock.set(resumedWall, resumedMono);
    const resumed = fixture.manager.sweepExpiredLeases({ rev: fixture.seed.rev + 3, now: resumedWall });
    expect(resumed.suspended).toBe(false);
    expect(resumed.expired.map((row) => row.task).sort()).toEqual(["T1", "T2", "T3"]);
  });

  it("preserves remaining lease time when the wall clock jumps backward ten minutes", () => {
    const wall = 2_000_000;
    const mono = 8_000_000;
    const clock = new ManualDualClock(wall, mono);
    const fixture = openState({
      clock,
      probe: {
        isLive(attempt) {
          return attempt.attemptId !== "A-dead";
        },
      },
    });
    open.push(fixture);
    fixture.seed.addTask("T-live");
    fixture.seed.addTask("T-dead");
    const expiresAt = wall + 1_200_000;
    expect(
      fixture.manager.claimTask(fixture.seed.claimInput("T-live", "A-live", { expiresAt })).claimed,
    ).toBe(true);
    expect(
      fixture.manager.claimTask(fixture.seed.claimInput("T-dead", "A-dead", { expiresAt })).claimed,
    ).toBe(true);
    fixture.manager.registerAttemptProcess("A-live", 7);
    fixture.manager.registerAttemptProcess("A-dead", 8);
    const wallNow = wall - 600_000;
    const monoNow = mono + 10;
    clock.set(wallNow, monoNow);
    expect(fixture.manager.sweepExpiredLeases({ rev: fixture.seed.rev + 1 }).suspended).toBe(true);
    const reconciled = fixture.manager.reconcileLiveAttempts({ rev: fixture.seed.rev + 2 });
    const signedSkew = wallNow - wall - (monoNow - mono);
    expect(reconciled.extended).toEqual([
      { task: "T-live", attemptId: "A-live", expiresAt: expiresAt + signedSkew },
    ]);
    expect(reconciled.expired.map((row) => row.task)).toEqual(["T-dead"]);
    expect(countRows(fixture.raw, "SELECT epoch FROM task_runtime WHERE task = ?", "T-live")).toBe(1);
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A-live")).toBe("running");
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A-dead")).toBe("fenced");
    expect(countRows(fixture.raw, "SELECT lease_expires_at FROM task_runtime WHERE task = ?", "T-live")).toBe(
      expiresAt + signedSkew,
    );
  });

  it("does not fence a submitted attempt when the machine wakes", () => {
    const wall = 1_000_000;
    const mono = 5_000_000;
    const clock = new ManualDualClock(wall, mono);
    const fixture = openState({
      clock,
      probe: { isLive: () => false },
    });
    open.push(fixture);
    fixture.seed.addTask("T-submitted");
    const claimed = fixture.manager.claimTask(fixture.seed.claimInput("T-submitted", "A-submitted"));
    if (!claimed.claimed) throw new Error("claim failed");
    const accept = fixture.raw.prepare(
      "UPDATE task_runtime SET state = 'CODING', submission_pending = 1 WHERE task = ?",
    );
    accept.run("T-submitted");
    clock.set(wall + 3_600_000, mono);
    fixture.manager.onPowerResume();
    expect(fixture.manager.sweepExpiredLeases({ rev: fixture.seed.rev + 1 }).suspended).toBe(true);
    const reconciled = fixture.manager.reconcileLiveAttempts({ rev: fixture.seed.rev + 2 });
    expect(reconciled.expired).toEqual([]);
    expect(reconciled.fenced).toBe(0);
    expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T-submitted")).toBe("CODING");
    expect(countRows(fixture.raw, "SELECT submission_pending FROM task_runtime WHERE task = ?", "T-submitted")).toBe(1);
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A-submitted")).toBe("running");
    expect(countRows(fixture.raw, "SELECT epoch FROM task_runtime WHERE task = ?", "T-submitted")).toBe(claimed.epoch);
  });
});

describe("OsProcessProbe", () => {
  it("treats the current process as live and a missing pid as dead", () => {
    const probe = new OsProcessProbe();
    expect(probe.isLive({ attemptId: "A", task: "T", pid: process.pid })).toBe(true);
    expect(probe.isLive({ attemptId: "A", task: "T", pid: null })).toBe(true);
    expect(probe.isLive({ attemptId: "A", task: "T", pid: 2_147_483_646 })).toBe(false);
  });
});
