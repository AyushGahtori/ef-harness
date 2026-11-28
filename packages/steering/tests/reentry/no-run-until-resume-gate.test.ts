import { describe, expect, it } from "vitest";
import {
  NoRunUntilResumeGate,
  REENTRY_AWAITING_RESUME,
  ReentryBlockedError,
  createSpendLedger,
} from "../../src/reentry/index.js";

const activities = ["start_worker", "edit_file", "spend_tokens", "mutate_git"] as const;

describe("NoRunUntilResumeGate", () => {
  it("blocks workers, file edits, token spend, and git until an explicit Resume", () => {
    const gate = new NoRunUntilResumeGate();
    const ledger = createSpendLedger();
    const git: string[] = [];
    expect(gate.open({
      reopen: "crash",
      buildWasInProgress: true,
      sleepMinutes: null,
      repoChanged: false,
      networkChanged: false,
      offline: false,
      forceHold: false,
      untouchedNewIdleProject: false,
    })).toBe(REENTRY_AWAITING_RESUME);
    gate.markReconciliationFinished();
    gate.grantResumeClearance();

    for (const activity of activities) {
      expect(gate.tryActivity(activity).allowed).toBe(false);
      expect(() => gate.assertCan(activity)).toThrow(ReentryBlockedError);
    }
    expect(runBlocked(gate, ledger, git)).toEqual({ ran: false, tokens: 0, cents: 0, git: [] });

    expect(gate.click("Resume")).toBe("RESUMED");
    expect(runBlocked(gate, ledger, git)).toEqual({ ran: true, tokens: 3, cents: 1, git: ["commit"] });
  });

  it("keeps the hold if Resume is clicked before reconciliation finishes", () => {
    const gate = new NoRunUntilResumeGate();
    gate.open(hold("crash"));
    expect(gate.click("Resume Build")).toBe(REENTRY_AWAITING_RESUME);
    expect(gate.tryActivity("start_worker").allowed).toBe(false);
  });

  it("lets Review Drift First leave the awaiting phase without starting work", () => {
    const gate = new NoRunUntilResumeGate();
    gate.open(hold("app_restart"));
    gate.markReconciliationFinished();
    gate.grantResumeClearance();
    expect(gate.click("Review changes first")).toBe("REVIEWING_DRIFT");
    expect(gate.click("Review Drift First")).toBe("REVIEWING_DRIFT");
    for (const activity of activities) expect(gate.tryActivity(activity).allowed).toBe(false);
    expect(gate.click("Resume Build")).toBe("RESUMED");
    expect(gate.tryActivity("mutate_git").allowed).toBe(true);
  });

  it("stays paused until a later Resume", () => {
    const gate = new NoRunUntilResumeGate();
    gate.open(hold("parked"));
    gate.markReconciliationFinished();
    gate.grantResumeClearance();
    expect(gate.click("Stay Paused")).toBe("STAY_PAUSED");
    expect(gate.tryActivity("spend_tokens").allowed).toBe(false);
    expect(gate.click("Resume")).toBe("RESUMED");
  });

  it("skips the hold for an untouched newly opened idle project", () => {
    const gate = new NoRunUntilResumeGate();
    expect(gate.open({ ...hold("first_open"), untouchedNewIdleProject: true })).toBe("OPEN");
    for (const activity of activities) expect(gate.tryActivity(activity).allowed).toBe(true);
  });

  it("holds a restart during a build, a parked project, and a wake past 30 minutes", () => {
    const duringBuild = new NoRunUntilResumeGate();
    expect(duringBuild.open({ ...hold("app_restart"), buildWasInProgress: true })).toBe(REENTRY_AWAITING_RESUME);
    const parked = new NoRunUntilResumeGate();
    expect(parked.open(hold("parked"))).toBe(REENTRY_AWAITING_RESUME);
    const longSleep = new NoRunUntilResumeGate();
    expect(longSleep.open({ ...hold("wake"), sleepMinutes: 31 })).toBe(REENTRY_AWAITING_RESUME);
    const shortSleep = new NoRunUntilResumeGate();
    expect(shortSleep.open({ ...hold("wake"), sleepMinutes: 9 })).toBe("OPEN");
  });

  it("refuses a missing-folder resume until clearance is granted", () => {
    const gate = new NoRunUntilResumeGate();
    gate.open(hold("app_restart"));
    gate.markReconciliationFinished();
    expect(gate.click("Resume Build")).toBe(REENTRY_AWAITING_RESUME);
    gate.grantResumeClearance();
    expect(gate.click("Resume Build")).toBe("RESUMED");
  });
});

function hold(reopen: "crash" | "app_restart" | "parked" | "wake" | "first_open") {
  return {
    reopen,
    buildWasInProgress: false,
    sleepMinutes: null,
    repoChanged: false,
    networkChanged: false,
    offline: false,
    forceHold: false,
    untouchedNewIdleProject: false,
  } as const;
}

function runBlocked(
  gate: NoRunUntilResumeGate,
  ledger: { tokens: number; cents: number; calls: string[] },
  git: string[],
): { ran: boolean; tokens: number; cents: number; git: string[] } {
  if (!gate.tryActivity("start_worker").allowed || !gate.tryActivity("spend_tokens").allowed || !gate.tryActivity("mutate_git").allowed) {
    return { ran: false, tokens: ledger.tokens, cents: ledger.cents, git: [...git] };
  }
  ledger.calls.push("llm");
  ledger.tokens += 3;
  ledger.cents += 1;
  git.push("commit");
  return { ran: true, tokens: ledger.tokens, cents: ledger.cents, git: [...git] };
}
