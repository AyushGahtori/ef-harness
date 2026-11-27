import { Z3_SOLVE_TIMEOUT_MS } from "./types.js";

export type Z3SolveStatus = "sat" | "unsat" | "incomplete_timeout";

export interface Z3Literal {
  readonly nodeId: string;
  readonly positive: boolean;
}

export interface Z3ClauseInput {
  readonly id: string;
  readonly literals: readonly Z3Literal[];
  readonly nodeIds?: readonly string[];
}

export interface Z3Problem {
  readonly nodes: readonly { readonly id: string; readonly title: string }[];
  readonly clauses: readonly Z3ClauseInput[];
}

export interface Z3SolveResult {
  readonly status: Z3SolveStatus;
  readonly unsatCore: readonly string[];
  readonly timeoutMs: number;
  readonly seed: number;
  readonly model: Readonly<Record<string, boolean>>;
}

export interface Z3SolverOptions {
  readonly timeoutMs?: number;
  readonly seed?: number;
  readonly now?: () => number;
}

interface EncodedClause {
  readonly id: string;
  readonly lits: readonly number[];
  readonly nodeIds: readonly string[];
}

type SolveCode = "sat" | "unsat" | "timeout";

/**
 * Deterministic boolean UNSAT-core solver used when WASM init is disabled.
 * Schedule and cutoff arithmetic goes through the `z3-solver` WASM session.
 */
export class Z3UnsatCoreSolver {
  readonly timeoutMs: number;
  readonly seed: number;
  private readonly now: () => number;

  constructor(options: Z3SolverOptions = {}) {
    const requested = options.timeoutMs ?? Z3_SOLVE_TIMEOUT_MS;
    this.timeoutMs = Math.min(Math.max(0, requested), Z3_SOLVE_TIMEOUT_MS);
    this.seed = options.seed ?? 1;
    this.now = options.now ?? Date.now;
  }

  solve(problem: Z3Problem): Z3SolveResult {
    const start = this.now();
    const deadline = new Deadline(start, this.timeoutMs, this.now);
    const emptyModel: Record<string, boolean> = {};
    if (deadline.exceeded()) return this.timeoutResult();
    const encoded = encodeProblem(problem);
    const order = shuffle(encoded.order, this.seed);
    const first = satisfiable(encoded.clauses, encoded.varCount, order, this.seed, deadline);
    if (first.code === "timeout") return this.timeoutResult();
    if (first.code === "sat") {
      return {
        status: "sat",
        unsatCore: [],
        timeoutMs: this.timeoutMs,
        seed: this.seed,
        model: modelFromAssignment(first.assignment, encoded.names),
      };
    }

    let active = encoded.clauses.map((clause, index) => ({ clause, index }));
    const dropOrder = shuffle(
      active.map((item) => item.index),
      this.seed,
    );
    for (const index of dropOrder) {
      if (deadline.exceeded()) return this.timeoutResult();
      const target = active.find((item) => item.index === index);
      if (target === undefined) continue;
      const trial = active.filter((item) => item.index !== index).map((item) => item.clause);
      const result = satisfiable(trial, encoded.varCount, order, this.seed, deadline);
      if (result.code === "timeout") return this.timeoutResult();
      if (result.code === "unsat") active = active.filter((item) => item.index !== index);
    }

    const core = new Set<string>();
    for (const item of active) {
      for (const nodeId of item.clause.nodeIds) core.add(nodeId);
    }
    return {
      status: "unsat",
      unsatCore: [...core].sort(),
      timeoutMs: this.timeoutMs,
      seed: this.seed,
      model: emptyModel,
    };
  }

  private timeoutResult(): Z3SolveResult {
    return {
      status: "incomplete_timeout",
      unsatCore: [],
      timeoutMs: this.timeoutMs,
      seed: this.seed,
      model: {},
    };
  }
}

export function assertionClause(nodeId: string, value: boolean): Z3ClauseInput {
  return {
    id: `assert:${nodeId}:${value ? "1" : "0"}`,
    literals: [{ nodeId, positive: value }],
    nodeIds: [nodeId],
  };
}

export function implicationClause(from: string, to: string): Z3ClauseInput {
  return {
    id: `implies:${from}->${to}`,
    literals: [
      { nodeId: from, positive: false },
      { nodeId: to, positive: true },
    ],
    nodeIds: [from, to],
  };
}

export function conflictClause(left: string, right: string): Z3ClauseInput {
  return {
    id: `conflicts:${left}|${right}`,
    literals: [
      { nodeId: left, positive: false },
      { nodeId: right, positive: false },
    ],
    nodeIds: [left, right],
  };
}

export function nandClause(nodeIds: readonly string[]): Z3ClauseInput {
  return {
    id: `nand:${[...nodeIds].join("|")}`,
    literals: nodeIds.map((nodeId) => ({ nodeId, positive: false })),
    nodeIds: [...nodeIds],
  };
}

/** Enum / role domain: exactly one of the named booleans is true. */
export function exactlyOneClauses(nodeIds: readonly string[]): Z3ClauseInput[] {
  if (nodeIds.length === 0) return [];
  const clauses: Z3ClauseInput[] = [
    {
      id: `exactly-one-or:${nodeIds.join("|")}`,
      literals: nodeIds.map((nodeId) => ({ nodeId, positive: true })),
      nodeIds: [...nodeIds],
    },
  ];
  for (let i = 0; i < nodeIds.length; i += 1) {
    for (let j = i + 1; j < nodeIds.length; j += 1) {
      const left = nodeIds[i];
      const right = nodeIds[j];
      if (left === undefined || right === undefined) continue;
      clauses.push(conflictClause(left, right));
    }
  }
  return clauses;
}

class Deadline {
  constructor(
    private readonly start: number,
    private readonly timeoutMs: number,
    private readonly now: () => number,
  ) {}

  exceeded(): boolean {
    return this.now() - this.start >= this.timeoutMs;
  }
}

function encodeProblem(problem: Z3Problem): {
  clauses: EncodedClause[];
  varCount: number;
  order: number[];
  names: readonly string[];
} {
  const indexByName = new Map<string, number>();
  const names: string[] = [];
  const claim = (nodeId: string): number => {
    const existing = indexByName.get(nodeId);
    if (existing !== undefined) return existing;
    const next = names.length + 1;
    names.push(nodeId);
    indexByName.set(nodeId, next);
    return next;
  };
  for (const node of problem.nodes) claim(node.id);
  const clauses: EncodedClause[] = [];
  for (const clause of problem.clauses) {
    const lits: number[] = [];
    const seen = new Set<number>();
    let tautology = false;
    for (const literal of clause.literals) {
      const variable = claim(literal.nodeId);
      const lit = literal.positive ? variable : -variable;
      if (seen.has(-lit)) {
        tautology = true;
        break;
      }
      if (!seen.has(lit)) {
        seen.add(lit);
        lits.push(lit);
      }
    }
    if (tautology) continue;
    const nodeIds = clause.nodeIds ?? [...new Set(clause.literals.map((literal) => literal.nodeId))];
    clauses.push({ id: clause.id, lits, nodeIds });
  }
  const order = names.map((_, index) => index + 1);
  return { clauses, varCount: names.length, order, names };
}

function satisfiable(
  clauses: readonly EncodedClause[],
  varCount: number,
  order: readonly number[],
  seed: number,
  deadline: Deadline,
): { code: SolveCode; assignment: (boolean | null)[] } {
  const assignment: (boolean | null)[] = Array.from({ length: varCount + 1 }, () => null);
  const code = dpll(clauses, assignment, order, mulberry32(seed), deadline);
  return { code, assignment };
}

function dpll(
  clauses: readonly EncodedClause[],
  assignment: (boolean | null)[],
  order: readonly number[],
  rand: () => number,
  deadline: Deadline,
): SolveCode {
  const propagated = propagate(clauses, assignment, deadline);
  if (propagated === "timeout") return "timeout";
  if (propagated === "conflict") return "unsat";
  let next = 0;
  for (const variable of order) {
    if (assignment[variable] === null) {
      next = variable;
      break;
    }
  }
  if (next === 0) return "sat";
  const preferTrue = rand() < 0.5;
  const values = preferTrue ? [true, false] : [false, true];
  for (const value of values) {
    const snapshot = assignment.slice();
    assignment[next] = value;
    const result = dpll(clauses, assignment, order, rand, deadline);
    if (result === "sat" || result === "timeout") return result;
    restore(assignment, snapshot);
  }
  return "unsat";
}

function propagate(
  clauses: readonly EncodedClause[],
  assignment: (boolean | null)[],
  deadline: Deadline,
): "ok" | "conflict" | "timeout" {
  let changed = true;
  while (changed) {
    if (deadline.exceeded()) return "timeout";
    changed = false;
    for (const clause of clauses) {
      let unassigned = 0;
      let openLit = 0;
      let satisfied = false;
      for (const lit of clause.lits) {
        const variable = Math.abs(lit);
        const current = assignment[variable];
        if (current === undefined || current === null) {
          unassigned += 1;
          openLit = lit;
          continue;
        }
        if (current === lit > 0) {
          satisfied = true;
          break;
        }
      }
      if (satisfied) continue;
      if (unassigned === 0) return "conflict";
      if (unassigned === 1) {
        const variable = Math.abs(openLit);
        assignment[variable] = openLit > 0;
        changed = true;
      }
    }
  }
  return "ok";
}

function restore(assignment: (boolean | null)[], snapshot: readonly (boolean | null)[]): void {
  for (let i = 0; i < snapshot.length; i += 1) {
    const value = snapshot[i];
    assignment[i] = value === undefined ? null : value;
  }
}

function modelFromAssignment(assignment: readonly (boolean | null)[], names: readonly string[]): Record<string, boolean> {
  const model: Record<string, boolean> = {};
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const value = assignment[i + 1];
    if (name === undefined || value === undefined || value === null) continue;
    model[name] = value;
  }
  return model;
}

function shuffle(items: readonly number[], seed: number): number[] {
  const copy = [...items];
  const rand = mulberry32(seed);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const left = copy[i];
    const right = copy[j];
    if (left === undefined || right === undefined) continue;
    copy[i] = right;
    copy[j] = left;
  }
  return copy;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
