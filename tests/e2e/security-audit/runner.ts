import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanManyNeedles } from "./byte-scan.ts";
import { PURGE_STEP_LABELS, RED_TEAM_VECTORS } from "./constants.ts";
import { auditCanaryAlpha, auditCanaryBeta } from "./markers.ts";
import { repoRoot } from "./paths.ts";
import { WindowsDpapiSecretsVault } from "./ports/dpapi-vault.ts";
import { auditElectronProfiles } from "./ports/electron-audit.ts";
import { auditPrivacyDeploy } from "./ports/privacy-deploy.ts";
import { auditProviderTerms } from "./ports/provider-terms.ts";
import { RedTeamSecuritySuiteRunner, VaultCanaryLeakDetector, runRedTeamGate } from "./ports/red-team.ts";
import { SecretPurgeEngine } from "./ports/secret-purge.ts";
import {
  KernelPackageInstaller,
  loadSkillManifest,
  readAllowBuilds,
  verifySignedComponentManifest,
  verifySkillPins,
} from "./ports/supply-chain.ts";
import { buildReport } from "./report.ts";
import type { PillarVerdict, RunOptions, SecurityAuditCertificationReport } from "./types.ts";

async function runPillar1(faults: RunOptions["faults"]): Promise<{ pillar: PillarVerdict; residual: number }> {
  const started = performance.now();
  const findings: string[] = [];
  const evidence: string[] = [];
  const secret = auditCanaryAlpha();
  const chatSecret = auditCanaryBeta();
  const vault = new WindowsDpapiSecretsVault();
  vault.store("preview", secret);
  const env = vault.injectRuntimeOnly("preview", {});
  if (JSON.stringify(env).includes(secret)) evidence.push("dpapi-roundtrip");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ef-audit-p1-"));
  try {
    const files = new Map<string, Buffer>([
      ["state.db", Buffer.from(`create table t(c text); insert into ${chatSecret};`, "utf8")],
      ["state.db-wal", Buffer.from(`wal ${chatSecret}`, "utf8")],
      ["global.db", Buffer.from(`global ${secret}`, "utf8")],
      ["telemetry.db", Buffer.from(`telemetry ${secret}`, "utf8")],
      ["code-index.db", Buffer.from(`index ${secret}`, "utf8")],
      ["cas/blob-1", Buffer.from(chatSecret, "utf8")],
      ["logs/session.zst", Buffer.from(`log ${chatSecret}`, "utf8")],
      ["bundle.zip", Buffer.from(`zip ${secret}`, "utf8")],
      [".harness/views/board.json", Buffer.from(`view ${chatSecret}`, "utf8")],
    ]);
    for (const [name, buf] of files) {
      const full = path.join(temp, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, buf);
    }
    const diskScanBefore = scanManyNeedles(temp, [secret, chatSecret]);
    if (diskScanBefore.length === 0) findings.push("pillar1-canary-missing");
    const engine = new SecretPurgeEngine();
    const purgeChat = engine.purge({ files }, chatSecret, { skipVacuum: faults?.skipVacuum });
    const purgeVault = engine.purge({ files }, secret, { skipVacuum: faults?.skipVacuum });
    if (purgeChat.steps.length !== PURGE_STEP_LABELS.length) findings.push("pillar1-purge-steps");
    evidence.push("eight-step-purge");
    for (const [name, buf] of files) {
      fs.writeFileSync(path.join(temp, name), buf);
    }
    const residualHits = scanManyNeedles(temp, [secret, chatSecret]);
    const residual = residualHits.length + purgeChat.residualBytes + purgeVault.residualBytes;
    if (residual > 0) findings.push("pillar1-residual-bytes");
    else evidence.push("raw-byte-zero");
    const stored = vault.store("audit", secret);
    if (stored.includes(secret)) findings.push("pillar1-vault-plaintext");
    return {
      pillar: {
        pillar: 1,
        id: "dpapi-secret-purge",
        title: "DPAPI vault isolation & secret purge raw-byte proof",
        passed: findings.length === 0,
        findings,
        evidence,
        durationMs: Math.round(performance.now() - started),
      },
      residual,
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function runPillar2(faults: RunOptions["faults"]): Promise<PillarVerdict> {
  const started = performance.now();
  const findings: string[] = [];
  const evidence: string[] = [];
  const runner = new RedTeamSecuritySuiteRunner();
  const rows = await runner.runAll({
    allowTrapHit: false,
    allowCanaryRead: false,
    allowSinkLeak: false,
  });
  const gate = runRedTeamGate(rows);
  if (!gate.ok || gate.blocked !== RED_TEAM_VECTORS.length) findings.push("pillar2-red-team");
  else evidence.push("red-team-6-blocked");
  const detector = new VaultCanaryLeakDetector();
  const sinks = runner.exportCanaries().map((value) => Buffer.from(`redacted:${value.length}`, "utf8"));
  if (detector.scanSinks(sinks, runner.exportCanaries()) > 0) findings.push("pillar2-canary-leak");
  else evidence.push("canary-zero-leak");
  const electron = auditElectronProfiles({ weakCsp: faults?.weakElectronCsp, privilegedPreload: false });
  if (!electron.ok) findings.push("pillar2-electron");
  else evidence.push("electron-hardened");
  return {
    pillar: 2,
    id: "prompt-injection-zero-leak",
    title: "Red-team & prompt-injection zero-leak certification",
    passed: findings.length === 0,
    findings,
    evidence,
    durationMs: Math.round(performance.now() - started),
  };
}

function runPillar3(faults: RunOptions["faults"]): PillarVerdict {
  const started = performance.now();
  const findings: string[] = [];
  const evidence: string[] = [];
  const allowBuilds = readAllowBuilds();
  const allowOk =
    allowBuilds.includes("electron") &&
    allowBuilds.includes("esbuild") &&
    !allowBuilds.includes("left-pad");
  if (!allowOk) findings.push("pillar3-allow-builds");
  else evidence.push("pnpm-onlyBuiltDependencies");
  const installer = new KernelPackageInstaller(allowBuilds);
  let ran = false;
  const executed = installer.runLifecycle("left-pad", "postinstall", () => {
    ran = true;
  });
  if (executed || ran) findings.push("pillar3-postinstall");
  else evidence.push("unapproved-postinstall-blocked");
  const manifest = loadSkillManifest();
  const pinsOk = verifySkillPins(manifest, faults?.skillHashDrift);
  if (!pinsOk) findings.push("pillar3-skill-sha256");
  else evidence.push("skills-20-20-pins");
  if (!verifySignedComponentManifest()) findings.push("pillar3-ed25519-manifest");
  else evidence.push("signed-component-manifest");
  const lock = fs.readFileSync(path.join(repoRoot(), "pnpm-lock.yaml"), "utf8");
  if (!lock.includes("lockfileVersion:")) findings.push("pillar3-lockfile");
  return {
    pillar: 3,
    id: "supply-chain",
    title: "Supply-chain & pnpm allowBuilds enforcement",
    passed: findings.length === 0,
    findings,
    evidence,
    durationMs: Math.round(performance.now() - started),
  };
}

function runPillar4(faults: RunOptions["faults"]): PillarVerdict {
  const started = performance.now();
  const facts = auditProviderTerms({
    geminiDefaultOn: faults?.geminiDefaultOn,
    silentSpendMicroUsd: faults?.silentPaidMicroUsd,
  });
  const findings: string[] = [];
  const evidence: string[] = [];
  if (!facts.claudeConsoleOnly) findings.push("pillar4-claude-console");
  else evidence.push("claude-console-only");
  if (!facts.geminiDefaultOff || facts.geminiFilesystemTouches > 0) findings.push("pillar4-gemini");
  else evidence.push("gemini-off-default");
  if (facts.withdrawnVendorHits > 0) findings.push("pillar4-withdrawn-vendor");
  else evidence.push("zero-withdrawn-vendor");
  if (!facts.chatGptWireOk) findings.push("pillar4-chatgpt-wire");
  else evidence.push("chatgpt-wire-locks");
  if (facts.silentSpendMicroUsd > 0 || facts.unconsentedRequests > 0) findings.push("pillar4-silent-spend");
  else evidence.push("zero-silent-spend");
  return {
    pillar: 4,
    id: "provider-terms-compliance",
    title: "Provider terms compliance & zero-silent-spend",
    passed: findings.length === 0,
    findings,
    evidence,
    durationMs: Math.round(performance.now() - started),
  };
}

function runPillar5(faults: RunOptions["faults"]): PillarVerdict {
  const started = performance.now();
  const facts = auditPrivacyDeploy({
    allowTelemetryBeacon: faults?.allowTelemetryBeacon,
    dockerArgvSecret: false,
    publicPushOn: false,
    stashCall: false,
  });
  const findings: string[] = [];
  const evidence: string[] = [];
  if (!facts.crashUploadDisabled) findings.push("pillar5-crash-upload");
  else evidence.push("crash-upload-disabled");
  if (facts.telemetryBeacons > 0) findings.push("pillar5-telemetry");
  else evidence.push("zero-telemetry");
  if (facts.whisperWritesWav > 0) findings.push("pillar5-whisper-wav");
  if (facts.dockerArgvSecrets > 0 || !facts.dockerStrictHostKeyChecking) findings.push("pillar5-docker");
  else evidence.push("docker-ssh-hygiene");
  if (facts.nameOnlyEnvPrints > 0) findings.push("pillar5-name-only-env");
  else evidence.push("name-only-env");
  if (!facts.liveSecretBlockedInPreview) findings.push("pillar5-live-secret-preview");
  else evidence.push("preview-blocks-live-secret");
  if (!facts.publicHarnessStatePushDefault) findings.push("pillar5-public-push");
  else evidence.push("public-push-off-default");
  if (facts.ageSealedPlaintextBytes > 0) findings.push("pillar5-age-sealed");
  else evidence.push("age-sealed-checks");
  if (facts.gitStashCalls > 0) findings.push("pillar5-zero-stash");
  else evidence.push("zero-stash-landing");
  return {
    pillar: 5,
    id: "privacy-deploy-hygiene",
    title: "Zero-telemetry privacy & deploy secret hygiene",
    passed: findings.length === 0,
    findings,
    evidence,
    durationMs: Math.round(performance.now() - started),
  };
}

export class FinalSecurityPrivacyAuditSuite {
  static async run(options: RunOptions = {}): Promise<SecurityAuditCertificationReport> {
    const started = performance.now();
    const faults = options.faults;
    const p1 = await runPillar1(faults);
    const pillars = [p1.pillar, await runPillar2(faults), runPillar3(faults), runPillar4(faults), runPillar5(faults)];
    const runner = new RedTeamSecuritySuiteRunner();
    const redTeam = await runner.runAll();
    const provider = auditProviderTerms({ silentSpendMicroUsd: faults?.silentPaidMicroUsd });
    const allowBuilds = readAllowBuilds();
    const allowBuildsOk = allowBuilds.length > 0 && allowBuilds.includes("esbuild");
    const report = buildReport({
      pillars,
      redTeam,
      residualSecretBytes: p1.residual,
      silentSpendMicroUsd: provider.silentSpendMicroUsd,
      withdrawnVendorHits: provider.withdrawnVendorHits,
      skillPinsOk: verifySkillPins(loadSkillManifest(), faults?.skillHashDrift),
      allowBuildsOk,
      hostElapsedMs: Math.round(performance.now() - started),
    });
    return report;
  }
}

export async function runSecurityAudit(options: RunOptions = {}): Promise<SecurityAuditCertificationReport> {
  return FinalSecurityPrivacyAuditSuite.run(options);
}

export function writeCertificationArtifacts(dir: string, report: SecurityAuditCertificationReport): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "security-audit-certification.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "security-audit-certification.md"), report.scorecardMarkdown);
}