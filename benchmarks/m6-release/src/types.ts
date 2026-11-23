export const SCORECARD_SCHEMA = "ef-harness.v1-release-scorecard.v1" as const;
export const CANDIDATE_VERSION = "v1.0.0" as const;
export const LOCAL_PORT_CIPHER = "local-port-x25519-aes-gcm-v1" as const;

export type CertificationProfile = "ci-replay" | "full-release-certification";
export type EvidenceClass =
  | "executed-local"
  | "executed-foundation"
  | "local-port-fixture"
  | "unavailable-on-base";
export type GateVerdict = "PASS" | "FAIL" | "WITHHELD";
export type ReleaseDecision = "GO" | "NO-GO";

export interface CheckResult {
  readonly id: string;
  readonly verdict: GateVerdict;
  readonly evidenceClass: EvidenceClass;
  readonly observed: string;
  readonly expected: string;
}

export interface GateResult {
  readonly id: string;
  readonly verdict: GateVerdict;
  readonly evidenceClass: EvidenceClass;
  readonly productExecuted: false;
  readonly requiredForCiReplay: boolean;
  readonly requiredForLiveSignOff: boolean;
  readonly veto: boolean;
  readonly summary: string;
  readonly checks: readonly CheckResult[];
}

export interface MilestoneVerdict {
  readonly id: "M0" | "M1" | "M2" | "M3" | "M4" | "M5" | "M6";
  readonly verdict: GateVerdict;
  readonly evidenceClass: EvidenceClass;
  readonly summary: string;
}

export interface SuiteRollup {
  readonly id: string;
  readonly verdict: GateVerdict;
  readonly evidenceClass: EvidenceClass;
  readonly productExecuted: false;
  readonly summary: string;
}

export interface IntegrationSwap {
  readonly task: string;
  readonly disposition: "local-port-swap" | "handoff-present" | "unaccounted" | "conflict";
  readonly port: string;
  readonly exports: readonly string[];
}

export interface LinuxCaseRepairTrace {
  readonly classification: string;
  readonly localWindowsVerification: "PASS" | "FAIL";
  readonly linuxBefore: string;
  readonly ciStatus: "CI_GREEN" | "CI_RED";
  readonly repairPushes: number;
  readonly pushCap: 3;
  readonly fourthPushRejected: boolean;
  readonly ledgerApproved: boolean;
  readonly importBefore: string;
  readonly importAfter: string;
  readonly repairStrategy: "two-step-git-mv" | "filesystem-rename-plus-add";
  readonly twoStepIndexCase: string;
  readonly appliedRepairIndexCase: string;
  readonly brokenIndexCase: string;
  readonly brokenRenameAccepted: boolean;
  readonly singleStepGitMvIndexCase: string;
  readonly gitMvSingleStepChangedIndex: boolean;
}

export interface ShipTrace {
  readonly phases: readonly string[];
  readonly destructiveBlockedInExpand: boolean;
  readonly backupFailureBlocksExpand: boolean;
  readonly pauseResumeFromPk: number;
  readonly backfillComplete: boolean;
  readonly contractBlockedWhileIncomplete: boolean;
  readonly stagingRollbackOnFailedSmoke: "automatic";
  readonly productionRollbackOnFailedSmoke: "offered";
  readonly happyPathSmoke: "pass";
  readonly deployedBuildId: string;
  readonly vercelBuildId: string;
  readonly dockerSshBuildId: string;
  readonly dockerArgv: readonly string[];
  readonly dockerArgvHasEnvSecret: boolean;
  readonly hosts: readonly string[];
}

export interface PortabilityTrace {
  readonly cipher: typeof LOCAL_PORT_CIPHER;
  readonly productionAgeFormat: false;
  readonly canonicalGraphSha256: string;
  readonly canonicalGraphMatch: boolean;
  readonly plaintextInGit: boolean;
  readonly laptopBInitialMode: "read-only" | "read-write" | "fenced";
  readonly takeoverEpoch: number;
  readonly staleLaptopAMode: "read-only" | "read-write" | "fenced";
  readonly staleForceWithLeaseRejected: boolean;
  readonly blindForcePushUsed: false;
  readonly lostKeyKnowledgePreserved: boolean;
  readonly lostKeyDecryptFailed: boolean;
  readonly oracleRegenerated: boolean;
  readonly publicPushDefault: "off" | "on";
  readonly zipSlipRejected: boolean;
  readonly secretExportBlocked: boolean;
}

export interface BrokerTrace {
  readonly projects: readonly string[];
  readonly shares: Readonly<Record<string, number>>;
  readonly starved: boolean;
  readonly reservedInteractiveSlot: boolean;
}

export interface ChaosTrace {
  readonly seeds: number;
  readonly violations: number;
  readonly implementation: "local-port-oracle";
  readonly integratedDaemon: false;
}

export interface V1ReleaseScorecard {
  readonly schema: typeof SCORECARD_SCHEMA;
  readonly profile: CertificationProfile;
  readonly candidateVersion: typeof CANDIDATE_VERSION;
  readonly gitCommit: string;
  readonly branch: string;
  readonly decision: ReleaseDecision;
  readonly decisionScope: "ci-replay" | "live-sign-off";
  readonly liveSignOff: "WITHHELD" | "GRANTED";
  readonly productionCertificationClaimed: boolean;
  readonly tagV1Authorized: boolean;
  readonly unsignedDev: boolean;
  readonly banner: string;
  readonly failingGateIds: readonly string[];
  readonly liveBlockers: readonly string[];
  readonly suites: readonly SuiteRollup[];
  readonly milestones: readonly MilestoneVerdict[];
  readonly gates: readonly GateResult[];
  readonly linuxCaseRepair: LinuxCaseRepairTrace;
  readonly ship: ShipTrace;
  readonly portability: PortabilityTrace;
  readonly broker: BrokerTrace;
  readonly chaos: ChaosTrace;
  readonly integration: {
    readonly swapCount: number;
    readonly handoffPresentCount: number;
    readonly unaccounted: readonly string[];
    readonly conflicts: readonly string[];
    readonly swaps: readonly IntegrationSwap[];
  };
  readonly hygiene: {
    readonly leakedPids: number;
    readonly unexpectedLeftovers: number;
    readonly tempRemoved: boolean;
  };
  readonly componentDigests: readonly { readonly path: string; readonly sha256: string }[];
  readonly artifacts: {
    readonly installerPresent: false;
    readonly authenticode: false;
    readonly latestYmlSha512: false;
    readonly cyclonedxSbomSha256: null;
    readonly productionSignature: null;
  };
  readonly integrity: {
    readonly algorithm: "sha256";
    readonly contentSha256: string;
    readonly productionSignature: null;
  };
}
