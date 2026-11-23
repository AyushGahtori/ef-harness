import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(repoRoot, "benchmarks", "m6-release", "cli.ts");

export interface GateRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly jsonText: string;
  readonly markdownText: string;
  readonly scorecard: Scorecard;
}

export interface Scorecard {
  readonly decision: string;
  readonly decisionScope: string;
  readonly liveSignOff: string;
  readonly productionCertificationClaimed: boolean;
  readonly tagV1Authorized: boolean;
  readonly failingGateIds: readonly string[];
  readonly liveBlockers: readonly string[];
  readonly banner: string;
  readonly suites: readonly {
    readonly id: string;
    readonly verdict: string;
    readonly evidenceClass: string;
    readonly productExecuted: boolean;
  }[];
  readonly gates: readonly { readonly id: string; readonly verdict: string; readonly evidenceClass: string }[];
  readonly linuxCaseRepair: {
    readonly classification: string;
    readonly ciStatus: string;
    readonly repairPushes: number;
    readonly pushCap: number;
    readonly fourthPushRejected: boolean;
    readonly ledgerApproved: boolean;
    readonly linuxBefore: string;
    readonly localWindowsVerification: string;
    readonly repairStrategy: string;
    readonly twoStepIndexCase: string;
    readonly appliedRepairIndexCase: string;
    readonly brokenIndexCase: string;
    readonly brokenRenameAccepted: boolean;
    readonly singleStepGitMvIndexCase: string;
    readonly gitMvSingleStepChangedIndex: boolean;
  };
  readonly ship: {
    readonly phases: readonly string[];
    readonly stagingRollbackOnFailedSmoke: string;
    readonly productionRollbackOnFailedSmoke: string;
    readonly dockerArgvHasEnvSecret: boolean;
    readonly hosts: readonly string[];
  };
  readonly portability: {
    readonly cipher: string;
    readonly productionAgeFormat: boolean;
    readonly canonicalGraphMatch: boolean;
    readonly plaintextInGit: boolean;
    readonly laptopBInitialMode: string;
    readonly takeoverEpoch: number;
    readonly staleLaptopAMode: string;
    readonly staleForceWithLeaseRejected: boolean;
    readonly blindForcePushUsed: boolean;
    readonly lostKeyKnowledgePreserved: boolean;
    readonly lostKeyDecryptFailed: boolean;
    readonly oracleRegenerated: boolean;
    readonly publicPushDefault: string;
    readonly zipSlipRejected: boolean;
  };
  readonly broker: {
    readonly shares: { readonly interactive: number; readonly foreground: number; readonly background: number };
    readonly starved: boolean;
    readonly reservedInteractiveSlot: boolean;
  };
  readonly chaos: { readonly seeds: number; readonly violations: number; readonly integratedDaemon: boolean };
  readonly integration: {
    readonly swapCount: number;
    readonly unaccounted: readonly string[];
    readonly swaps: readonly { readonly task: string; readonly disposition: string; readonly port: string }[];
  };
  readonly hygiene: { readonly leakedPids: number; readonly unexpectedLeftovers: number; readonly tempRemoved: boolean };
  readonly artifacts: { readonly installerPresent: boolean; readonly authenticode: boolean; readonly cyclonedxSbomSha256: null };
  readonly integrity: { readonly algorithm: string; readonly contentSha256: string; readonly productionSignature: null };
}

export function runGate(args: readonly string[]): GateRun {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ef-m6-out-"));
  try {
    const result = spawnSync(process.execPath, [cli, "--out", out, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    const jsonPath = path.join(out, "V1_RELEASE_SCORECARD.json");
    const markdownPath = path.join(out, "V1_RELEASE_SCORECARD.md");
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`scorecard missing\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    }
    const jsonText = fs.readFileSync(jsonPath, "utf8");
    const markdownText = fs.readFileSync(markdownPath, "utf8");
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      jsonText,
      markdownText,
      scorecard: JSON.parse(jsonText) as Scorecard,
    };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}
