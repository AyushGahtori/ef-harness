import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import {
  LeaseFencedError,
  canonicalQuery,
  canonicalQueriesFile,
  loadQueryCatalog,
  type LeaseDatabase,
  type LeaseStatement,
} from "../../src/leases/index.js";
import { countRows, openState, textValue, type LeaseFixture } from "./harness.js";

const open: LeaseFixture[] = [];

afterEach(() => {
  while (open.length > 0) {
    open.pop()?.close();
  }
});

function useState(): LeaseFixture {
  const fixture = openState();
  open.push(fixture);
  return fixture;
}

describe("claimTask", () => {
  it("claims in one immediate transaction and returns the new epoch", () => {
    const sql: string[] = [];
    const exec: string[] = [];
    const fixture = openState({
      wrap(inner) {
        return record(inner, sql, exec);
      },
    });
    open.push(fixture);
    fixture.seed.addTask("T1");
    const claimed = fixture.manager.claimTask(fixture.seed.claimInput("T1", "A1"));
    expect(claimed).toEqual({ claimed: true, epoch: 1, attemptId: "A1" });
    expect(exec).toContain("BEGIN IMMEDIATE");
    expect(exec).not.toContain("BEGIN");
    expect(sql).toContain(canonicalQuery("claim_task"));
    expect(sql).toContain(canonicalQuery("create_attempt"));
    expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T1")).toBe("LEASED");
    expect(textValue(fixture.raw, "SELECT holder_attempt FROM task_runtime WHERE task = ?", "T1")).toBe("A1");
    expect(countRows(fixture.raw, "SELECT epoch FROM task_runtime WHERE task = ? AND epoch = 1", "T1")).toBe(1);
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A1")).toBe("running");
  });

  it("refuses each of the six claim conditions", () => {
    const fixture = useState();
    fixture.seed.addTask("T-draft", "DRAFTED");
    fixture.seed.addTask("T-parked", "PARKED");
    fixture.seed.addTask("T-held");
    fixture.seed.hold("T-held");
    fixture.seed.addTask("T-dep");
    fixture.seed.addTask("T-open");
    fixture.seed.depend("T-dep", "T-open");
    fixture.seed.addTask("T-stale");
    fixture.seed.setBriefVersion("T-stale", 2);
    fixture.seed.addTask("T-sweep");
    fixture.manager.registerTaskScopes("T-sweep", ["src/app/**"]);
    fixture.manager.openSweepIntent({
      leaseId: "L-block",
      sweepTask: "S-block",
      globs: ["src/app/**"],
      now: 1,
    });
    fixture.seed.addTask("T-race");

    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-missing", "A-missing"))).toEqual({
      claimed: false,
      reason: "not_ready",
    });
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-draft", "A-draft"))).toEqual({
      claimed: false,
      reason: "not_ready",
    });
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-parked", "A-parked"))).toEqual({
      claimed: false,
      reason: "not_ready",
    });
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-held", "A-held"))).toEqual({
      claimed: false,
      reason: "held",
    });
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-dep", "A-dep"))).toEqual({
      claimed: false,
      reason: "dependency_open",
    });
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-stale", "A-stale"))).toEqual({
      claimed: false,
      reason: "brief_stale",
    });
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-sweep", "A-sweep"))).toEqual({
      claimed: false,
      reason: "sweep_overlap",
    });

    const winner = fixture.manager.claimTask(fixture.seed.claimInput("T-race", "A-win"));
    const loser = fixture.manager.claimTask(fixture.seed.claimInput("T-race", "A-lose"));
    expect(winner).toEqual({ claimed: true, epoch: 1, attemptId: "A-win" });
    expect(loser).toEqual({ claimed: false, reason: "lost_race" });
    expect(countRows(fixture.raw, "SELECT count(*) FROM attempts WHERE task = ?", "T-race")).toBe(1);
  });

  it("keeps done semantics and retires only cancelled or superseded dependencies", () => {
    const fixture = useState();
    expect(countRows(fixture.raw, "SELECT count(*) FROM task_states WHERE state = 'ACCEPTED' AND done = 1")).toBe(1);
    expect(countRows(fixture.raw, "SELECT count(*) FROM task_states WHERE state = 'MERGED_TO_FEATURE' AND done = 1")).toBe(1);
    expect(countRows(fixture.raw, "SELECT count(*) FROM task_states WHERE state = 'CANCELLED' AND done = 0")).toBe(1);
    expect(countRows(fixture.raw, "SELECT count(*) FROM task_states WHERE state = 'SUPERSEDED' AND done = 0")).toBe(1);

    for (const state of ["ACCEPTED", "MERGED_TO_FEATURE"] as const) {
      const dep = `D-${state}`;
      const task = `T-${state}`;
      fixture.seed.addTask(dep);
      fixture.seed.addTask(task);
      fixture.seed.depend(task, dep);
      fixture.seed.setState(dep, state);
      expect(fixture.manager.claimTask(fixture.seed.claimInput(task, `A-${state}`)).claimed).toBe(true);
      expect(textValue(fixture.raw, "SELECT valid_to_rev FROM edges WHERE src = ? AND dst = ?", task, dep)).toBeNull();
    }

    for (const state of ["CANCELLED", "SUPERSEDED"] as const) {
      const dep = `D-${state}`;
      const task = `T-${state}`;
      fixture.seed.addTask(dep);
      fixture.seed.addTask(task);
      fixture.seed.depend(task, dep);
      fixture.seed.setState(dep, state);
      expect(fixture.manager.claimTask(fixture.seed.claimInput(task, `A-${state}`))).toMatchObject({ claimed: true });
      expect(textValue(fixture.raw, "SELECT valid_to_rev FROM edges WHERE src = ? AND dst = ?", task, dep)).not.toBeNull();
    }

    fixture.seed.addTask("D-open");
    fixture.seed.addTask("T-open-dep");
    fixture.seed.depend("T-open-dep", "D-open");
    fixture.seed.setState("D-open", "EXHAUSTED");
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-open-dep", "A-open-dep"))).toEqual({
      claimed: false,
      reason: "dependency_open",
    });
    expect(
      textValue(fixture.raw, "SELECT valid_to_rev FROM edges WHERE src = ? AND dst = ?", "T-open-dep", "D-open"),
    ).toBeNull();
  });

  it("rolls back dependency retirement when the claim itself is refused", () => {
    const fixture = useState();
    fixture.seed.addTask("D-cancel");
    fixture.seed.addTask("T-held-cancel");
    fixture.seed.depend("T-held-cancel", "D-cancel");
    fixture.seed.setState("D-cancel", "CANCELLED");
    fixture.seed.hold("T-held-cancel");
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-held-cancel", "A-held-cancel"))).toEqual({
      claimed: false,
      reason: "held",
    });
    expect(
      textValue(fixture.raw, "SELECT valid_to_rev FROM edges WHERE src = ? AND dst = ?", "T-held-cancel", "D-cancel"),
    ).toBeNull();
    expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T-held-cancel")).toBe("READY");
  });

  it("rolls back the claim when the attempt insert fails", () => {
    const fixture = openState({
      wrap(inner) {
        return failWhen(inner, "INSERT INTO attempts", 1);
      },
    });
    open.push(fixture);
    fixture.seed.addTask("T1");
    expect(() => fixture.manager.claimTask(fixture.seed.claimInput("T1", "A1"))).toThrow(/attempt insert failed/);
    expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T1")).toBe("READY");
    expect(countRows(fixture.raw, "SELECT count(*) FROM task_runtime WHERE task = ? AND epoch = 0", "T1")).toBe(1);
    expect(countRows(fixture.raw, "SELECT count(*) FROM attempts")).toBe(0);
  });

  it("rejects a holder_attempt that has no attempts row at commit", () => {
    const fixture = useState();
    fixture.seed.addTask("T1");
    fixture.raw.exec("BEGIN IMMEDIATE");
    fixture.raw.prepare("UPDATE task_runtime SET holder_attempt = ? WHERE task = ?").run("NO-ATTEMPT", "T1");
    expect(textValue(fixture.raw, "SELECT holder_attempt FROM task_runtime WHERE task = ?", "T1")).toBe("NO-ATTEMPT");
    expect(() => fixture.raw.exec("COMMIT")).toThrow(/FOREIGN KEY/i);
    fixture.raw.exec("ROLLBACK");
    expect(textValue(fixture.raw, "SELECT holder_attempt FROM task_runtime WHERE task = ?", "T1")).toBeNull();
  });

  it("lets exactly one of two connections claim a task", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-lease-race-"));
    const dbPath = path.join(dir, "state.db");
    const fixture = openState({ filename: dbPath });
    open.push(fixture);
    try {
      fixture.seed.addTask("T-race");
      const input = fixture.seed.claimInput("T-race", "A-main");
      const worker = new Worker(new URL("./claim-racer.mjs", import.meta.url), {
        workerData: {
          dbPath,
          claimSql: canonicalQuery("claim_task"),
          createSql: canonicalQuery("create_attempt"),
          claimParams: {
            task: "T-race",
            attempt: "A-worker",
            expires_at: input.expiresAt,
            rev: input.rev,
            expected_brief: input.expectedBrief,
          },
          createParams: {
            attempt: "A-worker",
            task: "T-race",
            expected_brief: input.expectedBrief,
            runtime: input.runtime,
            model: input.model,
            connection: input.connection,
            base_commit: input.baseCommit,
            now: input.now,
          },
        },
      });
      const workerMessage = new Promise<RacerMessage>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      const exited = new Promise<number>((resolve) => {
        worker.once("exit", resolve);
      });
      const ours = fixture.manager.claimTask(input);
      const theirs = await workerMessage;
      await exited;
      if ("error" in theirs && theirs.error) throw new Error(theirs.error);
      const wins = Number(ours.claimed) + Number(theirs.claimed);
      expect(wins).toBe(1);
      expect(countRows(fixture.raw, "SELECT count(*) FROM attempts WHERE task = ?", "T-race")).toBe(1);
      if (!ours.claimed) {
        expect(ours.reason).toBe("lost_race");
        expect(theirs.claimed).toBe(true);
      }
    } finally {
      fixture.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 20_000);
});

describe("lease renewal and expiry", () => {
  it("extends a live lease and fences a stale epoch", () => {
    const fixture = useState();
    fixture.seed.addTask("T1");
    const claimed = fixture.manager.claimTask(fixture.seed.claimInput("T1", "A1"));
    if (!claimed.claimed) throw new Error("claim failed");
    fixture.seed.setState("T1", "CODING");
    expect(fixture.manager.renewLease({ task: "T1", attemptId: "A1", epoch: claimed.epoch, expiresAt: 1_200_000 })).toEqual({
      expiresAt: 1_200_000,
    });
    expect(countRows(fixture.raw, "SELECT epoch FROM task_runtime WHERE task = ? AND epoch = ?", "T1", claimed.epoch)).toBe(1);
    expect(() =>
      fixture.manager.renewLease({ task: "T1", attemptId: "A1", epoch: claimed.epoch, expiresAt: 1_200_000 }),
    ).toThrow(LeaseFencedError);
    expect(() =>
      fixture.manager.renewLease({ task: "T1", attemptId: "A1", epoch: claimed.epoch - 1, expiresAt: 1_300_000 }),
    ).toThrow(LeaseFencedError);
  });

  it("expires a due lease, fences the attempt, and skips submission_pending", () => {
    const fixture = useState();
    fixture.seed.addTask("T-open");
    fixture.seed.addTask("T-flag");
    fixture.seed.addTask("T-accepted");
    const openClaim = fixture.manager.claimTask(fixture.seed.claimInput("T-open", "A-open", { expiresAt: 5_000 }));
    const flagged = fixture.manager.claimTask(fixture.seed.claimInput("T-flag", "A-flag", { expiresAt: 5_000 }));
    const accepted = fixture.manager.claimTask(fixture.seed.claimInput("T-accepted", "A-accepted", { expiresAt: 5_000 }));
    if (!openClaim.claimed || !flagged.claimed || !accepted.claimed) throw new Error("claim failed");
    fixture.seed.setState("T-flag", "CODING");
    fixture.raw.prepare("UPDATE task_runtime SET submission_pending = 1 WHERE task = ?").run("T-flag");
    const accept = fixture.raw.prepare(namedQuery("accept_submission"));
    accept.setAllowBareNamedParameters(true);
    accept.run({
      task: "T-accepted",
      attempt: "A-accepted",
      epoch: accepted.epoch,
      rev: fixture.seed.rev + 1,
    });
    fixture.raw
      .prepare(
        `INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
         VALUES ('A-stray', 'T-open', 2, 1, 1, 'own', 'm', 'c', 'abc', 'running', 1)`,
      )
      .run();

    const swept = fixture.manager.sweepExpiredLeases({ rev: fixture.seed.rev + 2, now: 5_001 });
    expect(swept.suspended).toBe(false);
    expect(swept.expired.map((row) => row.task)).toEqual(["T-open"]);
    expect(swept.expired[0]?.epoch).toBe(openClaim.epoch + 1);
    expect(swept.fenced).toBe(2);
    expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T-open")).toBe("READY");
    expect(textValue(fixture.raw, "SELECT holder_attempt FROM task_runtime WHERE task = ?", "T-open")).toBeNull();
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A-open")).toBe("fenced");
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A-stray")).toBe("fenced");
    expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T-flag")).toBe("CODING");
    expect(countRows(fixture.raw, "SELECT submission_pending FROM task_runtime WHERE task = ? AND submission_pending = 1", "T-flag")).toBe(1);
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A-flag")).toBe("running");
    expect(textValue(fixture.raw, "SELECT state FROM task_runtime WHERE task = ?", "T-accepted")).toBe("STATIC_AUDIT");
    expect(textValue(fixture.raw, "SELECT state FROM attempts WHERE id = ?", "A-accepted")).toBe("running");
    expect(() =>
      fixture.manager.renewLease({ task: "T-open", attemptId: "A-open", epoch: openClaim.epoch, expiresAt: 9_000 }),
    ).toThrow(LeaseFencedError);
  });
});

interface RacerMessage {
  claimed: boolean;
  epoch?: number;
  error?: string;
}

function namedQuery(name: string): string {
  const sql = loadQueryCatalog(fs.readFileSync(canonicalQueriesFile(), "utf8")).get(name);
  if (!sql) throw new Error(`missing query ${name}`);
  return sql;
}

function record(inner: LeaseDatabase, sql: string[], exec: string[]): LeaseDatabase {
  return {
    exec(statement: string): void {
      exec.push(statement);
      inner.exec(statement);
    },
    prepare(statement: string): LeaseStatement {
      sql.push(statement);
      return inner.prepare(statement);
    },
  };
}

function failWhen(inner: LeaseDatabase, needle: string, failAt: number): LeaseDatabase {
  let runs = 0;
  return {
    exec(statement: string): void {
      inner.exec(statement);
    },
    prepare(statement: string): LeaseStatement {
      const prepared = inner.prepare(statement);
      return {
        all: (params) => prepared.all(params),
        get: (params) => prepared.get(params),
        run: (params) => {
          if (statement.includes(needle)) {
            runs += 1;
            if (runs === failAt) throw new Error("attempt insert failed");
          }
          return prepared.run(params);
        },
      };
    },
  };
}
