export type PhaseName = "phase0" | "wave" | "merge" | "audit";
export type TaskKind = "model" | "merge";
export type PressureLevel = "GREEN" | "YELLOW" | "ORANGE" | "RED";
export type RunMode = "ci-replay" | "live-provider";

export interface WorkTask {
  id: string;
  phase: PhaseName;
  feature: string;
  kind: TaskKind;
  tokens: number;
  avgExecSec: number;
  deps: string[];
}

export interface WorkGraph {
  schema: string;
  tasks: WorkTask[];
}

export interface LatencyCurve {
  schema: string;
  coding: { tokens: number; seconds: number };
  paperworkTokens: number;
  codingTokens: number;
  totalTokens: number;
  jitterRetrySec: number;
  jitterTaskId: string;
}

export interface MachineProfile {
  schema: string;
  ramGb: number;
  thinkingPool: number;
  warmSlots: number;
  sessionCap: number;
  pacingCap: number;
  worktreeSlots: number;
  preset: "Balanced" | "Fastest" | "Cheapest";
  presetCap: number;
  orangeEnterMs: number;
  greenRecoverMs: number;
  spikeIgnoredMs: number;
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

export interface HiddenCheck {
  id: string;
  title: string;
}

export interface HiddenSuiteDoc {
  schema: string;
  canary: string;
  independentOfOracleAuthor: boolean;
  checks: HiddenCheck[];
}

export interface HiddenCheckResult {
  id: string;
  title: string;
  pass: boolean;
  detail: string;
}

export interface Assignment {
  id: string;
  startSec: number;
  finishSec: number;
  worker: string;
}

export interface ScheduleResult {
  makespanSec: number;
  sequentialSec: number;
  phase0Sec: number;
  waveBuildSec: number;
  mergeQueueSec: number;
  completionAuditSec: number;
  wEff: number;
  preset: MachineProfile["preset"];
  assignments: Assignment[];
}

export interface MergeCommitRecord {
  featureId: string;
  sha: string;
  subject: string;
  parents: number;
  trailers: Record<string, string>;
  branch: string;
}

export interface MergeReport {
  commits: MergeCommitRecord[];
  held: string[];
  clean: boolean;
  sameSecondSerialized: boolean;
}

export interface QueueFeature {
  id: string;
  slug: string;
  buildId: string;
  tasks: string;
  requirements: string;
  checks: string;
  finishedAtSec: number;
  body: string;
  regression: boolean;
}

export interface KitchenBuild {
  orderPersisted: boolean;
  dietaryStored: boolean;
  modifyBeforeCutoff: boolean;
  cancelBeforeCutoff: boolean;
  serverRejectsAt1101: boolean;
  serverRejectsEditAt1101: boolean;
  serverRejectsAt1100: boolean;
  uiSubmitDisabledAfterCutoff: boolean;
  uiEditDisabledAfterCutoff: boolean;
  noDuplicateSubmit: boolean;
  noDuplicateRace: boolean;
  kitchenTotalsExact: boolean;
  dietaryVisible: boolean;
  printOverflowPx: number;
  printTotalsMatch: boolean;
  emailArrived: boolean;
  emailMatchesDb: boolean;
  emailDeduped: boolean;
  anonMenuStatus: number;
  staffMenuStatus: number;
  anonEmailStatus: number;
  staffEmailStatus: number;
  consoleErrors: number;
  brokenImages: number;
  axeSerious: number;
  styleguideInBundle: boolean;
  styleguideRoute: boolean;
  tokenLintOk: boolean;
  clientTimestampIgnored: boolean;
}

export interface DbCertificate {
  p99Ms: number;
  busy: number;
  samples: number;
  workers: number;
  windowMs: number;
  scenarioWindowSec: number;
  slowSql: string;
  slowMs: number;
  pass: boolean;
  detail: string[];
}

export interface BoardCertificate {
  tasks: number;
  requirements: number;
  initialMs: number;
  boardUpdateMs: number;
  boardPaintP95Ms: number;
  pass: boolean;
  detail: string[];
}

export interface ScenarioResult {
  id: string;
  title: string;
  pass: boolean;
  detail: string;
}

export interface StopProbe {
  result: ScenarioResult;
  stopLatencyMs: number;
  leakedPids: number;
  postStopMerges: number;
  unauthorizedClaims: number;
  unauthorizedTokens: number;
  wipBranch: string;
  handoffPath: string;
}

export interface GateDecision {
  exitCode: 0 | 1;
  reasons: string[];
  detail: string[];
  passRateDeltaPct: number;
}

export interface M3RunSlice {
  totalWallClockSec: number;
  phase0Sec: number;
  waveBuildSec: number;
  mergeQueueSec: number;
  completionAuditSec: number;
  totalTokens: number;
  paperworkPct: number;
  hiddenPassCount: number;
  hiddenTotalCount: number;
  passRatePct: number;
}

export interface M3ExitGateReport {
  schema: "m3-exit-gate-report@1";
  mode: RunMode;
  signature: string;
  m2: BaselineMetrics;
  m3: M3RunSlice;
  speedupRatio: number;
  passRateDelta: number;
  dbWriteP99Ms: number;
  boardUpdateMs: number;
  boardPaintP95Ms: number;
  stopLatencyMs: number;
  leakedPids: number;
  secretsFound: number;
  sqliteBusy: number;
  viewsTracked: number;
  postStopMerges: number;
  unauthorizedClaims: number;
  unauthorizedTokens: number;
  wEff: number;
  preset: string;
  dbSamples: number;
  dbWorkers: number;
  dbWindowMs: number;
  scenarioWindowSec: number;
  boardTasks: number;
  boardRequirements: number;
  scenarios: ScenarioResult[];
  checks: HiddenCheckResult[];
  mergeCommits: MergeCommitRecord[];
  gate: GateDecision;
  claimedCertification: boolean;
  hostElapsedMs: number;
}

export interface LiveCertification {
  ran: boolean;
  claimedCertification: boolean;
  reason: string;
}

export interface M3Fixtures {
  root: string;
  baseline: BaselineMetrics;
  suite: HiddenSuiteDoc;
  graph: WorkGraph;
  curve: LatencyCurve;
  profile: MachineProfile;
  opening: string;
}
