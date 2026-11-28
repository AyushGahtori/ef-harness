import path from "node:path";
import { LastGoodPreviewFallbackStore } from "./last-good-preview-fallback-store.js";
import { LivePreviewDaemonRunner } from "./live-preview-daemon-runner.js";
import { LocalRuntimeOnlyEnvInjector, LocalLiveKeyTestRefusalGuard } from "./local-env-injector.js";
import { LocalWindowsJobSupervisor } from "./local-job-supervisor.js";
import { LocalPortLeaseRepo } from "./local-port-lease.js";
import { LocalTemplateDbSeeder, LocalTestEnvOrchestrator } from "./local-template-seeder.js";
import { LocalWorktreeSlotPool } from "./local-worktree-pool.js";
import { PersistentDemoDbManager } from "./persistent-demo-db-manager.js";
import type { PortLeaseRepo, PreviewScheduler, PreviewSecret, PreviewTarget, WindowsJobSupervisor } from "./ports.js";
import { systemPreviewScheduler } from "./scheduler.js";
import { resolvePreviewTimings, type PreviewTimings } from "./timings.js";

export interface CreateLivePreviewOptions {
  readonly projectId: string;
  readonly dataDir: string;
  readonly wtRoot: string;
  readonly developerCheckoutPath: string;
  readonly workerSlotPath: string;
  readonly commits: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly headSha: string;
  readonly target: PreviewTarget;
  readonly secrets?: readonly PreviewSecret[];
  readonly engine?: "sqlite" | "postgres";
  readonly scheduler?: PreviewScheduler;
  readonly timings?: Partial<PreviewTimings>;
  readonly ports?: PortLeaseRepo;
  readonly jobs?: WindowsJobSupervisor;
}

export function createLivePreviewDaemonRunner(options: CreateLivePreviewOptions): LivePreviewDaemonRunner {
  const engine = options.engine ?? "sqlite";
  const guard = new LocalLiveKeyTestRefusalGuard();
  const testEnv = new LocalTestEnvOrchestrator(options.dataDir);
  const templates = new LocalTemplateDbSeeder(options.dataDir);
  const demo = new PersistentDemoDbManager({
    projectId: options.projectId,
    dataDir: options.dataDir,
    engine,
    templates,
    testEnv,
  });
  return new LivePreviewDaemonRunner({
    projectId: options.projectId,
    headSha: options.headSha,
    target: options.target,
    secrets: options.secrets ?? [],
    ports: options.ports ?? new LocalPortLeaseRepo(),
    worktrees: new LocalWorktreeSlotPool({
      wtRoot: options.wtRoot,
      projectId: options.projectId,
      developerCheckoutPath: options.developerCheckoutPath,
      workerSlotPath: options.workerSlotPath,
      commits: options.commits,
      headSha: options.headSha,
    }),
    jobs: options.jobs ?? new LocalWindowsJobSupervisor(),
    env: new LocalRuntimeOnlyEnvInjector(guard),
    guard,
    demo,
    fallback: new LastGoodPreviewFallbackStore(
      path.join(options.dataDir, "preview-state"),
      resolvePreviewTimings(options.timings).healthyBootWindowMs,
    ),
    scheduler: options.scheduler ?? systemPreviewScheduler,
    timings: resolvePreviewTimings(options.timings),
    engine,
  });
}
