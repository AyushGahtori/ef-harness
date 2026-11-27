import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripCutoffGuard, stripExactTotals } from "./defects.js";
import { FORENSICS_DIR, writeFailureForensics } from "./forensics.js";
import { runHiddenSuite } from "./hidden-suite.js";
import { bootKitchen, isAlive, stopChild } from "./kitchen-process.js";
import { leasePort } from "./lease.js";
import { MailpitProvider } from "./mailpit.js";
import { executePipeline, OPENING_PREFIX, traceDigest } from "./pipeline.js";
import {
  evaluateExitGate,
  paperworkPct,
  passRatePct,
  renderReport,
  signReport,
  signingView,
  totalTokens,
  validateBaselineMetrics,
} from "./report.js";
import type { HiddenCheckResult, LiveCertification, M2ExitGateReport, SuiteOutcome } from "./types.js";

export { OPENING_PREFIX, traceDigest };
export { FORENSICS_DIR, evaluateExitGate, paperworkPct, renderReport };

function repoRoot(): string {
  let cursor = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(cursor, "pnpm-workspace.yaml"))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function harnessRoot(): string {
  return repoRoot();
}

function axeSource(root: string): string {
  const require = createRequire(path.join(root, "package.json"));
  return fs.readFileSync(require.resolve("axe-core"), "utf8");
}

async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function buildKitchenApp(root: string, dir: string): Promise<void> {
  await executePipeline(root, dir);
}

async function bootCopy(dir: string, serverSource: string, defect: string | undefined, timeoutMs: number, only?: string[]): Promise<SuiteOutcome> {
  const root = repoRoot();
  fs.writeFileSync(path.join(dir, "server.mjs"), serverSource, "utf8");
  const dbPath = path.join(dir, "kitchen.db");
  const appPort = await leasePort();
  const mailPort = await leasePort([appPort]);
  const mailpit = new MailpitProvider(mailPort);
  await mailpit.start();
  const kitchen = await bootKitchen({
    repoDir: dir,
    dbPath,
    mailpitUrl: mailpit.url,
    port: appPort,
    bench: true,
    ...(defect ? { defect } : {}),
  });
  try {
    return await runHiddenSuite(
      {
        origin: kitchen.origin,
        dbPath,
        mailpitUrl: mailpit.url,
        repoDir: dir,
        axeSource: axeSource(root),
        catalogPath: path.join(root, "benchmarks", "m2-kitchen-e2e", "hidden", "acceptance-suite.json"),
        timeoutMs,
      },
      only,
    );
  } finally {
    await kitchen.stop();
    await mailpit.stop();
    if (isAlive(kitchen.pid)) throw new Error(`kitchen pid ${kitchen.pid} survived teardown`);
  }
}

export function oracleAuthorVisibleExample(messageCount: number): { id: "OR-email-visible"; pass: boolean } {
  return { id: "OR-email-visible", pass: messageCount > 0 };
}

export async function runCertifiedReplay(root = repoRoot()): Promise<M2ExitGateReport> {
  const started = Date.now();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "m2-kitchen-"));
  const dbPath = path.join(projectDir, "kitchen.db");
  let mailpit: MailpitProvider | null = null;
  let kitchenPid = 0;
  let stopKitchen: (() => Promise<void>) | null = null;
  try {
    const trace = await executePipeline(root, projectDir);
    const appPort = await leasePort();
    const mailPort = await leasePort([appPort]);
    mailpit = new MailpitProvider(mailPort);
    await mailpit.start();
    const kitchen = await bootKitchen({
      repoDir: projectDir,
      dbPath,
      mailpitUrl: mailpit.url,
      port: appPort,
      bench: true,
    });
    kitchenPid = kitchen.pid;
    stopKitchen = kitchen.stop;
    const outcome = await runHiddenSuite({
      origin: kitchen.origin,
      dbPath,
      mailpitUrl: mailpit.url,
      repoDir: projectDir,
      axeSource: axeSource(root),
      catalogPath: path.join(root, "benchmarks", "m2-kitchen-e2e", "hidden", "acceptance-suite.json"),
      timeoutMs: 8000,
    });
    await kitchen.stop();
    stopKitchen = null;
    await mailpit.stop();
    mailpit = null;
    const leakedPids = isAlive(kitchenPid) ? 1 : 0;
    const catalog = JSON.parse(fs.readFileSync(path.join(root, "benchmarks", "m2-kitchen-e2e", "hidden", "acceptance-suite.json"), "utf8")) as { canary: string };
    const hiddenLeak = trace.filesRead.some((file) => file.split("/").includes("hidden"))
      || trace.prompts.some((prompt) => prompt.includes(catalog.canary) || prompt.includes("H-M2-") || prompt.includes("OR-"));
    const passCount = outcome.checks.filter((check) => check.pass).length;
    const baseline = {
      ...trace.durations,
      totalTokens: totalTokens(trace.tokens),
      paperworkPct: trace.paperworkPct,
      hiddenPassCount: passCount,
      hiddenTotalCount: outcome.checks.length,
      passRatePct: passRatePct(passCount, outcome.checks.length),
    };
    const schemaErrors = validateBaselineMetrics(baseline, fs.readFileSync(path.join(root, "benchmarks", "m2-kitchen-e2e", "baseline-metrics.schema.json"), "utf8"));
    if (schemaErrors.length > 0) throw new Error(`baseline schema: ${schemaErrors.join(", ")}`);
    const hiddenPassRate = outcome.checks.length > 0 ? passCount / outcome.checks.length : 0;
    const gate = evaluateExitGate({
      hiddenPassCount: passCount,
      hiddenTotalCount: outcome.checks.length,
      paperworkPct: trace.paperworkPct,
      leakedPids,
      secretsFound: trace.secretsFound,
      staticAuditFailures: trace.staticAuditFailures,
      falseOverInferences: trace.falseOverInferences.length,
      viewsTracked: trace.viewsTracked,
      trailersValid: trace.trailersValid,
      cleanTree: trace.cleanTree,
      hiddenLeak,
    });
    const report: M2ExitGateReport = {
      schema: "m2-exit-gate-report@1",
      mode: "ci-replay",
      signature: "",
      baseline,
      gate,
      hiddenPassRate,
      paperworkPct: trace.paperworkPct,
      leakedPids,
      secretsFound: trace.secretsFound,
      staticAuditFailures: trace.staticAuditFailures,
      falseOverInferences: trace.falseOverInferences.length,
      checks: outcome.checks,
      stages: trace.stages,
      claimedCertification: gate.exitCode === 0,
      hostElapsedMs: Date.now() - started,
    };
    report.signature = signReport(signingView(report));
    if (hiddenPassRate < 0.9) {
      writeFailureForensics(path.join(root, FORENSICS_DIR), {
        checks: outcome.checks,
        screenshot: outcome.screenshot,
        dbPath,
        audit: { staticAuditFailures: trace.staticAuditFailures, secretsFound: trace.secretsFound, leakedPids },
      });
    }
    return report;
  } finally {
    if (stopKitchen) await stopKitchen();
    if (mailpit) await mailpit.stop();
    await removeDir(projectDir);
  }
}

export async function runDefectCutoff(): Promise<HiddenCheckResult[]> {
  const root = repoRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2-cutoff-"));
  try {
    await buildKitchenApp(root, dir);
    const source = fs.readFileSync(path.join(dir, "server.mjs"), "utf8");
    const outcome = await bootCopy(dir, stripCutoffGuard(source), undefined, 4000, ["H-M2-05", "H-M2-29"]);
    return outcome.checks;
  } finally {
    await removeDir(dir);
  }
}

export async function runEmailMismatch(): Promise<{ hiddenPass: boolean; oraclePass: boolean; detail: string }> {
  const root = repoRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2-email-"));
  try {
    await buildKitchenApp(root, dir);
    const source = fs.readFileSync(path.join(dir, "server.mjs"), "utf8");
    const outcome = await bootCopy(dir, stripExactTotals(source), undefined, 4000, ["H-M2-17"]);
    const hidden = outcome.checks.find((check) => check.id === "H-M2-17");
    const oracle = oracleAuthorVisibleExample(hidden?.detail.includes("Soup") ? 1 : 0);
    return { hiddenPass: hidden?.pass === true, oraclePass: oracle.pass, detail: hidden?.detail ?? "" };
  } finally {
    await removeDir(dir);
  }
}

export async function runForensicsDrill(dir: string): Promise<{ passRate: number; files: string[] }> {
  const root = repoRoot();
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "m2-forensics-"));
  try {
    await buildKitchenApp(root, appDir);
    const dbPath = path.join(appDir, "kitchen.db");
    const appPort = await leasePort();
    const mailPort = await leasePort([appPort]);
    const mailpit = new MailpitProvider(mailPort);
    await mailpit.start();
    const kitchen = await bootKitchen({
      repoDir: appDir,
      dbPath,
      mailpitUrl: mailpit.url,
      port: appPort,
      bench: true,
      defect: "reject-all",
    });
    try {
      const outcome = await runHiddenSuite({
        origin: kitchen.origin,
        dbPath,
        mailpitUrl: mailpit.url,
        repoDir: appDir,
        axeSource: axeSource(root),
        catalogPath: path.join(root, "benchmarks", "m2-kitchen-e2e", "hidden", "acceptance-suite.json"),
        timeoutMs: 2000,
      });
      await kitchen.stop();
      const passCount = outcome.checks.filter((check) => check.pass).length;
      const passRate = outcome.checks.length > 0 ? passCount / outcome.checks.length : 0;
      const files = passRate < 0.9
        ? writeFailureForensics(dir, {
          checks: outcome.checks,
          screenshot: outcome.screenshot,
          dbPath,
          audit: { staticAuditFailures: 0, secretsFound: 0, leakedPids: 0 },
        })
        : [];
      return { passRate, files };
    } finally {
      await kitchen.stop();
      await mailpit.stop();
    }
  } finally {
    await removeDir(appDir);
  }
}

export async function runLiveCertification(): Promise<LiveCertification> {
  const key = process.env.EF_M2_LIVE_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!key || process.env.EF_M2_LIVE_CONFIRM !== "1") {
    return { ran: false, claimedCertification: false, accepted: null };
  }
  const opening = fs.readFileSync(path.join(repoRoot(), "benchmarks", "m2-kitchen-e2e", "opening-prompt.txt"), "utf8");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.EF_M2_LIVE_MODEL ?? "openrouter/auto",
      messages: [{ role: "user", content: `Read this product request and reply READY if it is a web lunch app.\n\n${opening}` }],
    }),
  });
  if (!response.ok) return { ran: false, claimedCertification: false, accepted: null, reason: `provider_${response.status}` };
  return { ran: true, claimedCertification: false, accepted: null, reason: "live_reply_does_not_claim_the_m2_bar_on_this_base" };
}

export class M2KitchenE2eBenchmarkRunner {
  constructor(private readonly root = repoRoot()) {}

  run(): Promise<M2ExitGateReport> {
    return runCertifiedReplay(this.root);
  }
}

export async function leakedPidProbe(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  const pid = child.pid ?? 0;
  try {
    return isAlive(pid) ? 1 : 0;
  } finally {
    await stopChild(child);
  }
}
