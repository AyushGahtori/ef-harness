export interface TokenSplit {
  discovery: number;
  spec: number;
  research: number;
  architecture: number;
  planning: number;
  audit: number;
  coding: number;
}

export interface BaselineMetrics {
  totalWallClockSec: number;
  phase0Sec: number;
  waveBuildSec: number;
  completionAuditSec: number;
  totalTokens: number;
  paperworkPct: number;
  hiddenPassCount: number;
  hiddenTotalCount: number;
  passRatePct: number;
}

export interface HiddenCheckResult {
  id: string;
  title: string;
  pass: boolean;
  detail: string;
}

export interface GateDecision {
  exitCode: 0 | 1;
  reasons: string[];
}

export interface SettledDiscovery {
  platform: string;
  cutoff: string;
  dietaryNote: boolean;
  delegated: string[];
}

export interface ContradictionLayer {
  id: string;
  settled: "clear" | "conflict";
  probe: "clear" | "conflict";
}

export interface PipelineTrace {
  stages: string[];
  filesRead: string[];
  prompts: string[];
  falseOverInferences: string[];
  retractedClaims: string[];
  settled: SettledDiscovery;
  autoStarted: boolean;
  manualCodeEdits: number;
  viewsEditPropagated: boolean;
  viewsTracked: number;
  trailersValid: boolean;
  cleanTree: boolean;
  integrationSubjects: string[];
  maxActiveWorkers: number;
  matrixCounts: Record<string, number>;
  contradictionLayers: ContradictionLayer[];
  staticAuditFailures: number;
  secretsFound: number;
  paperworkPct: number;
  tokens: TokenSplit;
  durations: Pick<BaselineMetrics, "totalWallClockSec" | "phase0Sec" | "waveBuildSec" | "completionAuditSec">;
  projectDir: string;
  stateNodes: number;
}

export interface SuiteTarget {
  origin: string;
  dbPath: string;
  mailpitUrl: string;
  repoDir: string;
  axeSource: string;
  catalogPath: string;
  timeoutMs: number;
}

export interface SuiteOutcome {
  checks: HiddenCheckResult[];
  screenshot: Buffer | null;
  consoleErrors: string[];
}

export interface M2ExitGateReport {
  schema: "m2-exit-gate-report@1";
  mode: "ci-replay" | "live-provider";
  signature: string;
  baseline: BaselineMetrics;
  gate: GateDecision;
  hiddenPassRate: number;
  paperworkPct: number;
  leakedPids: number;
  secretsFound: number;
  staticAuditFailures: number;
  falseOverInferences: number;
  checks: HiddenCheckResult[];
  stages: string[];
  claimedCertification: boolean;
  hostElapsedMs: number;
}

export interface LiveCertification {
  ran: boolean;
  claimedCertification: boolean;
  accepted: number | null;
  reason?: string;
}
