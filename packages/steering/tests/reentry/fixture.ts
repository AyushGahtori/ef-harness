import type {
  CliVersionRecord,
  ColdOpenInput,
  ConnectionObservation,
  DiskObservation,
  HumanStepRecord,
  LockfileObservation,
  ObservedCommit,
  OpenQuestionRecord,
  ProcessProbePort,
  ProviderConnectionSnapshot,
  RepoInspection,
  ReconcilePorts,
  StateDbSnapshot,
  ViewHashRecord,
  WorktreeAuditEntry,
} from "../../src/reentry/index.js";
import { createJournal, createSpendLedger } from "../../src/reentry/index.js";

export function snapshot(patch: Partial<StateDbSnapshot> = {}): StateDbSnapshot {
  const base: StateDbSnapshot = {
    projectId: "project-kitchen",
    snapshotId: "snap-1",
    projectName: "kitchen-app",
    projectRoot: "D:/code/kitchen",
    lastActiveAt: "2026-11-20T18:40:00.000Z",
    phaseLabel: "Wave 2 · ordering",
    whyStopped: "budget",
    expectedIntegrationHead: "integration-head",
    recordedBranch: "main",
    recordedHead: "recorded-head",
    recordedOriginMain: "origin-main",
    walOk: true,
    walDetail: "ok",
    attempts: [],
    remainingTasks: [],
    parkedTasks: [],
    finishedFeatures: [],
    costEstimate: "$0.00",
    windowLabel: "weekly",
    lockHashes: { packageJson: "pkg-hash", pnpmLock: "lock-hash" },
    viewHashes: [],
    worktrees: [],
    connections: [],
    cliVersions: [],
    humanSteps: [],
    questions: [],
    failedTasks: [],
  };
  const next: StateDbSnapshot = { ...base };
  for (const key of Object.keys(patch) as (keyof StateDbSnapshot)[]) {
    const value = patch[key];
    if (value !== undefined) {
      Object.assign(next, { [key]: value });
    }
  }
  return next;
}

export function coldInput(state: StateDbSnapshot, patch: Partial<ColdOpenInput> = {}): ColdOpenInput {
  const base: ColdOpenInput = {
    snapshot: state,
    nowIso: "2026-11-22T18:40:00.000Z",
    reopen: "app_restart",
    buildWasInProgress: false,
    sleepMinutes: null,
    offline: false,
    repoChanged: false,
    networkChanged: false,
    forceHold: false,
    lastActiveLabel: "Friday 18:40 (2 days ago)",
    ledger: createSpendLedger(),
    gate: null,
  };
  const next: ColdOpenInput = { ...base, snapshot: state };
  for (const key of Object.keys(patch) as (keyof ColdOpenInput)[]) {
    const value = patch[key];
    if (value !== undefined) Object.assign(next, { [key]: value });
  }
  return next;
}

export interface PortFixture {
  readonly repo?: RepoInspection | { missing: true; code: "ENOENT"; message: string };
  readonly worktrees?: readonly WorktreeAuditEntry[];
  readonly views?: readonly ViewHashRecord[];
  readonly locks?: LockfileObservation;
  readonly disk?: DiskObservation;
  readonly clis?: readonly CliVersionRecord[];
  readonly gitPids?: readonly number[];
  readonly livePids?: ReadonlySet<number>;
  readonly reliable?: boolean;
  readonly shell?: "clean_quit" | "crash" | "parked" | "sleep" | "first_open";
  readonly observe?: (snapshot: ProviderConnectionSnapshot, nowIso: string) => ConnectionObservation;
  readonly probe?: (step: HumanStepRecord) => { readonly status: "pending" | "failed" | "verified"; readonly evidence: string };
  readonly questions?: readonly OpenQuestionRecord[];
}

export function presentRepo(patch: Partial<RepoInspection> = {}): RepoInspection {
  return {
    missing: false,
    branch: "main",
    head: "recorded-head",
    integrationHead: "integration-head",
    originMainHead: "origin-main",
    dirtyFiles: [],
    commits: [],
    indexLockPath: null,
    indexLockMtimeMs: null,
    readError: null,
    ...patch,
  };
}

export function commit(patch: Partial<ObservedCommit> & Pick<ObservedCommit, "sha" | "subject" | "files">): ObservedCommit {
  return { kind: "local", ...patch };
}

export function fakePorts(fixture: PortFixture = {}): ReconcilePorts {
  const journal = createJournal();
  const processes: ProcessProbePort = {
    reliable: fixture.reliable ?? true,
    isAlive(pid: number) {
      return fixture.livePids?.has(pid) ?? false;
    },
    liveGitPids: () => fixture.gitPids ?? [],
  };
  return {
    journal,
    git: {
      inspect: () =>
        fixture.repo ?? {
          ...presentRepo(),
        },
    },
    worktrees: { audit: () => fixture.worktrees ?? [] },
    views: { scan: () => fixture.views ?? [] },
    questions: {
      listOpen: (_projectId, state) => fixture.questions ?? state.questions,
    },
    humanSteps: {
      reprobe: (step) => fixture.probe?.(step) ?? { status: step.status, evidence: "unchanged" },
    },
    shell: { closeReason: () => fixture.shell ?? "clean_quit" },
    processes,
    disk: {
      inspect: () => fixture.disk ?? { ok: true, freeBytes: 20 * 1024 * 1024 * 1024, detail: "disk headroom ok" },
    },
    connections: {
      observe: (item, nowIso) =>
        fixture.observe?.(item, nowIso) ?? {
          provider: item.provider,
          usedPercent: item.previousUsedPercent,
          allowanceReset: false,
          fiveHourReset: false,
          weeklyReset: false,
          tokenExpired: false,
          expiresInDays: null,
        },
    },
    clis: { current: () => fixture.clis ?? [] },
    lockfiles: {
      hash: () => fixture.locks ?? { packageJson: "pkg-hash", pnpmLock: "lock-hash" },
    },
  };
}
