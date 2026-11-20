import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PIPELINE_STAGES,
  loadHidden,
  renderReport,
  repoRoot,
  runLiveCertification,
  runM1ExitGate,
  sourceGuard,
  type ExitGateResult,
} from "./pipeline.ts";

export function reportPath(root = repoRoot()): string {
  return path.join(root, "benchmarks", "m1-kitchen-leaves", "M1_EXIT_REPORT.md");
}

function green(color: string): boolean {
  return color.replaceAll(" ", "") === "rgb(0,128,0)";
}

export function assertExitGate(result: ExitGateResult): void {
  const problems: string[] = [];
  const guard = sourceGuard(repoRoot());
  if (result.accepted !== 20 || result.tasks.length !== 20) problems.push(`accepted ${result.accepted}/${result.tasks.length}`);
  if (guard.bytes >= 200 * 1024 || guard.nodeModules || guard.hiddenInSeed || guard.hiddenInBriefs) {
    problems.push("kitchen seed leaked hidden checks, dependencies, or exceeded 200 KB");
  }
  const ids = result.tasks.map((task) => task.task).join(",");
  if (ids !== "K01,K02,K03,K04,K05,K06,K07,K08,K09,K10,K11,K12,K13,K14,K15,K16,K17,K18,K19,K20") {
    problems.push(`task order ${ids}`);
  }
  for (const task of result.tasks) {
    if (!task.accepted || !task.commit) problems.push(`${task.task} missing acceptance`);
    if (task.redPassed !== 0 || task.redFailed < 5) problems.push(`${task.task} red baseline ${task.redPassed}/${task.redFailed}`);
    if (task.stages.join(",") !== PIPELINE_STAGES.join(",")) problems.push(`${task.task} stages`);
    if (task.prompt.includes("HK-") || task.mcp.includes("HK-") || task.hint.includes("HK-")) problems.push(`${task.task} held-back leak`);
    const hidden = loadHidden(repoRoot(), task.task);
    if (hidden.cases.length < 3) problems.push(`${task.task} has ${hidden.cases.length} held-back spares`);
  }
  const k01 = result.tasks.find((task) => task.task === "K01");
  const k03 = result.tasks.find((task) => task.task === "K03");
  const k08 = result.tasks.find((task) => task.task === "K08");
  const k15 = result.tasks.find((task) => task.task === "K15");
  if (!k01?.repairs.some((item) => item.startsWith("hidden:") && item.endsWith("step1")) || k01.hint.includes("Rice")) {
    problems.push("K01 did not recover from a rule-only hint");
  }
  if (!k03?.repairs.some((item) => item.startsWith("hidden:") && item.endsWith("step1"))) problems.push("K03 did not recover from a hint");
  if (!k08?.repairs.includes("static:stub")) problems.push("K08 did not recover from a static stub rejection");
  if (!k15?.devServer?.served || !k15.devServer.died || k15.devServer.host !== "env-k15.localhost") {
    problems.push("K15 dev server did not serve on its isolated host and exit");
  }
  if (result.adversarial.length !== 10 || result.adversarial.some((item) => item.accepted)) {
    problems.push(`adversarial accepted ${result.adversarial.filter((item) => item.accepted).length}`);
  }
  const findings = result.adversarial.map((item) => item.finding).join(",");
  for (const finding of ["unfinished", "stub", "empty-catch", "dead-control", "held-back", "skip", "test-tamper", "zero-tests", "unregistered-env", "out-of-scope"]) {
    if (!findings.includes(finding)) problems.push(`missing adversarial finding ${finding}`);
  }
  if (result.redTeam.escapes !== 0 || result.redTeam.blocked !== 7 || result.redTeam.attacks.some((item) => !item.blocked)) {
    problems.push(`red team escapes ${result.redTeam.escapes}`);
  }
  if (result.tierC.osEnforced || result.tierC.osSignOff || !result.tierC.caveat.includes("not OS-enforced")) {
    problems.push("Tier C was reported as OS-enforced");
  }
  if (!result.alreadyGreen.caught) problems.push("already-green baseline was not caught");
  if (!result.deterministic.identical) problems.push("identical seed produced different receipts");
  if (result.task19.ladderStep !== 3 || result.task19.attempts !== 2 || !result.task19.escalated || result.task19.hint.includes("HK-")) {
    problems.push(`task 19 ladder ${result.task19.ladderStep}`);
  }
  if (result.secretLeaks !== 0) problems.push(`vault canary leaked ${result.secretLeaks} times`);
  const hygiene = result.hygiene;
  if (hygiene.processes !== 0 || hygiene.portLeases !== 0 || hygiene.tempFiles !== 0 || hygiene.rollupDrift !== 0 || hygiene.outboxWithoutDeliveries !== 0) {
    problems.push(`leftovers ${JSON.stringify(hygiene)}`);
  }
  if (!result.viewer.opened || !result.viewer.hunk || result.viewer.status !== "pass" || !green(result.viewer.color)) {
    problems.push(`viewer ${JSON.stringify(result.viewer)}`);
  }
  if (!result.viewer.trailer.includes("Harness-Task: K01")) problems.push("viewer trailer missing Harness-Task");
  if (result.live.ran || result.live.claimedCertification) problems.push("CI run claimed live certification");
  if (result.tokensIn <= 0 || result.tokensOut <= 0 || result.avgVerificationMs <= 0) problems.push("missing token or duration receipt");
  if (problems.length > 0) throw new Error(problems.join("\n"));
}

export function writeExitReport(result: ExitGateResult, root = repoRoot()): string {
  const report = renderReport(result);
  fs.writeFileSync(reportPath(root), report);
  return report;
}

export async function certifyCi(): Promise<{ result: ExitGateResult; report: string }> {
  const result = await runM1ExitGate();
  assertExitGate(result);
  return { result, report: writeExitReport(result) };
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.includes("--live")) {
    const live = await runLiveCertification();
    console.log(JSON.stringify(live));
    if (live.claimedCertification) return;
    process.exitCode = 2;
    return;
  }
  const certified = await certifyCi();
  console.log(certified.report);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry !== "" && path.resolve(fileURLToPath(import.meta.url)) === entry) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
