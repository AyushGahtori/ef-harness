import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { secretFindings } from "../m2-exit-gate/audit.ts";
import { leasePort, PORT_MAX, PORT_MIN } from "../m2-exit-gate/lease.ts";
import { executePipeline, OPENING_PREFIX, traceDigest } from "../m2-exit-gate/pipeline.ts";
import { canonical, evaluateExitGate, paperworkPct, signingView, signReport } from "../m2-exit-gate/report.ts";
import {
  harnessRoot,
  leakedPidProbe,
  oracleAuthorVisibleExample,
  runCertifiedReplay,
  runDefectCutoff,
  runEmailMismatch,
  runForensicsDrill,
  runLiveCertification,
} from "../m2-exit-gate/runner.ts";

const passingGate = {
  hiddenPassCount: 29,
  hiddenTotalCount: 29,
  paperworkPct: 0.18,
  leakedPids: 0,
  secretsFound: 0,
  staticAuditFailures: 0,
  falseOverInferences: 0,
  viewsTracked: 0,
  trailersValid: true,
  cleanTree: true,
  hiddenLeak: false,
};

it("keeps ci-replay gate math, ports, and prompt isolation deterministic", async () => {
  expect(canonical({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  expect(paperworkPct({ discovery: 1000, spec: 3000, research: 5000, architecture: 5000, planning: 3000, audit: 1000, coding: 82000 })).toBe(0.18);
  expect(evaluateExitGate(passingGate).exitCode).toBe(0);
  expect(evaluateExitGate({ ...passingGate, paperworkPct: 0.24 }).reasons).toContain("paperworkPct");
  expect(evaluateExitGate({ ...passingGate, leakedPids: 2 }).reasons).toContain("leakedPids");
  expect(evaluateExitGate({ ...passingGate, secretsFound: 1 }).reasons).toContain("secretsFound");
  expect(evaluateExitGate({ ...passingGate, hiddenPassCount: 20 }).reasons).toContain("hiddenPassRate");
  const root = harnessRoot();
  const opening = fs.readFileSync(path.join(root, "benchmarks", "m2-kitchen-e2e", "opening-prompt.txt"), "utf8");
  expect(opening.startsWith(OPENING_PREFIX)).toBe(true);
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "m2-pipe-a-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "m2-pipe-b-"));
  try {
    const left = executePipeline(root, first);
    const right = executePipeline(root, second);
    expect(traceDigest(left)).toBe(traceDigest(right));
    expect(left.settled.platform).toBe("responsive-web");
    expect(left.settled.cutoff).toBe("11:00");
    expect(left.falseOverInferences).toEqual([]);
    expect(left.retractedClaims).toEqual(["offline-native-app", "cutoff-10:30"]);
    expect(left.autoStarted).toBe(false);
    expect(left.manualCodeEdits).toBe(0);
    expect(left.viewsEditPropagated).toBe(true);
    expect(left.maxActiveWorkers).toBe(1);
    expect(Object.keys(left.matrixCounts)).toHaveLength(12);
    expect(left.contradictionLayers).toHaveLength(5);
    expect(left.trailersValid).toBe(true);
    expect(left.cleanTree).toBe(true);
    expect(left.viewsTracked).toBe(0);
    expect(left.paperworkPct).toBeLessThanOrEqual(0.2);
    expect(fs.existsSync(path.join(first, ".harness", "views", "orders.md"))).toBe(true);
    const prompts = left.prompts.join("\n");
    const hidden = fs.readFileSync(path.join(root, "benchmarks", "m2-kitchen-e2e", "hidden", "acceptance-suite.json"), "utf8");
    expect(prompts.includes(JSON.parse(hidden).canary as string)).toBe(false);
    expect(left.filesRead.some((file) => file.includes("hidden"))).toBe(false);
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
  const held = await leasePort();
  const server = net.createServer();
  await new Promise<void>((resolve) => {
    server.listen(held, "127.0.0.1", () => resolve());
  });
  try {
    const next = await leasePort([held]);
    expect(next).not.toBe(held);
    expect(next).toBeGreaterThanOrEqual(PORT_MIN);
    expect(next).toBeLessThanOrEqual(PORT_MAX);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(await leakedPidProbe()).toBe(1);
  const dirty = fs.mkdtempSync(path.join(os.tmpdir(), "m2-views-"));
  try {
    const git = (args: string[]) => {
      const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
        cwd: dirty,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Kitchen Benchmark",
          GIT_AUTHOR_EMAIL: "kitchen@ef-harness.local",
          GIT_COMMITTER_NAME: "Kitchen Benchmark",
          GIT_COMMITTER_EMAIL: "kitchen@ef-harness.local",
        },
      });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    };
    git(["init", "-b", "harness/integration"]);
    fs.mkdirSync(path.join(dirty, ".harness", "views"), { recursive: true });
    fs.writeFileSync(path.join(dirty, ".harness", "views", "orders.md"), "cutoff\n", "utf8");
    git(["add", "--", ".harness/views/orders.md"]);
    git(["commit", "-m", "track views"]);
    const listed = spawnSync("git", ["ls-files", "--", ".harness/views"], { cwd: dirty, encoding: "utf8" }).stdout.trim();
    expect(listed).toContain("orders.md");
  } finally {
    fs.rmSync(dirty, { recursive: true, force: true });
  }
  const needle = ["sk", "_live_"].join("");
  const scanned = fs.mkdtempSync(path.join(os.tmpdir(), "m2-secret-"));
  try {
    fs.writeFileSync(path.join(scanned, "note.txt"), `token ${needle}\n`, "utf8");
    expect(secretFindings(fs.readFileSync(path.join(scanned, "note.txt"), "utf8")).length).toBe(1);
  } finally {
    fs.rmSync(scanned, { recursive: true, force: true });
  }
  const liveKey = process.env.EF_M2_LIVE_API_KEY;
  const routerKey = process.env.OPENROUTER_API_KEY;
  const confirm = process.env.EF_M2_LIVE_CONFIRM;
  delete process.env.EF_M2_LIVE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.EF_M2_LIVE_CONFIRM;
  try {
    const live = await runLiveCertification();
    expect(live.ran).toBe(false);
    expect(live.claimedCertification).toBe(false);
  } finally {
    if (liveKey !== undefined) process.env.EF_M2_LIVE_API_KEY = liveKey;
    if (routerKey !== undefined) process.env.OPENROUTER_API_KEY = routerKey;
    if (confirm !== undefined) process.env.EF_M2_LIVE_CONFIRM = confirm;
  }
}, 120_000);

it("certifies the scripted M2 kitchen exit gate in ci-replay", async () => {
  const report = await runCertifiedReplay();
  expect(report.gate.exitCode).toBe(0);
  const failed = report.checks.filter((check) => !check.pass).map((check) => `${check.id} ${check.detail}`);
  expect(failed).toEqual([]);
  expect(report.gate.reasons).toEqual([]);
  expect(report.hiddenPassRate).toBeGreaterThanOrEqual(0.9);
  expect(report.baseline.hiddenTotalCount).toBeGreaterThanOrEqual(25);
  expect(report.baseline.hiddenPassCount).toBe(report.baseline.hiddenTotalCount);
  expect(report.paperworkPct).toBeLessThanOrEqual(0.2);
  expect(report.leakedPids).toBe(0);
  expect(report.secretsFound).toBe(0);
  expect(report.staticAuditFailures).toBe(0);
  expect(report.falseOverInferences).toBe(0);
  expect(report.claimedCertification).toBe(true);
  expect(report.signature).toBe(signReport(signingView(report)));
  expect(report.stages).toContain("discovery-retraction");
  expect(report.stages).toContain("views-revision");
  expect(report.stages.indexOf("views-revision")).toBeLessThan(report.stages.indexOf("wave-1:sequential-workers"));
  expect(report.stages).toContain("completion-audit");
}, 120_000);

it("catches a removed server-side 11:01 cutoff and an email total mismatch", async () => {
  const cutoff = await runDefectCutoff();
  expect(cutoff.find((check) => check.id === "H-M2-05")?.pass).toBe(false);
  expect(cutoff.find((check) => check.id === "H-M2-29")?.pass).toBe(false);
  const mismatch = await runEmailMismatch();
  expect(mismatch.hiddenPass).toBe(false);
  expect(mismatch.oraclePass).toBe(true);
  expect(oracleAuthorVisibleExample(1).id).toBe("OR-email-visible");
}, 60_000);

it("writes failure forensics when the hidden pass rate drops under 90%", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2-artifacts-"));
  try {
    const drill = await runForensicsDrill(dir);
    expect(drill.passRate).toBeLessThan(0.9);
    expect(fs.existsSync(path.join(dir, "failing-checks.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "audit-receipts.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "db-snapshot"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "screenshot.png"))).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 90_000);
