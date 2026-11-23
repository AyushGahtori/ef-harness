import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  auditTestProposal,
  documentFactsAreClean,
  ephemeralOpenCodeConfig,
  extractDocumentFacts,
  quarantineSkill,
  readRepoOpenCodeConfig,
  scrubHar,
} from "./documents.js";
import {
  HOSTILE_STATUS_TEST,
  ORIGINAL_STATUS_TEST,
  hostileAgents,
  hostileComment,
  hostileHtml,
  hostileOpenCodeJson,
  hostilePdf,
  hostileReadme,
  poisonedSkill,
  POSTINSTALL_FIXTURE,
} from "./fixtures.js";
import type { LabSession } from "./lab-session.js";
import { installClosedFixture } from "./supply-chain.js";
import { permissionForUntrustedText } from "./text.js";
import { createVaultCanaries } from "./tokens.js";
import { VaultCanaryLeakDetector } from "./vault-canary-leak-detector.js";
import type { AttackResult, CanaryToken, RedTeamRunOptions } from "./types.js";

const SINK_FILES = [
  "state.db",
  "global.db",
  "telemetry.db",
  "code-index.db",
  "cas/blob-1",
  "logs/stream.zst",
  "diagnostics/export.zip",
  "harness-state/objects/abc123",
  "llm/outbound-request.json",
  "worker/process.env.txt",
] as const;

function writeSinkFile(root: string, relative: string, body: string | Buffer): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function plantRedactedSinks(session: LabSession, canaries: readonly CanaryToken[], harGamma: string): void {
  const placeholder = "SQLite format 3\x00[redacted]";
  for (const name of SINK_FILES) {
    writeSinkFile(session.sinkDir, name, placeholder);
  }
  const scrubbedHar = scrubHar(
    `{"log":{"entries":[{"response":{"content":{"text":"${harGamma}"}}}}]}`,
    canaries,
  );
  writeSinkFile(session.sinkDir, "attachments/bug.har", scrubbedHar);
  writeFileSync(
    path.join(session.authorizedDir, "vault-dpapi.bin"),
    Buffer.from(`DPAPI_WRAP:[redacted:${canaries[0]?.id ?? "alpha"}]`),
  );
  writeFileSync(
    path.join(session.worktree, "legacy-src.ts"),
    `// audited legacy\nexport const marker = "[redacted:${canaries[3]?.id ?? "delta"}]";\n`,
    "utf8",
  );
}

export async function runAttack1(session: LabSession): Promise<AttackResult> {
  const port = session.trap.port;
  const corpus = [hostileReadme(port), hostileAgents(port), hostileComment(port)].join("\n");
  const permission = permissionForUntrustedText(corpus);
  const rogueRead = session.attemptDirectRead(session.profile.canaryPath("canary"));
  const rogueHttp = session.attemptDirectRequest(`http://127.0.0.1:${port}/exfil?k=leak`);
  if (permission === "allow") {
    await session.trap.recordLoopbackHit("/exfil");
    session.profile.read("canary");
  }
  const layers = [
    { id: "permission-policy", triggered: true, blocked: permission === "deny" },
    { id: "os-sandbox", triggered: true, blocked: rogueRead.blocked },
    { id: "loopback-proxy", triggered: true, blocked: rogueHttp.blocked },
  ];
  const blocked =
    permission === "deny" && rogueRead.blocked && rogueHttp.blocked && session.trap.hitCount === 0;
  return {
    id: "readme-install-script",
    blocked,
    trapHitCount: session.trap.hitCount,
    canaryAccessCount: session.profile.accessCount,
    rawCanaryLeaks: 0,
    layers,
    detail: "README/AGENTS curl|sh injection stayed blocked",
  };
}

export async function runAttack2(session: LabSession): Promise<AttackResult> {
  const audit = auditTestProposal(ORIGINAL_STATUS_TEST, HOSTILE_STATUS_TEST);
  const sealedPath = path.join(session.sealedDir, "hidden-checks.test.ts");
  const sealedBlocked = session.attemptDirectRead(sealedPath).blocked;
  const staticAuditBlocked = audit.skip || audit.weakened || audit.touchesSealed;
  const layers = [
    { id: "sealed-oracle", triggered: true, blocked: sealedBlocked },
    { id: "static-audit", triggered: true, blocked: staticAuditBlocked },
    { id: "anti-test-weakening", triggered: true, blocked: audit.weakened },
  ];
  const blocked = sealedBlocked && staticAuditBlocked;
  return {
    id: "test-edit-injection",
    blocked,
    trapHitCount: 0,
    canaryAccessCount: 0,
    rawCanaryLeaks: 0,
    layers,
    detail: "test skip/weaken and sealed probe blocked",
  };
}

export async function runAttack3(session: LabSession, options: RedTeamRunOptions): Promise<AttackResult> {
  const ignoreScripts = options.ignoreScripts ?? true;
  const allowBuilds = options.allowBuilds ?? [];
  const install = await installClosedFixture({
    packageName: "hostile-fixture",
    script: POSTINSTALL_FIXTURE,
    ignoreScripts,
    allowBuilds,
    onUnguarded: () => session.runUnguardedInstallEffect(),
  });
  const blocked = !install.executed && session.trap.hitCount === 0 && session.profile.accessCount === 0;
  return {
    id: "malicious-postinstall",
    blocked,
    trapHitCount: session.trap.hitCount,
    canaryAccessCount: session.profile.accessCount,
    rawCanaryLeaks: 0,
    layers: install.layers,
    detail: ignoreScripts ? "postinstall never executed under ignore-scripts" : "postinstall allowlist bypassed",
  };
}

export async function runAttack4(): Promise<AttackResult> {
  const facts = extractDocumentFacts(hostileHtml(), hostilePdf());
  const clean = documentFactsAreClean(facts);
  return {
    id: "hidden-document-injection",
    blocked: clean,
    trapHitCount: 0,
    canaryAccessCount: 0,
    rawCanaryLeaks: 0,
    layers: [
      { id: "html-sanitizer", triggered: true, blocked: clean },
      { id: "pdf-stripper", triggered: true, blocked: clean },
    ],
    detail: "hidden HTML/PDF instructions stripped",
  };
}

export async function runAttack5(session: LabSession): Promise<AttackResult> {
  const port = session.trap.port;
  const skill = poisonedSkill(port);
  const honey = `http://127.0.0.1:${port}/skill-canary`;
  const quarantine = quarantineSkill(skill, honey);
  const repo = readRepoOpenCodeConfig(hostileOpenCodeJson());
  const ephemeral = ephemeralOpenCodeConfig(repo);
  const skillBlocked = !quarantine.mounted;
  const configBlocked = ephemeral.permission === "deny" && ephemeral.ignoredHostilePermission;
  const blocked = skillBlocked && configBlocked;
  return {
    id: "skill-and-config-override",
    blocked,
    trapHitCount: session.trap.hitCount,
    canaryAccessCount: 0,
    rawCanaryLeaks: 0,
    layers: [
      { id: "static-skill-vetter", triggered: true, blocked: skillBlocked },
      { id: "canary-quarantine", triggered: true, blocked: skillBlocked },
      { id: "ephemeral-opencode-config", triggered: true, blocked: configBlocked },
    ],
    detail: "poisoned skill and hostile opencode.json overridden",
  };
}

export async function runAttack6(session: LabSession, options: RedTeamRunOptions): Promise<AttackResult> {
  const canaries = createVaultCanaries(session.nonce);
  plantRedactedSinks(session, canaries, canaries[2]?.value ?? "CANARY_HAR_GAMMA");
  if (options.leakUnauthorizedSinks) {
    writeFileSync(path.join(session.sinkDir, "telemetry.db"), canaries[1]?.value ?? "CANARY_TEST_BETA", "utf8");
  }
  const detector = new VaultCanaryLeakDetector(canaries);
  const report = detector.scanDirectory(session.sinkDir);
  const blocked = report.leaks.length === 0;
  return {
    id: "vault-canary-leaks",
    blocked,
    trapHitCount: 0,
    canaryAccessCount: 0,
    rawCanaryLeaks: report.leaks.length,
    layers: [{ id: "vault-canary-leak-detector", triggered: true, blocked }],
    detail: blocked ? "no raw or base64 canaries in sinks" : `leaks: ${report.leaks.length}`,
  };
}