import path from "node:path";
import { GlobalBrokerDb } from "@ef-harness/db";
import { BrokerPortLeaseRepo } from "./broker-port-lease.js";
import { GitIntegrationWorktreePool } from "./git-integration-pool.js";
import { LastGoodPreviewFallbackStore } from "./last-good-preview-fallback-store.js";
import { LivePreviewDaemonRunner } from "./live-preview-daemon-runner.js";
import { PersistentDemoDbManager } from "./persistent-demo-db-manager.js";
import { PreviewJobSupervisor } from "./preview-job-supervisor.js";
import { PreviewLiveKeyGuard, PreviewRuntimeEnv } from "./real-env.js";
import { RealPreviewTemplates } from "./real-templates.js";
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
  const brokerRoot = path.join(options.dataDir, "broker");
  const broker = options.ports ? null : GlobalBrokerDb.open({ root: brokerRoot });
  const ports = options.ports ?? new BrokerPortLeaseRepo(brokerOrThrow(broker), options.dataDir);
  const jobs = options.jobs ?? new PreviewJobSupervisor(path.join(options.dataDir, "preview-jobs.sqlite"));
  const guard = new PreviewLiveKeyGuard();
  const templates = new RealPreviewTemplates(options.dataDir, options.projectId);
  const worktrees = new GitIntegrationWorktreePool({
    wtRoot: options.wtRoot,
    projectId: options.projectId,
    developerCheckoutPath: options.developerCheckoutPath,
    workerSlotPath: options.workerSlotPath,
    commits: options.commits,
    headSha: options.headSha,
  });
  const demo = new PersistentDemoDbManager({
    projectId: options.projectId,
    dataDir: options.dataDir,
    engine,
    templates,
    testEnv: templates,
  });
  return new LivePreviewDaemonRunner({
    projectId: options.projectId,
    headSha: options.headSha,
    target: options.target,
    secrets: options.secrets ?? [],
    ports,
    worktrees,
    jobs,
    env: new PreviewRuntimeEnv(guard),
    guard,
    demo,
    fallback: new LastGoodPreviewFallbackStore(
      path.join(options.dataDir, "preview-state"),
      resolvePreviewTimings(options.timings).healthyBootWindowMs,
    ),
    scheduler: options.scheduler ?? systemPreviewScheduler,
    timings: resolvePreviewTimings(options.timings),
    engine,
    shutdown: async () => {
      await worktrees.shutdown();
      if (ports instanceof BrokerPortLeaseRepo) ports.close();
    },
  });
}

function brokerOrThrow(broker: GlobalBrokerDb | null): GlobalBrokerDb {
  if (!broker) throw new Error("preview broker was not opened");
  return broker;
}
