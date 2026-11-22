import type {
  HealthBoardSnapshot,
  HintLadderReading,
  LoopDetectorReading,
  ProgressMarks,
  WorkerHealthTelemetry,
  WorkerStep,
} from "../../src/cockpit/health/index.js";

const quietProgress: ProgressMarks = {
  fileEdits: 0,
  completedToolCalls: 0,
  tokenChunks: 0,
  lastFileEditAtMs: null,
  lastCompletedToolCallAtMs: null,
  lastTokenChunkAtMs: null,
};

const quietLoop: LoopDetectorReading = {
  identicalFailingToolInvocations: 0,
  editUndoOscillations: 0,
  repeatingTestErrorFingerprints: 0,
  errorSnippet: null,
};

const quietHint: HintLadderReading = {
  hintLevel: 0,
  attemptLimit: 3,
  escalatedTo: null,
  disputeTest: false,
  retriesExhausted: false,
  failedAttempts: 0,
};

export interface WorkerDraft {
  readonly taskId?: string;
  readonly attemptId?: string;
  readonly connectionId?: string;
  readonly active?: boolean;
  readonly inspected?: boolean;
  readonly startedAtMs?: number;
  readonly poolState?: WorkerHealthTelemetry["poolState"];
  readonly poolWaitSinceMs?: number | null;
  readonly progress?: Partial<ProgressMarks>;
  readonly steps?: readonly WorkerStep[];
  readonly loop?: Partial<LoopDetectorReading>;
  readonly hint?: Partial<HintLadderReading>;
  readonly backoff?: WorkerHealthTelemetry["backoff"];
  readonly allowance?: WorkerHealthTelemetry["allowance"];
  readonly hold?: WorkerHealthTelemetry["hold"];
  readonly inbox?: WorkerHealthTelemetry["inbox"];
  readonly timeline?: WorkerHealthTelemetry["timeline"];
  readonly failingSnippet?: string | null;
  readonly requirementSnippet?: string | null;
  readonly pacingState?: WorkerHealthTelemetry["pacingState"];
}

export function worker(draft: WorkerDraft = {}): WorkerHealthTelemetry {
  return {
    taskId: draft.taskId ?? "T-1",
    attemptId: draft.attemptId ?? "attempt-1",
    connectionId: draft.connectionId ?? "conn-1",
    active: draft.active ?? true,
    inspected: draft.inspected ?? false,
    startedAtMs: draft.startedAtMs ?? 0,
    poolState: draft.poolState ?? "running",
    poolWaitSinceMs: draft.poolWaitSinceMs ?? null,
    progress: { ...quietProgress, ...draft.progress },
    steps: draft.steps ?? [],
    loop: { ...quietLoop, ...draft.loop },
    hint: { ...quietHint, ...draft.hint },
    backoff: draft.backoff ?? null,
    allowance: draft.allowance ?? null,
    hold: draft.hold ?? null,
    inbox: draft.inbox ?? null,
    timeline: draft.timeline ?? [],
    failingSnippet: draft.failingSnippet ?? null,
    requirementSnippet: draft.requirementSnippet ?? null,
    pacingState: draft.pacingState ?? "normal",
  };
}

export function board(nowMs: number, workers: readonly WorkerHealthTelemetry[]): HealthBoardSnapshot {
  return { nowMs, workers };
}

export function failingTests(count: number, fingerprint: string): WorkerStep[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    kind: "test" as const,
    fingerprint,
    failed: true,
    toolName: "vitest",
    errorSnippet: fingerprint,
  }));
}
