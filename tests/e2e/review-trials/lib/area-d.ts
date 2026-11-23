export const AREA_D_EVIDENCE = [
  "step-3b-independent-family",
  "at-least-three-examples",
  "red-before-green",
  "clean-copy",
  "static-audit",
  "boundary-mutation",
  "hint-ladder",
  "dispute-test",
  "zero-check-rejected",
  "protected-example",
] as const;

const disabledCheck = ["it", ".skip"].join("");

export function sealStep3b(input: {
  plannerFamily: string;
  authorFamily: string;
  examples: readonly { id: string }[];
  phase: "before-compile" | "after-compile";
}): void {
  if (input.phase !== "before-compile") throw new Error("step 3b must run before compile");
  if (input.authorFamily === input.plannerFamily) throw new Error("oracle author must be an independent family");
  if (input.examples.length < 3) throw new Error("step 3b requires at least 3 examples");
}

export function redBeforeGreen(passesOnBase: boolean, preservation: boolean): { accept: boolean; reason: string } {
  if (passesOnBase && !preservation) return { accept: false, reason: "vacuous" };
  if (!passesOnBase) return { accept: true, reason: "red-before-green" };
  return { accept: true, reason: "preservation" };
}

export function cleanCopyPasses(worker: ReadonlyMap<string, string>, committed: ReadonlyMap<string, string>, expected: number): { workerPass: boolean; cleanPass: boolean; accepted: boolean } {
  const read = (files: ReadonlyMap<string, string>): number => {
    const match = /return (\d+)/.exec(files.get("src/total.ts") ?? "");
    return Number(match?.[1] ?? -1);
  };
  const workerPass = read(worker) === expected;
  const cleanPass = read(committed) === expected;
  return { workerPass, cleanPass, accepted: cleanPass };
}

export function staticAudit(source: string): { state: "STATIC_AUDIT"; findings: string[] } {
  const findings: string[] = [];
  if (source.includes(disabledCheck)) findings.push("disabled-check");
  if (source.includes("existing code")) findings.push("elision");
  return { state: "STATIC_AUDIT", findings };
}

export function cutoff(op: "<=" | "<", value: number, limit: number): boolean {
  return op === "<=" ? value <= limit : value < limit;
}

export function mutantKilled(limit: number): boolean {
  const cases = [
    { value: limit - 1, expect: true },
    { value: limit, expect: true },
    { value: limit + 1, expect: false },
  ];
  const base = cases.every((item) => cutoff("<=", item.value, limit) === item.expect);
  const mutant = cases.every((item) => cutoff("<", item.value, limit) === item.expect);
  return base && !mutant;
}

export interface LadderState {
  brief: number;
  step: number;
  fingerprint: string;
}

export function advanceLadder(state: LadderState, event: { brief: number; fingerprint: string; ruleId: string }): LadderState & { hint: string } {
  const reset = event.brief !== state.brief;
  const step = reset ? 1 : Math.min(3, state.step + 1);
  const hint = step === 1 ? `failure-type:${event.ruleId}` : step === 2 ? `disclosed-example:${event.ruleId}` : `author:${event.ruleId}`;
  return { brief: event.brief, step, fingerprint: event.fingerprint, hint };
}

export function disputeTest(input: { ruleId: string; source: string; counterexample: string }): { to: "author"; versionBump: true } {
  if (!input.ruleId || !input.source || !input.counterexample) throw new Error("dispute requires rule, source, and counterexample");
  return { to: "author", versionBump: true };
}

export async function runAreaD(): Promise<string[]> {
  const evidence: string[] = [];
  sealStep3b({
    plannerFamily: "planner-a",
    authorFamily: "oracle-b",
    examples: [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
    phase: "before-compile",
  });
  let sameFamily = false;
  try {
    sealStep3b({ plannerFamily: "same", authorFamily: "same", examples: [{ id: "e1" }, { id: "e2" }, { id: "e3" }], phase: "before-compile" });
  } catch (error) {
    sameFamily = error instanceof Error && error.message.includes("independent");
  }
  if (!sameFamily) throw new Error("same-family oracle was sealed");
  evidence.push("step-3b-independent-family", "at-least-three-examples");
  const vacuous = redBeforeGreen(true, false);
  const red = redBeforeGreen(false, false);
  if (vacuous.accept || vacuous.reason !== "vacuous" || !red.accept) throw new Error("red-before-green proof failed");
  evidence.push("red-before-green");
  const committed = new Map([["src/total.ts", "export function total(){ return 0 }"]]);
  const worker = new Map(committed);
  worker.set("src/total.ts", "export function total(){ return 2 }");
  worker.set("untracked-mock.js", "module.exports = 2");
  const copy = cleanCopyPasses(worker, committed, 2);
  if (!copy.workerPass || copy.cleanPass || copy.accepted) throw new Error("clean copy was fooled by the worker slot");
  evidence.push("clean-copy");
  const audit = staticAudit(`describe("x", () => { ${disabledCheck}("hidden", () => {}) })\n// existing code`);
  if (audit.state !== "STATIC_AUDIT" || !audit.findings.includes("disabled-check") || !audit.findings.includes("elision")) {
    throw new Error("static audit missed a disabled check");
  }
  evidence.push("static-audit");
  if (!mutantKilled(10)) throw new Error("boundary mutant survived");
  evidence.push("boundary-mutation");
  const first = advanceLadder({ brief: 3, step: 0, fingerprint: "" }, { brief: 3, fingerprint: "fp", ruleId: "R17" });
  const second = advanceLadder(first, { brief: 3, fingerprint: "fp", ruleId: "R17" });
  const reset = advanceLadder(second, { brief: 4, fingerprint: "next", ruleId: "R18" });
  if (first.step !== 1 || second.step !== 2 || second.hint.startsWith("disclosed") === false || reset.step !== 1) {
    throw new Error("hint ladder did not persist or reset");
  }
  const third = advanceLadder(second, { brief: 3, fingerprint: "fp", ruleId: "R17" });
  if (third.step !== 3 || !third.hint.startsWith("author:")) throw new Error("third hint was not the author rung");
  evidence.push("hint-ladder");
  const dispute = disputeTest({ ruleId: "R17", source: "decision R17@2", counterexample: "10:44 still open" });
  if (dispute.to !== "author" || dispute.versionBump !== true) throw new Error("dispute was not routed");
  evidence.push("dispute-test");
  const acceptEmpty = (expectedChecks: number, exitOk: boolean): boolean => expectedChecks > 0 && exitOk;
  if (acceptEmpty(0, true)) throw new Error("empty run was accepted");
  evidence.push("zero-check-rejected");
  const seal = (example: { id: string; expect: number }) => `${example.id}:${example.expect}`;
  const protectedExample = { id: "AC-31", expect: 2 };
  const tampered = { id: "AC-31", expect: 0 };
  if (seal(tampered) === seal(protectedExample)) throw new Error("protected example change was not detected");
  evidence.push("protected-example");
  const missing = AREA_D_EVIDENCE.filter((id) => !evidence.includes(id));
  if (missing.length > 0) throw new Error(`area D missing ${missing.join(",")}`);
  return evidence;
}
