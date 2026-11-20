import { afterEach, describe, expect, it } from "vitest";
import { CandidateAcceptanceCoordinator } from "../../src/acceptance/coordinator.js";
import type { CleanVerifierPort, RerunCheckReceipt } from "../../src/acceptance/ports.js";
import {
  ATTEMPT,
  CHECK,
  COMMIT,
  DIGEST,
  EPOCH,
  REQUIREMENT,
  TASK,
  bumpNode,
  seedReadyCandidate,
  type AcceptanceFixture,
} from "./fixture.js";

let fx: AcceptanceFixture | undefined;
let coordinator: CandidateAcceptanceCoordinator | undefined;

afterEach(async () => {
  if (coordinator) await coordinator.flushArchives();
  fx?.db.close();
  fx = undefined;
  coordinator = undefined;
});

function acceptWith(verifier: CleanVerifierPort): CandidateAcceptanceCoordinator {
  fx = seedReadyCandidate();
  coordinator = new CandidateAcceptanceCoordinator({ db: fx.db, cleanVerifier: verifier });
  const accepted = coordinator.finalizeCandidateAcceptance({
    task: TASK,
    attempt: ATTEMPT,
    epoch: EPOCH,
    artifactDigest: DIGEST,
  });
  expect(accepted.accepted).toBe(true);
  return coordinator;
}

describe("revalidatePriorEvidence", () => {
  it("stamps the current check version for a clarifying change and keeps the commit", () => {
    const seen: { commitSha: string; checkIds: string[] }[] = [];
    const verifier: CleanVerifierPort = {
      rerunCurrentChecks(input) {
        seen.push({ commitSha: input.commitSha, checkIds: [...input.checkIds] });
        return input.checkIds.map(
          (checkId): RerunCheckReceipt => ({
            checkId,
            status: "pass",
            artifactDigest: DIGEST,
            receipt: "VR-reval",
          }),
        );
      },
    };
    const gate = acceptWith(verifier);
    bumpNode(fx!, CHECK, "clarifying", { title: "Totals grouped by dish, clarified" });
    const decision = gate.revalidatePriorEvidence({
      task: TASK,
      attempt: ATTEMPT,
      commitSha: COMMIT,
      changeClass: "clarifying",
    });
    expect(decision.revalidated).toBe(true);
    expect(decision.reason).toBe("revalidated");
    expect(decision.codePreserved).toBe(true);
    expect(decision.reworkSuggested).toBe(false);
    expect(decision.attemptState).toBe("accepted");
    expect(decision.taskState).toBe("ACCEPTED");
    expect(seen).toEqual([{ commitSha: COMMIT, checkIds: [CHECK] }]);
    const rows = fx!.db
      .prepare(
        `SELECT check_version, status, receipt FROM check_results WHERE check_id = ? ORDER BY check_version`,
      )
      .all(CHECK) as { check_version: number; status: string; receipt: string }[];
    expect(rows).toEqual([
      { check_version: 1, status: "pass", receipt: "VR-7781" },
      { check_version: 2, status: "pass", receipt: "VR-reval" },
    ]);
    expect(
      (fx!.db.prepare(`SELECT commit_sha FROM candidates WHERE attempt = ?`).get(ATTEMPT) as { commit_sha: string })
        .commit_sha,
    ).toBe(COMMIT);
    const status = fx!.db
      .prepare(`SELECT status FROM requirement_status WHERE requirement = ?`)
      .get(REQUIREMENT) as { status: string };
    expect(status.status).toBe("passing");
  });

  it("revalidates a base sync the same way and refuses to discard code for a breaking change", () => {
    let calls = 0;
    const verifier: CleanVerifierPort = {
      rerunCurrentChecks(input) {
        calls += 1;
        return input.checkIds.map((checkId) => ({
          checkId,
          status: "pass" as const,
          artifactDigest: DIGEST,
          receipt: "VR-base",
        }));
      },
    };
    const gate = acceptWith(verifier);
    const breaking = gate.revalidatePriorEvidence({
      task: TASK,
      attempt: ATTEMPT,
      commitSha: COMMIT,
      changeClass: "breaking",
    });
    expect(breaking.revalidated).toBe(false);
    expect(breaking.reason).toBe("breaking_change_requires_rework");
    expect(breaking.codePreserved).toBe(true);
    expect(breaking.taskState).toBe("ACCEPTED");
    expect(calls).toBe(0);

    bumpNode(fx!, CHECK, "compatible", { title: "Totals compatible" });
    const synced = gate.revalidatePriorEvidence({
      task: TASK,
      attempt: ATTEMPT,
      commitSha: COMMIT,
      changeClass: "base_sync",
    });
    expect(synced.revalidated).toBe(true);
    expect(synced.codePreserved).toBe(true);
    expect(calls).toBe(1);
    expect(
      (fx!.db.prepare(`SELECT state FROM attempts WHERE id = ?`).get(ATTEMPT) as { state: string }).state,
    ).toBe("accepted");
  });

  it("records a failed compatible recheck without discarding the accepted commit", () => {
    const verifier: CleanVerifierPort = {
      rerunCurrentChecks(input) {
        return input.checkIds.map((checkId) => ({
          checkId,
          status: "fail" as const,
          artifactDigest: DIGEST,
          receipt: "VR-fail",
        }));
      },
    };
    const gate = acceptWith(verifier);
    bumpNode(fx!, CHECK, "compatible", { title: "Totals need another look" });
    const decision = gate.revalidatePriorEvidence({
      task: TASK,
      attempt: ATTEMPT,
      commitSha: COMMIT,
      changeClass: "compatible",
    });
    expect(decision.revalidated).toBe(false);
    expect(decision.reason).toBe("checks_failed");
    expect(decision.reworkSuggested).toBe(true);
    expect(decision.codePreserved).toBe(true);
    expect(decision.taskState).toBe("ACCEPTED");
    expect(decision.failures).toEqual([
      expect.objectContaining({ checkId: CHECK, checkVersion: 2, status: "fail" }),
    ]);
    const status = fx!.db
      .prepare(`SELECT status FROM requirement_status WHERE requirement = ?`)
      .get(REQUIREMENT) as { status: string };
    expect(status.status).toBe("failing");
    expect(
      (fx!.db.prepare(`SELECT commit_sha FROM candidates WHERE attempt = ?`).get(ATTEMPT) as { commit_sha: string })
        .commit_sha,
    ).toBe(COMMIT);
  });
});
