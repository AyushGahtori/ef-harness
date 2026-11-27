import { init, killThreads } from "z3-solver";

export interface ScheduleClaim {
  readonly id: string;
  readonly nodeId: string;
  readonly key: "order_cutoff" | "kitchen_print";
  readonly minutes: number;
}

export interface ScheduleSolveResult {
  readonly status: "sat" | "unsat" | "incomplete_timeout";
  readonly unsatCore: readonly string[];
  readonly backend: "z3-wasm" | "deterministic";
  readonly timeoutMs: number;
}

export interface ScheduleSolveOptions {
  readonly disableWasm?: boolean;
  readonly timeoutMs?: number;
}

interface WasmSession {
  solve(claims: readonly ScheduleClaim[], timeoutMs: number): Promise<ScheduleSolveResult>;
  release(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 2_000;
let session: Promise<WasmSession> | null = null;

export async function solveSchedule(
  claims: readonly ScheduleClaim[],
  options: ScheduleSolveOptions = {},
): Promise<ScheduleSolveResult> {
  const timeoutMs = clampTimeout(options.timeoutMs);
  if (options.disableWasm === true) return solveScheduleDeterministic(claims, timeoutMs);
  const opened = await openSession();
  return opened.solve(claims, timeoutMs);
}

export async function releaseSpecExpansionZ3(): Promise<void> {
  const pending = session;
  session = null;
  if (pending === null) return;
  const opened = await pending;
  await opened.release();
}

function openSession(): Promise<WasmSession> {
  session ??= init().then((api) => ({
    async solve(claims, timeoutMs) {
      return solveWithContext(api, claims, timeoutMs);
    },
    async release() {
      await killThreads(api.em);
    },
  }));
  return session;
}

async function solveWithContext(
  api: Awaited<ReturnType<typeof init>>,
  claims: readonly ScheduleClaim[],
  timeoutMs: number,
): Promise<ScheduleSolveResult> {
  if (claims.length === 0) return result("sat", [], "z3-wasm", timeoutMs);
  const { Solver, Int, Bool } = new api.Context("main");
  const solver = new Solver();
  solver.set("timeout", timeoutMs);
  const variables = new Map<string, ReturnType<typeof Int.const>>();
  const owners = new Map<string, readonly string[]>();
  for (const claim of claims) {
    const variable = Int.const(`m_${claim.id}`);
    const name = `eq_${claim.id}`;
    variables.set(claim.id, variable);
    owners.set(name, [claim.nodeId]);
    solver.addAndTrack(variable.eq(claim.minutes), Bool.const(name));
  }
  const prints = claims.filter((claim) => claim.key === "kitchen_print");
  const cutoffs = claims.filter((claim) => claim.key === "order_cutoff");
  for (const print of prints) {
    for (const cutoff of cutoffs) {
      const left = variables.get(print.id);
      const right = variables.get(cutoff.id);
      if (left === undefined || right === undefined) continue;
      const name = `ord_${print.id}_${cutoff.id}`;
      owners.set(name, [print.nodeId, cutoff.nodeId]);
      solver.addAndTrack(left.ge(right), Bool.const(name));
    }
  }
  const status = await withDeadline(solver.check(), timeoutMs);
  if (status === "timeout" || status === "unknown") return result("incomplete_timeout", [], "z3-wasm", timeoutMs);
  if (status === "sat") return result("sat", [], "z3-wasm", timeoutMs);
  const core = new Set<string>();
  const literals = solver.unsatCore();
  for (let index = 0; index < literals.length(); index += 1) {
    const literal = literals.get(index);
    const name = literalName(literal.sexpr());
    for (const nodeId of owners.get(name) ?? []) core.add(nodeId);
  }
  if (core.size === 0) {
    for (const print of prints) {
      for (const cutoff of cutoffs) {
        if (print.minutes >= cutoff.minutes) continue;
        core.add(print.nodeId);
        core.add(cutoff.nodeId);
      }
    }
  }
  return result("unsat", [...core].sort(), "z3-wasm", timeoutMs);
}

function solveScheduleDeterministic(claims: readonly ScheduleClaim[], timeoutMs: number): ScheduleSolveResult {
  const prints = claims.filter((claim) => claim.key === "kitchen_print");
  const cutoffs = claims.filter((claim) => claim.key === "order_cutoff");
  const core = new Set<string>();
  for (const print of prints) {
    for (const cutoff of cutoffs) {
      if (print.minutes >= cutoff.minutes) continue;
      core.add(print.nodeId);
      core.add(cutoff.nodeId);
    }
  }
  if (core.size === 0) return result("sat", [], "deterministic", timeoutMs);
  return result("unsat", [...core].sort(), "deterministic", timeoutMs);
}

function result(
  status: ScheduleSolveResult["status"],
  unsatCore: readonly string[],
  backend: ScheduleSolveResult["backend"],
  timeoutMs: number,
): ScheduleSolveResult {
  return { status, unsatCore, backend, timeoutMs };
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return 0;
  return Math.min(timeoutMs, DEFAULT_TIMEOUT_MS);
}

function literalName(sexpr: string): string {
  const names = sexpr.replaceAll("|", "").match(/[A-Za-z_][A-Za-z0-9_]*/g);
  if (names === null || names.length === 0) return sexpr;
  return names[names.length - 1] ?? sexpr;
}

function withDeadline(work: Promise<"sat" | "unsat" | "unknown">, timeoutMs: number): Promise<"sat" | "unsat" | "unknown" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
