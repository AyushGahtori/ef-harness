import { afterEach, describe, expect, it } from "vitest";
import { canonicalQuery, type LeaseDatabase, type LeaseStatement } from "../../src/leases/index.js";
import { countRows, openState, textValue, type LeaseFixture } from "./harness.js";

const open: LeaseFixture[] = [];

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

function useState(options?: Parameters<typeof openState>[0]): LeaseFixture {
  const fixture = openState(options);
  open.push(fixture);
  return fixture;
}

describe("sweep path leases", () => {
  it("lets intent block overlapping claims and still admit disjoint ones", () => {
    const fixture = useState();
    fixture.seed.addTask("T-kitchen");
    fixture.seed.addTask("T-docs");
    fixture.manager.registerTaskScopes("T-kitchen", ["src/app/kitchen/**"]);
    fixture.manager.registerTaskScopes("T-docs", ["docs/**"]);
    const intent = fixture.manager.openSweepIntent({
      leaseId: "L-app",
      sweepTask: "S-app",
      globs: ["src\\app\\**"],
      now: 10,
    });
    expect(intent).toEqual({ leaseId: "L-app", mode: "intent", prefixes: ["src/app/"] });
    expect(countRows(fixture.raw, "SELECT count(*) FROM path_lease_prefixes WHERE instr(path_prefix, char(92)) > 0")).toBe(0);
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-kitchen", "A-kitchen"))).toEqual({
      claimed: false,
      reason: "sweep_overlap",
    });
    expect(fixture.manager.claimTask(fixture.seed.claimInput("T-docs", "A-docs")).claimed).toBe(true);
    expect(textValue(fixture.raw, "SELECT mode FROM path_leases WHERE id = ?", "L-app")).toBe("intent");
  });

  it("grants a sweep only after overlapping work leaves LEASED, CODING, STATIC_AUDIT, and CLEAN_VERIFY", () => {
    const fixture = useState();
    fixture.seed.addTask("T-kitchen");
    fixture.manager.registerTaskScopes("T-kitchen", ["src/app/kitchen/**"]);
    const claimed = fixture.manager.claimTask(fixture.seed.claimInput("T-kitchen", "A-kitchen"));
    expect(claimed.claimed).toBe(true);
    fixture.manager.openSweepIntent({
      leaseId: "L-app",
      sweepTask: "S-app",
      globs: ["src/app/**"],
      now: 20,
    });
    fixture.manager.openSweepIntent({
      leaseId: "L-docs",
      sweepTask: "S-docs",
      globs: ["docs/**"],
      now: 21,
    });
    expect(fixture.manager.grantSweepLease("L-docs")).toEqual({
      granted: true,
      mode: "granted",
      blockedBy: null,
    });
    for (const state of ["LEASED", "CODING", "STATIC_AUDIT", "CLEAN_VERIFY"]) {
      fixture.seed.setState("T-kitchen", state);
      expect(fixture.manager.grantSweepLease("L-app")).toEqual({
        granted: false,
        mode: "intent",
        blockedBy: null,
      });
    }
    fixture.seed.setState("T-kitchen", "PARKED");
    expect(fixture.manager.grantSweepLease("L-app")).toEqual({
      granted: true,
      mode: "granted",
      blockedBy: null,
    });
    expect(fixture.manager.grantSweepLease("L-app").granted).toBe(true);
  });

  it("serializes overlapping sweeps and grants disjoint sweeps together", () => {
    const fixture = useState();
    fixture.manager.openSweepIntent({ leaseId: "L-a", sweepTask: "S-a", globs: ["packages/a/**"], now: 5 });
    fixture.manager.openSweepIntent({ leaseId: "L-b", sweepTask: "S-b", globs: ["packages/b/**"], now: 5 });
    expect(fixture.manager.grantSweepLease("L-b").granted).toBe(true);
    expect(fixture.manager.grantSweepLease("L-a").granted).toBe(true);

    fixture.manager.openSweepIntent({ leaseId: "L-src", sweepTask: "S-src", globs: ["src/**"], now: 6 });
    fixture.manager.openSweepIntent({ leaseId: "L-kitchen", sweepTask: "S-kitchen", globs: ["src/app/**"], now: 7 });
    expect(fixture.manager.grantSweepLease("L-kitchen")).toEqual({
      granted: false,
      mode: "intent",
      blockedBy: "L-src",
    });
    expect(fixture.manager.grantSweepLease("L-src").granted).toBe(true);
    expect(fixture.manager.grantSweepLease("L-kitchen").blockedBy).toBe("L-src");
    expect(fixture.manager.releaseSweepLease("L-src")).toEqual({ released: true });
    expect(countRows(fixture.raw, "SELECT count(*) FROM path_lease_prefixes WHERE lease = ?", "L-src")).toBe(0);
    expect(fixture.manager.grantSweepLease("L-kitchen").granted).toBe(true);
  });

  it("breaks equal timestamps by lease id and releases the earlier sweep before the later one", () => {
    const fixture = useState();
    fixture.manager.openSweepIntent({ leaseId: "L-b", sweepTask: "S-b", globs: ["src/app/**"], now: 8 });
    fixture.manager.openSweepIntent({ leaseId: "L-a", sweepTask: "S-a", globs: ["src/app/**"], now: 8 });
    expect(fixture.manager.grantSweepLease("L-b").blockedBy).toBe("L-a");
    expect(fixture.manager.grantSweepLease("L-a").granted).toBe(true);
    expect(fixture.manager.releaseSweepLease("missing")).toEqual({ released: false });
  });

  it("rolls back a sweep intent when a prefix insert fails", () => {
    const fixture = useState({
      wrap(inner) {
        return failNthRun(inner, "path_lease_prefixes", 2);
      },
    });
    expect(() =>
      fixture.manager.openSweepIntent({
        leaseId: "L-partial",
        sweepTask: "S-partial",
        globs: ["packages/a/**", "packages/b/**"],
        now: 1,
      }),
    ).toThrow(/prefix insert failed/);
    expect(countRows(fixture.raw, "SELECT count(*) FROM path_leases")).toBe(0);
    expect(countRows(fixture.raw, "SELECT count(*) FROM path_lease_prefixes")).toBe(0);
  });

  it("uses the canonical sweep statements", () => {
    const seen: string[] = [];
    const fixture = useState({
      wrap(inner) {
        return {
          exec(sql) {
            inner.exec(sql);
          },
          prepare(sql) {
            seen.push(sql);
            return inner.prepare(sql);
          },
        };
      },
    });
    fixture.manager.openSweepIntent({ leaseId: "L1", sweepTask: "S1", globs: ["docs/**"], now: 1 });
    fixture.manager.grantSweepLease("L1");
    expect(seen).toContain(canonicalQuery("open_sweep_intent"));
    expect(seen).toContain(canonicalQuery("grant_sweep_lease"));
  });
});

function failNthRun(inner: LeaseDatabase, needle: string, failAt: number): LeaseDatabase {
  let runs = 0;
  return {
    exec(sql: string): void {
      inner.exec(sql);
    },
    prepare(sql: string): LeaseStatement {
      const prepared = inner.prepare(sql);
      return {
        all: (params) => prepared.all(params),
        get: (params) => prepared.get(params),
        run: (params) => {
          if (sql.includes(needle)) {
            runs += 1;
            if (runs === failAt) throw new Error("prefix insert failed");
          }
          return prepared.run(params);
        },
      };
    },
  };
}
