import { describe, expect, it } from "vitest";
import {
  Z3UnsatCoreSolver,
  Z3_SOLVE_TIMEOUT_MS,
  assertionClause,
  exactlyOneClauses,
  implicationClause,
  nandClause,
  type Z3Problem,
} from "../../src/contradictions/index.js";

function chainProblem(extraAssertions: number): Z3Problem {
  const nodes = [
    { id: "A", title: "A" },
    { id: "B", title: "B" },
    { id: "C", title: "C" },
  ];
  const clauses = [
    assertionClause("A", true),
    implicationClause("A", "B"),
    implicationClause("B", "C"),
    assertionClause("C", false),
  ];
  for (let index = 0; index < extraAssertions; index += 1) {
    const id = `N${String(index)}`;
    nodes.push({ id, title: id });
    clauses.push(assertionClause(id, true));
  }
  return { nodes, clauses };
}

describe("Z3UnsatCoreSolver", () => {
  it("enforces a 2000 ms cap and a default seed", () => {
    expect(Z3_SOLVE_TIMEOUT_MS).toBe(2_000);
    expect(new Z3UnsatCoreSolver().timeoutMs).toBe(2_000);
    expect(new Z3UnsatCoreSolver({ timeoutMs: 9_000 }).timeoutMs).toBe(2_000);
    expect(new Z3UnsatCoreSolver().seed).toBe(1);
  });

  it("returns the minimal 3-node core for an indirect A implies B implies C conflict", () => {
    const result = new Z3UnsatCoreSolver({ seed: 1 }).solve(chainProblem(0));
    expect(result.status).toBe("unsat");
    expect(result.unsatCore).toEqual(["A", "B", "C"]);
  });

  it("extracts that same 3-node core from a 100-constraint system", () => {
    const problem = chainProblem(96);
    expect(problem.clauses).toHaveLength(100);
    const started = performance.now();
    const result = new Z3UnsatCoreSolver({ seed: 1 }).solve(problem);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.status).toBe("unsat");
    expect(result.unsatCore).toEqual(["A", "B", "C"]);
  });

  it("names the anonymous access, private billing, and no-accounts core", () => {
    const result = new Z3UnsatCoreSolver({ seed: 1 }).solve({
      nodes: [
        { id: "anon", title: "Anonymous public access" },
        { id: "billing", title: "Per-user private billing history" },
        { id: "no_accounts", title: "No accounts" },
      ],
      clauses: [
        assertionClause("anon", true),
        assertionClause("billing", true),
        assertionClause("no_accounts", true),
        nandClause(["anon", "billing", "no_accounts"]),
      ],
    });
    expect(result.status).toBe("unsat");
    expect(result.unsatCore).toEqual(["anon", "billing", "no_accounts"]);
  });

  it("solves role exactly-one and permission implications to a minimal core", () => {
    const enumCore = new Z3UnsatCoreSolver({ seed: 1 }).solve({
      nodes: [
        { id: "admin", title: "Admin" },
        { id: "staff", title: "Staff" },
      ],
      clauses: [...exactlyOneClauses(["admin", "staff"]), assertionClause("admin", true), assertionClause("staff", true)],
    });
    expect(enumCore.status).toBe("unsat");
    expect(enumCore.unsatCore).toEqual(["admin", "staff"]);

    const permission = new Z3UnsatCoreSolver({ seed: 1 }).solve({
      nodes: [
        { id: "admin", title: "Admin" },
        { id: "delete_account", title: "Delete account" },
      ],
      clauses: [
        implicationClause("admin", "delete_account"),
        assertionClause("admin", true),
        assertionClause("delete_account", false),
      ],
    });
    expect(permission.status).toBe("unsat");
    expect(permission.unsatCore).toEqual(["admin", "delete_account"]);
  });

  it("returns incomplete_timeout instead of throwing when the cap is hit", () => {
    let ticks = 0;
    const solver = new Z3UnsatCoreSolver({
      now: () => (ticks++ === 0 ? 0 : 5_000),
    });
    const result = solver.solve({
      nodes: [{ id: "A", title: "A" }],
      clauses: [assertionClause("A", true), assertionClause("A", false)],
    });
    expect(result.status).toBe("incomplete_timeout");
    expect(result.unsatCore).toEqual([]);
    expect(result.timeoutMs).toBe(2_000);
  });

  it("repeats the same model for the same seed", () => {
    const problem: Z3Problem = {
      nodes: [
        { id: "A", title: "A" },
        { id: "B", title: "B" },
      ],
      clauses: [
        {
          id: "either",
          literals: [
            { nodeId: "A", positive: true },
            { nodeId: "B", positive: true },
          ],
        },
      ],
    };
    const first = new Z3UnsatCoreSolver({ seed: 1 }).solve(problem);
    const second = new Z3UnsatCoreSolver({ seed: 1 }).solve(problem);
    expect(first.status).toBe("sat");
    expect(first.unsatCore).toEqual([]);
    expect(first.model).toEqual(second.model);
  });
});
