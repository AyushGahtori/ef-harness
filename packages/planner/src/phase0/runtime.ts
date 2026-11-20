import fs from "node:fs/promises";
import path from "node:path";

import { LocalBaselineTestHealthRunner } from "./baseline.js";
import { MemoryContentStore } from "./cas.js";
import { LocalPhase0RecipeGenerator } from "./catalog.js";
import { NodeCommandRunner, OverridingCommandRunner } from "./command-runner.js";
import { Phase0ExecutionController, type Phase0ControllerDeps } from "./controller.js";
import { LocalGitleaksScanner } from "./gitleaks.js";
import { GitIntegrationRepo } from "./git-repo.js";
import { LocalDeterministicGraphCompiler } from "./graph-port.js";
import { LocalKernelPackageInstaller } from "./installer.js";
import type { BaselineTestHealthPort, CommandRunner, Phase0TaskWorker } from "./ports.js";
import { Phase0StateStore } from "./state-store.js";
import { LocalTemplateDbSeeder } from "./template-db.js";
import { LocalJobObjectAudit, LocalTestEnvOrchestrator } from "./test-env.js";
import { FoundationGate0Verifier } from "./verifier.js";
import { DefaultPhase0Worker } from "./worker.js";

export interface Phase0StackOptions {
  readonly root: string;
  readonly statePath: string;
  readonly slotsRoot: string;
  readonly initRepo?: boolean;
  readonly worker?: Phase0TaskWorker;
  readonly commandExits?: ReadonlyMap<string, number>;
  readonly baseline?: BaselineTestHealthPort | null;
  readonly knownBaselineFailures?: readonly string[];
  readonly leakTeardowns?: number;
  readonly now?: () => number;
}

export interface Phase0Stack {
  readonly controller: Phase0ExecutionController;
  readonly repo: GitIntegrationRepo;
  readonly store: Phase0StateStore;
  readonly installer: LocalKernelPackageInstaller;
  readonly cas: MemoryContentStore;
  readonly testEnv: LocalTestEnvOrchestrator;
  readonly worker: Phase0TaskWorker;
  dispose(): Promise<void>;
}

/** Wires the local sibling ports. Replace each one when its owning task is merged. */
export async function createPhase0Stack(options: Phase0StackOptions): Promise<Phase0Stack> {
  const repo = options.initRepo === false ? GitIntegrationRepo.open(options.root) : await GitIntegrationRepo.init(options.root);
  const store = Phase0StateStore.open(options.statePath);
  const installer = new LocalKernelPackageInstaller();
  const cas = new MemoryContentStore();
  const testEnv = new LocalTestEnvOrchestrator(options.leakTeardowns ?? 0);
  const worker = options.worker ?? new DefaultPhase0Worker();
  const inner: CommandRunner = new NodeCommandRunner();
  const commands = options.commandExits ? new OverridingCommandRunner(inner, options.commandExits) : inner;
  const baseline =
    options.baseline === undefined
      ? new LocalBaselineTestHealthRunner(options.knownBaselineFailures ?? [])
      : options.baseline;
  const verifier = new FoundationGate0Verifier({
    repo,
    commands,
    testEnv,
    templateDb: new LocalTemplateDbSeeder(),
    gitleaks: new LocalGitleaksScanner(),
    jobs: new LocalJobObjectAudit(),
    cas,
  });
  const portLog: string[] = [];
  const human = {
    escalate(input: { readonly tool: string }): void {
      portLog.push(`human:${input.tool}`);
    },
  };
  const downloader = {
    request(input: { readonly component: string }): void {
      portLog.push(`download:${input.component}`);
    },
  };
  const deps: Phase0ControllerDeps = {
    repo,
    store,
    generator: new LocalPhase0RecipeGenerator(),
    compiler: new LocalDeterministicGraphCompiler(),
    installer,
    worker,
    verifier,
    baseline,
    human,
    downloader,
    slotsRoot: options.slotsRoot,
    ...(options.now ? { now: options.now } : {}),
  };
  const controller = new Phase0ExecutionController(deps);
  let closed = false;
  return {
    controller,
    repo,
    store,
    installer,
    cas,
    testEnv,
    worker,
    async dispose(): Promise<void> {
      if (closed) return;
      closed = true;
      await testEnv.dispose();
      await repo.removeRegisteredWorktrees();
      store.close();
      await fs.rm(options.slotsRoot, { recursive: true, force: true });
    },
  };
}

export function stackPaths(root: string): { root: string; statePath: string; slotsRoot: string; metaRoot: string } {
  const metaRoot = `${root}-meta`;
  return {
    root,
    metaRoot,
    statePath: path.join(metaRoot, "state.db"),
    slotsRoot: `${root}-slots`,
  };
}
