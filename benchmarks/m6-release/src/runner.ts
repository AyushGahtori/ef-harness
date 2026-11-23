import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256Bytes } from "./canonical.ts";
import { certifyLinuxCaseRepair } from "./case-repair.ts";
import { certifyChaos } from "./chaos-oracle.ts";
import { runFoundationChecks } from "./foundation-checks.ts";
import { buildGates, milestoneVerdicts, suiteRollups } from "./gates.ts";
import { removeTree } from "./git-util.ts";
import { scanIntegration } from "./integration-closure.ts";
import { certifyPortability } from "./portability-port.ts";
import { certifyBroker } from "./broker.ts";
import { applyReplayInject, baseReplayMatrix } from "./replay-matrix.ts";
import { decide, renderScorecardMarkdown, serializeScorecard, withIntegrity } from "./scorecard.ts";
import { certifyShipPort } from "./ship-port.ts";
import type { CertificationProfile, V1ReleaseScorecard } from "./types.ts";

export interface CertificationRequest {
  readonly profile: CertificationProfile;
  readonly repoRoot: string;
  readonly outDir: string;
  readonly inject: readonly string[];
  readonly unsignedDev: boolean;
}

function componentDigests(repoRoot: string): { path: string; sha256: string }[] {
  const root = path.join(repoRoot, "benchmarks", "m6-release");
  const files: string[] = [];
  walk(root, files);
  return files
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((full) => ({
      path: path.relative(repoRoot, full).replaceAll("\\", "/"),
      sha256: sha256Bytes(fs.readFileSync(full)),
    }));
}

function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
}

export function runCertification(request: CertificationRequest): V1ReleaseScorecard {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ef-m6-"));
  const stray = path.join(os.tmpdir(), `ef-m6-stray-${path.basename(temp)}`);
  const unexpectedLeftovers = request.inject.includes("stray-temp") ? 1 : 0;
  if (unexpectedLeftovers === 1) fs.writeFileSync(stray, "stray");
  try {
    const matrix = applyReplayInject(baseReplayMatrix(), request.inject);
    const linux = certifyLinuxCaseRepair(path.join(temp, "case"), request.inject);
    const ship = certifyShipPort();
    const portability = certifyPortability(path.join(temp, "port"));
    const broker = certifyBroker();
    const chaos = certifyChaos(request.profile === "full-release-certification" ? 1000 : 50, request.inject);
    const foundation = runFoundationChecks(request.repoRoot, request.inject);
    const integration = scanIntegration(request.repoRoot, request.inject);
    removeTree(temp);
    if (fs.existsSync(stray)) fs.rmSync(stray, { force: true });
    const tempRemoved = !fs.existsSync(temp) && !fs.existsSync(stray);
    const hygiene = { leakedPids: 0, unexpectedLeftovers, tempRemoved };
    const gates = buildGates({
      matrix,
      repoRoot: request.repoRoot,
      linux,
      ship,
      portability,
      broker,
      chaos,
      foundation,
      integration,
      profile: request.profile,
      unsignedDev: request.unsignedDev,
      hygiene,
    });
    const finalDecision = decide(request.profile, gates);
    const schemaPassed = foundation.some((item) => item.id === "schema-test-67" && item.verdict === "PASS");
    const body = {
      schema: "ef-harness.v1-release-scorecard.v1" as const,
      profile: request.profile,
      candidateVersion: "v1.0.0" as const,
      gitCommit: integration.gitCommit,
      branch: integration.branch,
      decision: finalDecision.decision,
      decisionScope: finalDecision.decisionScope,
      liveSignOff: finalDecision.liveSignOff,
      productionCertificationClaimed: finalDecision.productionCertificationClaimed,
      tagV1Authorized: finalDecision.tagV1Authorized,
      unsignedDev: request.unsignedDev,
      banner: finalDecision.banner,
      failingGateIds: finalDecision.failingGateIds,
      liveBlockers: finalDecision.liveBlockers,
      suites: suiteRollups(gates),
      milestones: milestoneVerdicts(schemaPassed),
      gates,
      linuxCaseRepair: linux,
      ship,
      portability,
      broker,
      chaos,
      integration: {
        swapCount: integration.swapCount,
        handoffPresentCount: integration.handoffPresentCount,
        unaccounted: integration.unaccounted,
        conflicts: integration.conflicts,
        swaps: integration.swaps,
      },
      hygiene,
      componentDigests: componentDigests(request.repoRoot),
      artifacts: {
        installerPresent: false as const,
        authenticode: false as const,
        latestYmlSha512: false as const,
        cyclonedxSbomSha256: null,
        productionSignature: null,
      },
    };
    const scorecard = withIntegrity(body);
    fs.mkdirSync(request.outDir, { recursive: true });
    fs.writeFileSync(path.join(request.outDir, "V1_RELEASE_SCORECARD.json"), serializeScorecard(scorecard), "utf8");
    fs.writeFileSync(path.join(request.outDir, "V1_RELEASE_SCORECARD.md"), renderScorecardMarkdown(scorecard), "utf8");
    return scorecard;
  } catch (error) {
    removeTree(temp);
    if (fs.existsSync(stray)) fs.rmSync(stray, { force: true });
    throw error;
  }
}

export class V1ReleaseCertificationRunner {
  readonly request: CertificationRequest;

  constructor(request: CertificationRequest) {
    this.request = request;
  }

  run(): V1ReleaseScorecard {
    return runCertification(this.request);
  }
}
