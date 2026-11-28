import {
  AtomicBudgetReservationLedger,
  BudgetWindDownController,
  InMemoryCheckpointStore,
  InMemoryIntegration,
  LocalKernelStop,
  StopEventStore,
  WipBranchHandoffExporter,
  type ConnectionAccount,
  type QueuedTask,
} from "../../src/budget-stops/index.js";

export interface HarnessParts {
  readonly ledger: AtomicBudgetReservationLedger;
  readonly integration: InMemoryIntegration;
  readonly checkpoints: InMemoryCheckpointStore;
  readonly kernel: LocalKernelStop;
  readonly stopEvents: StopEventStore;
  readonly controller: BudgetWindDownController;
  now: number;
}

export function createHarness(input?: {
  readonly microUsdLimit?: number | null;
  readonly ppmLimit?: number | null;
  readonly connections?: readonly ConnectionAccount[];
  readonly activeConnectionId?: string;
  readonly finishedFeatures?: readonly string[];
  readonly finishedTasksCount?: number;
  readonly commits?: readonly { readonly sha: string; readonly featureId: string | null; readonly subject: string }[];
}): HarnessParts {
  const microUsdLimit = input && "microUsdLimit" in input ? input.microUsdLimit ?? null : 10_000_000;
  const ppmLimit = input && "ppmLimit" in input ? input.ppmLimit ?? null : null;
  const ledger = new AtomicBudgetReservationLedger({ microUsdLimit, ppmLimit });
  const integration = new InMemoryIntegration(
    input?.commits ?? [{ sha: "base", featureId: null, subject: "base" }],
  );
  const checkpoints = new InMemoryCheckpointStore();
  const kernel = new LocalKernelStop();
  const stopEvents = new StopEventStore();
  const connections = input?.connections ?? [apiConnection()];
  const clock = { now: 1_700_000_000_000 };
  const controller = new BudgetWindDownController({
    ledger,
    integration,
    checkpoints,
    kernelStop: kernel,
    stopEvents,
    connections,
    activeConnectionId: input?.activeConnectionId ?? connections[0]?.id ?? "api",
    exporter: new WipBranchHandoffExporter(),
    now: () => clock.now,
    ...(input?.finishedFeatures ? { finishedFeatures: input.finishedFeatures } : {}),
    ...(input?.finishedTasksCount !== undefined ? { finishedTasksCount: input.finishedTasksCount } : {}),
  });
  return {
    ledger,
    integration,
    checkpoints,
    kernel,
    stopEvents,
    controller,
    get now() {
      return clock.now;
    },
    set now(value: number) {
      clock.now = value;
    },
  };
}

export function apiConnection(): ConnectionAccount {
  return {
    id: "api",
    label: "Anthropic Console API",
    billing: "pay-per-use",
    healthy: true,
    estimateMicroUsd: 650_000,
    remainingTasks: 4,
    window: null,
    microUsdRemaining: 5_000_000,
  };
}

export function plusConnection(resetAtMs: number): ConnectionAccount {
  return {
    id: "plus",
    label: "ChatGPT Plus",
    billing: "subscription",
    healthy: true,
    estimateMicroUsd: null,
    remainingTasks: null,
    window: { kind: "5h", resetAtMs },
    microUsdRemaining: null,
  };
}

export function queuedTask(taskId: string, overrides?: Partial<QueuedTask>): QueuedTask {
  return {
    taskId,
    title: taskId,
    featureId: "F-Queue",
    role: "implementer@1",
    mandatoryVerification: false,
    currency: "micro-usd",
    ceilingUnits: 500_000,
    acceptanceCriteria: [`${taskId} passes its checks`],
    safetyClass: null,
    ...overrides,
  };
}
