import { describe, expect, it } from "vitest";
import { CommitAnsweredQuestionDetector } from "../../src/reentry/index.js";
import type { FailedTaskRecord, ObservedCommit, OpenQuestionRecord } from "../../src/reentry/index.js";

const now = "2026-11-22T12:00:00.000Z";

describe("CommitAnsweredQuestionDetector", () => {
  const detector = new CommitAnsweredQuestionDetector();

  it("offers verification for a commit that overlaps a failing task and an open question without closing either", () => {
    const result = detector.detect({
      nowIso: now,
      commits: [commit("3f2a91c0", "fix cutoff tz", ["orders/edit.ts"])],
      failedTasks: [task("T-4", ["orders/**"], ["orders/edit.ts"])],
      questions: [question("Q-11", ["orders/edit.ts"], "2026-11-20T12:00:00.000Z")],
    });
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0];
    expect(match?.autoClosed).toBe(false);
    expect(match?.resolution).toBe("awaiting_confirmation");
    expect(match?.offers).toContain(
      "Looks like your commit 'fix cutoff tz' already resolved Task T-4 & Question Q-11 — Mark verified or Keep open?",
    );
    expect(match?.offers).toContain("Looks answered by your commit 3f2a · Confirm");
    expect(result.recaps.map((item) => item.recap)).toContain(
      "You were deciding whether managers can edit orders after cutoff, because T10 needs it. Since Friday you committed a change to `orders/edit.ts`, which now lets managers edit until 11:15. Is that the answer?",
    );
  });

  it("offers to verify a hand-made fix against the failing checks", () => {
    const result = detector.detect({
      nowIso: now,
      commits: [commit("aaaaaaaa", "fix: order cutoff timezone", ["src/orders/cutoff.ts"])],
      failedTasks: [task("T-6", ["src/orders/**"], ["src/orders/cutoff.ts"])],
      questions: [],
    });
    expect(result.matches[0]?.autoClosed).toBe(false);
    expect(result.matches[0]?.offers).toContain("Verify your commit against T-6's checks & mark done?");
  });

  it("ignores a commit that misses the write scope or the failing check", () => {
    const outside = detector.detect({
      nowIso: now,
      commits: [commit("bbbbbbbb", "docs", ["README.md"])],
      failedTasks: [task("T-6", ["src/orders/**"], ["src/orders/cutoff.ts"])],
      questions: [],
    });
    const scopeOnly = detector.detect({
      nowIso: now,
      commits: [commit("cccccccc", "touch order model", ["src/orders/model.ts"])],
      failedTasks: [task("T-6", ["src/orders/**"], ["src/orders/cutoff.ts"])],
      questions: [],
    });
    expect(outside.matches).toEqual([]);
    expect(scopeOnly.matches).toEqual([]);
  });

  it("retires an obsolete question older than a week and keeps a still-relevant one", () => {
    const result = detector.detect({
      nowIso: now,
      commits: [],
      failedTasks: [],
      questions: [
        question("Q-old", [], "2026-11-01T12:00:00.000Z", "obsolete"),
        question("Q-still", ["orders/edit.ts"], "2026-11-01T12:00:00.000Z", "still_relevant"),
      ],
    });
    expect(result.retired.map((item) => item.questionId)).toEqual(["Q-old"]);
    expect(result.retired[0]?.note).toContain("older than a week");
    expect(result.retired[0]?.note).toContain("Retired with a note");
    expect(result.recaps.map((item) => item.questionId)).toContain("Q-still");
    expect(result.matches.every((match) => match.autoClosed === false)).toBe(true);
  });
});

function commit(sha: string, subject: string, files: string[]): ObservedCommit {
  return { sha, subject, files, kind: "local" };
}

function task(id: string, writeScope: string[], failingChecks: string[]): FailedTaskRecord {
  return { id, writeScope, failingChecks };
}

function question(
  id: string,
  targetFiles: string[],
  openedAt: string,
  revalidation: "still_relevant" | "obsolete" = "still_relevant",
): OpenQuestionRecord {
  return {
    id,
    prompt: "Can managers edit orders after cutoff?",
    openedAt,
    targetFiles,
    decisionContext: "whether managers can edit orders after cutoff",
    neededByTaskId: "T10",
    effectHint: "lets managers edit until 11:15",
    revalidation,
    sinceLabel: "Friday",
  };
}
