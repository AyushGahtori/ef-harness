import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { CandidateAcceptanceCoordinator, canonicalQueriesPath } from "../../src/acceptance/coordinator.js";
import { loadCanonicalQueries } from "../../src/acceptance/canonical-queries.js";
import { MemoryRuleCheckQueue } from "../../src/acceptance/local-ports.js";
import type { KnowledgeSearchPort } from "../../src/acceptance/ports.js";
import type { AcceptanceDecision } from "../../src/acceptance/types.js";
import {
  ATTEMPT,
  CHECK,
  COMMIT,
  DIGEST,
  EPOCH,
  FEATURE,
  RECEIPT,
  REQUIREMENT,
  TASK,
  addDependent,
  addEdge,
  addNode,
  bumpNode,
  candidatePayload,
  countRows,
  passCheck,
  replacePayload,
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

function ready(
  options: ConstructorParameters<typeof CandidateAcceptanceCoordinator>[0] = {},
): CandidateAcceptanceCoordinator {
  fx = seedReadyCandidate();
  coordinator = new CandidateAcceptanceCoordinator({ db: fx.db, ...options });
  return coordinator;
}

function taskRow(): { state: string; pending: number; done: number } {
  return fx!.db
    .prepare(
      `SELECT t.state AS state, t.submission_pending AS pending, s.done AS done
         FROM task_runtime t JOIN task_states s ON s.state = t.state
        WHERE t.task = ?`,
    )
    .get(TASK) as { state: string; pending: number; done: number };
}

function attemptState(): { state: string; outcome: string | null } {
  return fx!.db.prepare(`SELECT state, outcome FROM attempts WHERE id = ?`).get(ATTEMPT) as {
    state: string;
    outcome: string | null;
  };
}

function claimDependent(): number {
  const queries = loadCanonicalQueries(fs.readFileSync(canonicalQueriesPath(), "utf8"));
  const claim = queries.get("claim_task");
  if (!claim) throw new Error("claim_task missing");
  fx!.db.exec("BEGIN IMMEDIATE");
  try {
    return fx!.db.prepare(claim).all({
      task: "T08",
      attempt: "A-T08-1",
      expires_at: 9_000,
      rev: fx!.rev,
      expected_brief: 1,
    }).length;
  } finally {
    fx!.db.exec("ROLLBACK");
  }
}

describe("candidate acceptance transaction", () => {
  it("loads the canonical acceptance statements from schema/queries.sql", () => {
    const queries = loadCanonicalQueries(fs.readFileSync(canonicalQueriesPath(), "utf8"));
    expect(queries.get("stale_reads_for_acceptance")).toContain("c.class IN ('breaking','retired')");
    expect(queries.get("stale_edge_reads_for_acceptance")).toContain("e.version > r.version");
    expect(queries.get("finish_submission")).toContain("submission_pending = 0");
    expect(queries.get("register_delivery")).toContain("INSERT INTO outbox_deliveries");
  });

  it("accepts a clean candidate and publishes runtime, rollup, outbox, and merge instructions", async () => {
    const gate = ready();
    addDependent(fx!);
    fx!.db
      .prepare(
        `INSERT INTO turn_log(attempt, step, tool_call, tokens_in, tokens_out) VALUES (?, 1, 'edit', 4, 2)`,
      )
      .run(ATTEMPT);
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expect(decision.accepted).toBe(true);
    expect(decision.reason).toBe("accepted");
    expect(decision.route).toBe("accepted");
    expect(decision.downstreamUnlocked).toBe(true);
    expect(taskRow()).toMatchObject({ state: "ACCEPTED", pending: 0, done: 1 });
    expect(attemptState().state).toBe("accepted");
    const requirement = fx!.db
      .prepare(`SELECT status FROM requirement_status WHERE requirement = ?`)
      .get(REQUIREMENT) as { status: string };
    expect(requirement.status).toBe("passing");
    const rollup = Object.fromEntries(
      (
        fx!.db.prepare(`SELECT state, n FROM rollup_feature_tasks WHERE feature = ?`).all(FEATURE) as {
          state: string;
          n: number;
        }[]
      ).map((row) => [row.state, row.n]),
    );
    expect(rollup.ACCEPTED).toBe(1);
    expect(rollup.CLEAN_VERIFY ?? 0).toBe(0);
    const event = fx!.db
      .prepare(`SELECT id, type, payload FROM outbox WHERE type = 'TaskAccepted'`)
      .get() as { id: string; type: string; payload: string };
    const payload = JSON.parse(event.payload) as {
      merge_instructions: {
        schema: string;
        commit: string;
        receipt: string;
        diffstat: { files: number; insertions: number; deletions: number };
        exports_changed: { symbol: string; kind: string }[];
        wiring_needs: { path: string }[];
        contracts_verified: { id: string; v: number }[];
      };
    };
    expect(event.type).toBe("TaskAccepted");
    expect(payload.merge_instructions).toEqual(decision.mergeInstructions);
    expect(decision.mergeInstructions).toMatchObject({
      schema: "merge-instructions@1",
      task: TASK,
      commit: COMMIT,
      diffstat: { files: 1, insertions: 12, deletions: 0 },
      exports_changed: [{ symbol: "KitchenPage", kind: "added" }],
      dependency_intents: [],
      migration_intents: [],
      wiring_needs: [{ kind: "route", path: "/kitchen", component: "KitchenPage" }],
      contracts_verified: [{ id: "C-014", v: 1 }],
      receipt: RECEIPT,
    });
    const consumers = (
      fx!.db.prepare(`SELECT consumer FROM outbox_deliveries WHERE event_id = ? ORDER BY consumer`).all(event.id) as {
        consumer: string;
      }[]
    ).map((row) => row.consumer);
    expect(consumers).toEqual(["exporter", "integrator", "scheduler", "ui_projection"]);
    expect(
      countRows(
        fx!.db,
        `SELECT count(*) AS n FROM outbox o WHERE o.id = ? AND NOT EXISTS (
           SELECT 1 FROM outbox_deliveries d WHERE d.event_id = o.id
         )`,
        event.id,
      ),
    ).toBe(0);
    expect(decision.evidencePromoted.slice().sort()).toEqual(["ART-DIGEST", "VR-7781"]);
    expect(
      (fx!.db.prepare(`SELECT retention FROM artifacts WHERE id = 'ART-OTHER'`).get() as { retention: string })
        .retention,
    ).toBe("diagnostic");
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM turn_log WHERE attempt = ?`, ATTEMPT)).toBe(1);
    await gate.flushArchives();
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM turn_log WHERE attempt = ?`, ATTEMPT)).toBe(0);
    const archived = fx!.db
      .prepare(`SELECT steps, tokens_in FROM turn_log_archives WHERE attempt = ?`)
      .get(ATTEMPT) as { steps: number; tokens_in: number };
    expect(archived).toMatchObject({ steps: 1, tokens_in: 4 });
    expect(claimDependent()).toBe(1);
    const again = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expect(again.accepted).toBe(true);
    expect(again.reason).toBe("already_accepted");
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM outbox WHERE type = 'TaskAccepted'`)).toBe(1);
  });

  it("does not reject a cosmetic read or an unrelated feature change", () => {
    const gate = ready();
    bumpNode(fx!, "R17", "cosmetic", { title: "Cutoff rule (typo)" });
    addNode(fx!, "N-OTHER", "rule", "Other feature note", { feature: "F99" });
    bumpNode(fx!, "N-OTHER", "breaking", { title: "Other feature note changed" });
    addNode(fx!, "R-NOTE", "rule", "Clarified aside");
    fx!.db
      .prepare(
        `INSERT INTO read_sets(attempt, node, version, hash, how) VALUES (?, 'R-NOTE', 1, 'hash-note', 'pushed')`,
      )
      .run(ATTEMPT);
    bumpNode(fx!, "R-NOTE", "clarifying", { text: "same meaning, more detail" });
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expect(decision.accepted).toBe(true);
    expect(decision.staleNodes).toEqual([]);
    expect(decision.reason).toBe("accepted");
  });

  it("refuses a breaking pushed read and keeps the candidate inspectable", () => {
    const gate = ready();
    addDependent(fx!);
    bumpNode(fx!, "R17", "breaking", { text: "Orders close at 11:00" });
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(decision, "stale_node_reads", "reverify");
    expect(decision.staleNodes.map((node) => node.detail)).toContain("R17 (read: 1, current: 2)");
    expect(decision.staleNodes[0]?.how).toBe("pushed");
    expect(attemptState()).toMatchObject({ state: "rejected", outcome: "reverify:stale_node_reads" });
    expect(taskRow()).toMatchObject({ state: "CLEAN_VERIFY", pending: 0, done: 0 });
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM candidates WHERE commit_sha = ?`, COMMIT)).toBe(1);
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM check_results WHERE attempt = ?`, ATTEMPT)).toBe(1);
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM outbox WHERE type = 'TaskAccepted'`)).toBe(0);
    expect(claimDependent()).toBe(0);
  });

  it("refuses a breaking pulled read the same way as a pushed read", () => {
    const gate = ready();
    addNode(fx!, "X", "rule", "Pulled rule");
    fx!.db
      .prepare(
        `INSERT INTO read_sets(attempt, node, version, hash, how) VALUES (?, 'X', 1, 'hash-x', 'pulled')`,
      )
      .run(ATTEMPT);
    bumpNode(fx!, "X", "breaking", { text: "meaning changed" });
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(decision, "stale_node_reads", "reverify");
    expect(decision.staleNodes).toEqual([
      expect.objectContaining({
        node: "X",
        how: "pulled",
        readVersion: 1,
        currentVersion: 2,
        detail: "X (read: 1, current: 2)",
      }),
    ]);
    expect(decision.downstreamUnlocked).toBe(false);
  });

  it("refuses a negative edge read when version moves from 0 to 1", () => {
    const gate = ready();
    addNode(fx!, "C-NEW", "contract", "fresh contract");
    fx!.db
      .prepare(
        `INSERT INTO edge_read_sets(attempt, node, dir, type, version) VALUES (?, 'C-NEW', 'in', 'consumes_contract', 0)`,
      )
      .run(ATTEMPT);
    addEdge(fx!, "T07", "consumes_contract", "C-NEW");
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(decision, "stale_edge_reads", "reverify");
    expect(decision.staleEdges.map((edge) => edge.detail)).toContain(
      "C-NEW in consumes_contract (read: 0, current: 1)",
    );
    expect(taskRow().done).toBe(0);
    expect(countRows(fx.db, `SELECT count(*) AS n FROM candidates WHERE id = 'CAND-1'`)).toBe(1);
  });

  it("refuses a negative search that grows from an empty result to a hit", () => {
    const gate = ready();
    addNode(fx!, "Z-1", "rule", "no-such-fact-066");
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(decision, "stale_search_reads", "reverify");
    expect(decision.searchDivergences[0]?.appeared.map((item) => item.id)).toContain("Z-1");
    expect(decision.searchDivergences[0]?.recordedWasEmpty).toBe(true);
    expect(attemptState().outcome).toBe("reverify:stale_search_reads");
    expect(taskRow().state).not.toBe("ACCEPTED");
  });

  it("refuses a skipped check among an otherwise passing set of 15", () => {
    const gate = ready();
    for (let index = 2; index <= 14; index += 1) {
      const id = `AC-${String(index).padStart(2, "0")}`;
      addNode(fx!, id, "check", `Check ${id}`);
      addEdge(fx!, id, "verifies", REQUIREMENT);
      passCheck(fx!.db, id, "pass");
    }
    addNode(fx!, "AC-15", "check", "Check 15");
    addEdge(fx!, "AC-15", "verifies", REQUIREMENT);
    passCheck(fx!.db, "AC-15", "skip");
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(decision, "unmet_checks", "repair_checks");
    expect(decision.unmetChecks).toEqual([
      expect.objectContaining({ checkId: "AC-15", status: "skip", detail: "AC-15 status=skip" }),
    ]);
    expect(decision.reasons.find((reason) => reason.code === "unmet_checks")?.message).toContain(
      "AC-15 status=skip",
    );
    expect(attemptState().state).toBe("submitted");
    expect(taskRow()).toMatchObject({ state: "CLEAN_VERIFY", pending: 1, done: 0 });
  });

  it("refuses a missing check and a stale check version with structured reasons", () => {
    const gate = ready();
    addNode(fx!, "AC-99", "check", "Never ran");
    addEdge(fx!, "AC-99", "verifies", REQUIREMENT);
    const missing = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(missing, "unmet_checks", "repair_checks");
    expect(missing.unmetChecks.map((check) => check.detail)).toContain("AC-99 status=missing");

    fx = seedReadyCandidate();
    coordinator = new CandidateAcceptanceCoordinator({ db: fx.db });
    bumpNode(fx, CHECK, "compatible", { title: "Totals grouped by dish v2" });
    const stale = coordinator.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(stale, "stale_check_version", "repair_checks");
    expect(stale.reasons.find((reason) => reason.code === "stale_check_version")?.message).toContain(
      "AC-31 check_version=1 current=2",
    );
    expect(taskRow().state).toBe("CLEAN_VERIFY");
  });

  it("refuses a stale epoch without unlocking dependents", () => {
    const gate = ready();
    addDependent(fx!);
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH - 1,
      artifactDigest: DIGEST,
    });
    expectRefused(decision, "stale_epoch", "rejected");
    expect(decision.reasons[0]?.message).toContain(`epoch ${EPOCH - 1} does not match task_runtime epoch ${EPOCH}`);
    expect(attemptState()).toMatchObject({ state: "rejected", outcome: "superseded" });
    expect(taskRow()).toMatchObject({ state: "CLEAN_VERIFY", pending: 0, done: 0 });
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM candidates WHERE commit_sha = ?`, COMMIT)).toBe(1);
    expect(claimDependent()).toBe(0);
  });

  it("refuses and queues X-07 when the diff newly touches personal data and logging", () => {
    const queue = new MemoryRuleCheckQueue();
    const gate = ready({ ruleCheckQueue: queue });
    const fields = {
      feature: FEATURE,
      touches: ["logging"],
    };
    bumpNode(fx!, TASK, "clarifying", { fields, text: "touches logging" });
    addNode(fx!, "X-07", "rule", "Personal data is never logged", {
      scope: { all: ["personal_data", "logging"] },
      check_ids: ["LINT-PII-LOG"],
    });
    addNode(fx!, "LINT-PII-LOG", "check", "PII log lint");
    replacePayload(fx!.db, candidatePayload({ detected_touches: ["personal_data"] }));
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(decision, "diff_detected_rule", "repair_checks");
    expect(decision.unexpectedTouches).toEqual(["personal_data"]);
    expect(decision.queuedRules).toEqual([
      expect.objectContaining({
        ruleId: "X-07",
        checkIds: ["LINT-PII-LOG"],
        reason: "diff_detected_rule",
      }),
    ]);
    expect(queue.queued.map((item) => item.checkIds)).toEqual([["LINT-PII-LOG"]]);
    expect(taskRow().state).not.toBe("ACCEPTED");

    fx = seedReadyCandidate();
    const passingQueue = new MemoryRuleCheckQueue();
    coordinator = new CandidateAcceptanceCoordinator({ db: fx.db, ruleCheckQueue: passingQueue });
    bumpNode(fx, TASK, "clarifying", { fields, text: "touches logging" });
    addNode(fx, "X-07", "rule", "Personal data is never logged", {
      scope: { all: ["personal_data", "logging"] },
      check_ids: ["LINT-PII-LOG"],
    });
    addNode(fx, "LINT-PII-LOG", "check", "PII log lint");
    passCheck(fx.db, "LINT-PII-LOG");
    replacePayload(fx.db, candidatePayload({ detected_touches: ["personal_data"] }));
    const accepted = coordinator.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expect(accepted.accepted).toBe(true);
    expect(passingQueue.queued).toEqual([]);
  });

  it("preserves a verified receipt when a user_pause hold arrives mid-verification", () => {
    const gate = ready();
    fx!.db
      .prepare(`INSERT INTO task_holds(task, reason, source, created_at) VALUES (?, 'user_pause', 'msg-9', 20)`)
      .run(TASK);
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toBe("user_pause");
    expect(decision.route).toBe("paused");
    expect(decision.downstreamUnlocked).toBe(false);
    expect(decision.evidencePromoted.slice().sort()).toEqual(["ART-DIGEST", "VR-7781"]);
    expect(taskRow()).toMatchObject({ state: "CLEAN_VERIFY", pending: 1, done: 0 });
    expect(attemptState().state).toBe("submitted");
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM check_results WHERE check_id = ?`, CHECK)).toBe(1);
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM outbox WHERE type = 'TaskAccepted'`)).toBe(0);
  });

  it("refuses a blocking hold without discarding verified results", () => {
    const gate = ready();
    fx!.db
      .prepare(
        `INSERT INTO task_holds(task, reason, source, created_at) VALUES
          (?, 'user_pause', 'msg-9', 20),
          (?, 'requirement_change', 'CS-9', 21)`,
      )
      .run(TASK, TASK);
    const decision = gate.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(decision, "blocking_hold", "blocked");
    expect(decision.evidencePromoted).toEqual([]);
    expect(
      (fx!.db.prepare(`SELECT retention FROM artifacts WHERE id = 'ART-DIGEST'`).get() as { retention: string })
        .retention,
    ).toBe("diagnostic");
    expect(attemptState().state).toBe("submitted");
    expect(countRows(fx!.db, `SELECT count(*) AS n FROM check_results WHERE attempt = ?`, ATTEMPT)).toBe(1);
    expect(taskRow().state).toBe("CLEAN_VERIFY");
  });

  it("re-runs recorded searches outside the write lock and retries when last_rev advances", async () => {
    fx = seedReadyCandidate();
    let calls = 0;
    const slow: KnowledgeSearchPort = {
      verifyRecordedSearchReads() {
        calls += 1;
        const started = Date.now();
        let spin = 0;
        while (Date.now() - started < 80) spin += 1;
        expect(spin).toBeGreaterThan(0);
        return { divergences: [], checked: 1, truncated: false };
      },
    };
    coordinator = new CandidateAcceptanceCoordinator({ db: fx.db, knowledgeSearch: slow });
    const timed = coordinator.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expect(timed.accepted).toBe(true);
    expect(calls).toBe(1);
    expect(timed.searchMs).toBeGreaterThanOrEqual(80);
    expect(timed.writeLockMs).toBeLessThan(50);
    expect(timed.writeLockMs).toBeLessThan(timed.searchMs);

    await coordinator.flushArchives();
    const firstDb = fx.db;
    fx = seedReadyCandidate();
    firstDb.close();
    calls = 0;
    const racing: KnowledgeSearchPort = {
      verifyRecordedSearchReads() {
        calls += 1;
        if (calls === 1) {
          fx!.db
            .prepare(
              `INSERT INTO meta(key, value) VALUES ('last_rev', '9')
               ON CONFLICT(key) DO UPDATE SET value = '9'`,
            )
            .run();
        }
        return { divergences: [], checked: 0, truncated: false };
      },
    };
    coordinator = new CandidateAcceptanceCoordinator({ db: fx.db, knowledgeSearch: racing });
    const raced = coordinator.finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expect(raced.accepted).toBe(true);
    expect(calls).toBe(2);
    expect(raced.searchRevalidations).toBe(2);
  });

  it("triggers X-01 on authz-only touches and promotes JSON-referenced and artifact_refs blobs", () => {
    fx = seedReadyCandidate();
    addNode(fx, "X-01", "rule", "Caller role check");
    addNode(fx, "AC-X01", "check", "Negative role check");
    addEdge(fx, "AC-X01", "verifies", "X-01");
    replacePayload(fx.db, candidatePayload({ detected_touches: ["authz"] }));
    const blocked = new CandidateAcceptanceCoordinator({ db: fx.db }).finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expectRefused(blocked, "diff_detected_rule", "repair_checks");
    expect(blocked.queuedRules).toEqual([
      expect.objectContaining({ ruleId: "X-01", checkIds: ["AC-X01"] }),
    ]);

    fx.db
      .prepare(
        `INSERT INTO artifacts(id, hash, kind, bytes, retention, created_at) VALUES
          ('ART-TRACE-JSON', 'trace-digest-060', 'trace', 10, 'diagnostic', 1),
          ('ART-REF-LINKED', 'ref-hash-060', 'log', 12, 'diagnostic', 1)`,
      )
      .run();
    fx.db
      .prepare(`INSERT INTO artifact_refs(artifact, owner_kind, owner_id) VALUES ('ART-REF-LINKED', 'attempt', ?)`)
      .run(ATTEMPT);
    fx.db
      .prepare(
        `INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)
         VALUES ('AC-X01', ?, 1, ?, 'pass', ?, 12)`,
      )
      .run(
        ATTEMPT,
        DIGEST,
        JSON.stringify({
          checkId: "AC-X01",
          runs: [{ traceDigest: "trace-digest-060", logDigest: "other", observationsDigest: "other" }],
        }),
      );
    const accepted = new CandidateAcceptanceCoordinator({ db: fx.db }).finalizeCandidateAcceptance({
      task: TASK,
      attempt: ATTEMPT,
      epoch: EPOCH,
      artifactDigest: DIGEST,
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.evidencePromoted).toContain("ART-TRACE-JSON");
    expect(accepted.evidencePromoted).toContain("ART-REF-LINKED");
  });
});

function expectRefused(decision: AcceptanceDecision, reason: string, route: string): void {
  expect(decision.accepted).toBe(false);
  expect(decision.reason).toBe(reason);
  expect(decision.route).toBe(route);
  expect(decision.downstreamUnlocked).toBe(false);
}
