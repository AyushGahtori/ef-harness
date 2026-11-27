import fs from "node:fs/promises";
import path from "node:path";

import { Phase0Error, isPhase0Error } from "./errors.js";
import { GitIntegrationRepo, writeTree } from "./git-repo.js";
import { mergePackageDependencies } from "./lockfile.js";
import type {
  BaselineTestHealthPort,
  ComponentDownloaderPort,
  DeterministicGraphCompilerPort,
  HumanStepProbePort,
  KernelPackageInstallerPort,
  Phase0RecipeGeneratorPort,
  Phase0TaskWorker,
} from "./ports.js";
import { prepareExecution, uniqueIntents } from "./supply-chain.js";
import { buildGate0Receipt, wave1MayStart } from "./schema.js";
import type { Phase0StateStore, StoredTask } from "./state-store.js";
import type {
  ActionCard,
  DependencyIntent,
  Escalation,
  FoundationManifest,
  Gate0Receipt,
  MergeRecord,
  Phase0Plan,
  Phase0Recipe,
  Phase0RunRequest,
  Phase0RunResult,
  Phase0RunStatus,
  ScheduleEvent,
} from "./types.js";
import { FoundationGate0Verifier, type Gate0Evaluation } from "./verifier.js";

export interface Phase0ControllerDeps {
  readonly repo: GitIntegrationRepo;
  readonly store: Phase0StateStore;
  readonly generator: Phase0RecipeGeneratorPort;
  readonly compiler: DeterministicGraphCompilerPort;
  readonly installer: KernelPackageInstallerPort;
  readonly worker: Phase0TaskWorker;
  readonly verifier: FoundationGate0Verifier;
  readonly baseline: BaselineTestHealthPort | null;
  readonly human: HumanStepProbePort;
  readonly downloader: ComponentDownloaderPort;
  readonly slotsRoot: string;
  readonly now?: () => number;
}

interface ProducedTask {
  readonly task: Phase0Recipe;
  readonly branch: string;
  readonly slot: string;
  readonly sha: string;
  readonly intents: readonly DependencyIntent[];
}

interface Trace {
  readonly schedule: readonly ScheduleEvent[];
  readonly merges: readonly MergeRecord[];
  readonly maxConcurrency: { readonly stage0A: number; readonly stage0B: number };
}

/**
 * Stage 0A commits only `P0.1`. Stage 0B starts after that commit and runs
 * `P0.2`–`P0.8` in disjoint worktrees, merging them one at a time.
 * Wave 1 stays locked until Gate 0 records PASS for the integration HEAD.
 */
export class Phase0ExecutionController {
  private readonly schedule: ScheduleEvent[] = [];
  private readonly merges: MergeRecord[] = [];
  private readonly stage0A = new ConcurrencyProbe();
  private readonly stage0B = new ConcurrencyProbe();
  private cardSequence = 0;

  constructor(private readonly deps: Phase0ControllerDeps) {}

  inspection(): Trace {
    return {
      schedule: [...this.schedule],
      merges: [...this.merges],
      maxConcurrency: { stage0A: this.stage0A.max, stage0B: this.stage0B.max },
    };
  }

  async isWave1Unlocked(projectId: string): Promise<boolean> {
    const head = await this.deps.repo.head();
    return wave1MayStart(this.deps.store.latestReceipt(projectId, head), head);
  }

  async run(request: Phase0RunRequest): Promise<Phase0RunResult> {
    this.schedule.length = 0;
    this.merges.length = 0;
    this.stage0A.reset();
    this.stage0B.reset();
    await this.assertIntegration();
    const source = request.plan ?? this.deps.generator.generate(selectionFrom(request));
    const compiled = this.deps.compiler.compile(source);
    if (!compiled.ok) throw new Phase0Error("compile_failed", compiled.errors.join("\n"));
    const plan = attachHoisted(source, compiled.recipes, compiled.hoistedIntents);
    this.deps.store.saveRun({
      projectId: request.projectId,
      plan,
      projectKind: plan.projectKind,
      registryOffline: request.registryOffline === true,
      playwrightBrowserAvailable: request.playwrightBrowserAvailable !== false,
      status: "running",
    });
    for (const recipe of plan.recipes) this.deps.store.queueIfAbsent(request.projectId, recipe.id, this.stamp());
    if (await this.alreadyCertified(request.projectId, plan)) {
      return this.finish(request.projectId, "gate0_pass", this.deps.store.latestReceipt(request.projectId), this.deps.store.manifest(request.projectId), 0, []);
    }
    if (plan.projectKind === "brownfield") {
      const blocked = await this.executeParallel(request, plan.recipes, "brownfield");
      if (blocked) return this.finish(request.projectId, "blocked_install", null, null, 0, []);
    } else {
      const serial = plan.recipes.find((recipe) => recipe.id === "P0.1");
      if (!serial) throw new Phase0Error("phase0_order", "P0.1 must exist before Stage 0B");
      const blocked = await this.executeP01(request, serial);
      if (blocked) return this.finish(request.projectId, "blocked_install", null, null, 0, []);
      const parallel = plan.recipes.filter((recipe) => recipe.id !== "P0.1");
      const parallelBlocked = await this.executeParallel(request, parallel, "0B");
      if (parallelBlocked) return this.finish(request.projectId, "blocked_install", null, null, 0, []);
    }
    if (!this.allDone(request.projectId, plan.recipes)) {
      return this.finish(request.projectId, "incomplete", null, null, 0, []);
    }
    return this.certify(request, plan);
  }

  /** Cold open: discard in-progress worktrees and continue from integration HEAD. */
  async resume(projectId: string): Promise<Phase0RunResult> {
    const saved = this.deps.store.readRun(projectId);
    if (!saved) throw new Phase0Error("no_run", `No Phase 0 run is stored for ${projectId}`);
    const stageFor = (taskId: string): ScheduleEvent["stage"] => {
      if (saved.projectKind === "brownfield") return "brownfield";
      return taskId === "P0.1" ? "0A" : "0B";
    };
    const resets: ScheduleEvent[] = [];
    for (const task of this.deps.store.listTasks(projectId)) {
      if (task.status !== "running" && task.status !== "failed") continue;
      if (task.worktreePath) await this.deps.repo.removeWorktree(task.worktreePath, task.branch);
      resets.push({ taskId: task.taskId, kind: "reset", stage: stageFor(task.taskId), at: this.stamp() });
      this.save(projectId, {
        taskId: task.taskId,
        status: "queued",
        integrationSha: task.integrationSha,
        unmergedSha: task.unmergedSha,
        attempt: task.attempt + 1,
        worktreePath: null,
        branch: null,
      });
    }
    const result = await this.run({
      projectId,
      projectKind: saved.projectKind,
      plan: saved.plan,
      registryOffline: saved.registryOffline,
      playwrightBrowserAvailable: saved.playwrightBrowserAvailable,
    });
    return { ...result, schedule: [...resets, ...result.schedule] };
  }

  private async executeP01(request: Phase0RunRequest, task: Phase0Recipe): Promise<boolean> {
    const current = this.deps.store.getTask(request.projectId, task.id);
    if (current?.status === "done") {
      this.note(task.id, "skipped", "0A");
      return false;
    }
    this.stage0A.enter();
    this.note(task.id, "start", "0A");
    const attempt = current?.attempt ?? 1;
    const slot = this.slot(request.projectId, task.id, attempt);
    const branch = branchName(task.id, attempt);
    this.save(request.projectId, blank(task.id, "running", attempt, slot, branch));
    try {
      await this.deps.repo.addWorktree(branch, slot);
      const execution = await this.deps.worker.execute({
        task,
        projectKind: request.projectKind,
        repoPath: slot,
        mode: "initial",
        attempt,
      });
      const prepared = prepareExecution(task, execution);
      await writeTree(slot, prepared.files);
      const installed = this.deps.installer.install({
        taskId: task.id,
        dependencies: uniqueIntents([...(task.dependencyIntents ?? []), ...prepared.dependencyIntents]),
        frozenLockfile: true,
        offline: request.registryOffline === true,
      });
      if (!installed.ok) {
        this.card(request.projectId, task.id, installed.error ?? "kernel installer failed");
        this.save(request.projectId, blank(task.id, "blocked", attempt, slot, branch));
        this.note(task.id, "failed", "0A");
        return true;
      }
      const packagePath = path.join(slot, "package.json");
      const currentPackage = await fs.readFile(packagePath, "utf8");
      await fs.writeFile(packagePath, mergePackageDependencies(currentPackage, installed.packageDependencies), "utf8");
      await fs.writeFile(path.join(slot, "pnpm-lock.yaml"), installed.lockfileBody, "utf8");
      this.deps.store.saveInstallHash(request.projectId, installed.lockfileHash);
      const unmergedSha = await this.deps.repo.commitAll(slot, `phase0: ${task.id} ${task.title}`);
      const merged = await this.deps.repo.mergeBranch(branch, task.id);
      this.merges.push({ taskId: task.id, sha: merged.sha, method: merged.method });
      this.save(request.projectId, {
        taskId: task.id,
        status: "done",
        integrationSha: merged.sha,
        unmergedSha,
        attempt,
        worktreePath: null,
        branch: null,
      });
      await this.deps.repo.removeWorktree(slot, branch);
      this.note(task.id, "merged", "0A");
      if (request.onTaskMerged) await request.onTaskMerged({ taskId: task.id, sha: merged.sha, method: merged.method });
      return false;
    } catch (error) {
      if (isPhase0Error(error) && error.code === "raw_install_forbidden") {
        this.save(request.projectId, blank(task.id, "failed", attempt, slot, branch));
        this.note(task.id, "failed", "0A");
        return false;
      }
      throw error;
    } finally {
      this.stage0A.leave();
    }
  }

  private async executeParallel(
    request: Phase0RunRequest,
    tasks: readonly Phase0Recipe[],
    stage: "0B" | "brownfield",
  ): Promise<boolean> {
    if (stage === "0B") {
      const serial = this.deps.store.getTask(request.projectId, "P0.1");
      if (!serial || serial.status !== "done") {
        throw new Phase0Error("serial_p01", "Stage 0B cannot start until P0.1 is committed to harness/integration");
      }
    }
    const pending: Phase0Recipe[] = [];
    for (const task of tasks) {
      const stored = this.deps.store.getTask(request.projectId, task.id);
      if (stored?.status === "done") this.note(task.id, "skipped", stage);
      else pending.push(task);
    }
    if (pending.length === 0) return false;
    const barrier = new StartBarrier(pending.length);
    const produced: ProducedTask[] = [];
    await Promise.all(
      pending.map(async (task) => {
        this.stage0B.enter();
        this.note(task.id, "start", stage);
        const attempt = this.deps.store.getTask(request.projectId, task.id)?.attempt ?? 1;
        const slot = this.slot(request.projectId, task.id, attempt);
        const branch = branchName(task.id, attempt);
        this.save(request.projectId, blank(task.id, "running", attempt, slot, branch));
        try {
          await barrier.wait();
          await this.deps.repo.addWorktree(branch, slot);
          const execution = await this.deps.worker.execute({
            task,
            projectKind: request.projectKind,
            repoPath: slot,
            mode: "initial",
            attempt,
          });
          const prepared = prepareExecution(task, execution);
          await writeTree(slot, prepared.files);
          const sha = await this.deps.repo.commitAll(slot, `phase0: ${task.id} ${task.title}`);
          produced.push({ task, branch, slot, sha, intents: prepared.dependencyIntents });
        } catch (error) {
          this.save(request.projectId, blank(task.id, "failed", attempt, slot, branch));
          this.note(task.id, "failed", stage);
          if (!isWorkerFault(error)) throw error;
        } finally {
          this.stage0B.leave();
        }
      }),
    );
    produced.sort((left, right) => left.task.id.localeCompare(right.task.id));
    for (let index = 0; index < produced.length; index += 1) {
      const item = produced[index];
      if (!item) continue;
      try {
        const merged = await this.deps.repo.mergeBranch(item.branch, item.task.id);
        this.merges.push({ taskId: item.task.id, sha: merged.sha, method: merged.method });
        this.save(request.projectId, {
          taskId: item.task.id,
          status: "done",
          integrationSha: merged.sha,
          unmergedSha: item.sha,
          attempt: this.deps.store.getTask(request.projectId, item.task.id)?.attempt ?? 1,
          worktreePath: null,
          branch: null,
        });
        await this.deps.repo.removeWorktree(item.slot, item.branch);
        this.note(item.task.id, "merged", stage);
        if (request.onTaskMerged) await request.onTaskMerged({ taskId: item.task.id, sha: merged.sha, method: merged.method });
      } catch (error) {
        this.keepRunning(request.projectId, produced.slice(index));
        throw error;
      }
    }
    const additive = uniqueIntents(produced.flatMap((item) => [...item.intents]));
    if (additive.length === 0) return false;
    return this.installOnIntegration(request, additive);
  }

  private async certify(request: Phase0RunRequest, plan: Phase0Plan): Promise<Phase0RunResult> {
    let repairs = 0;
    let failures = 0;
    const escalations: Escalation[] = [];
    let evaluation = await this.evaluate(request, plan);
    while (evaluation.status === "FAIL") {
      failures += 1;
      if (evaluation.failureKind === "missing_environment_tool" && failures >= 2) {
        escalations.push(this.escalate(evaluation.detail, true));
        escalations.push(this.escalate(evaluation.detail, false));
        break;
      }
      if (evaluation.failureKind === "missing_environment_tool") {
        escalations.push(this.escalate(evaluation.detail, false));
        repairs += 1;
        evaluation = await this.evaluate(request, plan);
        continue;
      }
      if (repairs >= 2) break;
      repairs += 1;
      await this.repair(request, plan, evaluation);
      evaluation = await this.evaluate(request, plan);
    }
    const escalated = escalations.some((item) => item.kind === "human_step_probe");
    const head = await this.deps.repo.head();
    const receipt = buildGate0Receipt({
      projectId: request.projectId,
      status: evaluation.status === "PASS" && !escalated ? "PASS" : "FAIL",
      integrationSha: head,
      repairAttempts: repairs,
      commands: evaluation.commands,
      checks: evaluation.checks,
      failingTaskId: evaluation.failingTaskId,
      failureKind: evaluation.failureKind,
      styleguideThumbnail: evaluation.styleguideThumbnail,
      escalated,
      quarantine: evaluation.quarantine,
      recordedAt: this.stamp(),
    });
    this.deps.store.saveReceipt(receipt);
    this.deps.store.replaceQuarantine(request.projectId, evaluation.quarantine);
    let manifest: FoundationManifest | null = null;
    if (receipt.status === "PASS") {
      manifest = {
        gate0CommitSha: head,
        installedDependenciesHash: evaluation.installedDependenciesHash,
        templateDbHash: evaluation.templateDbHash,
        exposedExportsMap: evaluation.exposedExportsMap,
        styleguideScreenshotCasIds: evaluation.screenshotCasIds,
      };
      this.deps.store.saveManifest(request.projectId, manifest, this.stamp());
    }
    const status: Phase0RunStatus = receipt.status === "PASS" ? "gate0_pass" : escalated ? "escalated" : "gate0_fail";
    this.deps.store.saveRun({
      projectId: request.projectId,
      plan,
      projectKind: plan.projectKind,
      registryOffline: request.registryOffline === true,
      playwrightBrowserAvailable: request.playwrightBrowserAvailable !== false,
      status,
    });
    return this.finish(request.projectId, status, receipt, manifest, repairs, escalations);
  }

  private escalate(reason: string, human: boolean): Escalation {
    if (human) {
      this.deps.human.escalate({ tool: "playwright", reason });
      return { kind: "human_step_probe", tool: "playwright", reason };
    }
    this.deps.downloader.request({ component: "playwright-browser", reason });
    return { kind: "component_downloader", tool: "playwright-browser", reason };
  }

  private async repair(request: Phase0RunRequest, plan: Phase0Plan, evaluation: Gate0Evaluation): Promise<void> {
    for (const pid of evaluation.leakedPids) killPid(pid);
    if (evaluation.failureKind === "leaked_process") return;
    if (evaluation.failureKind === "dirty_tree") {
      await this.deps.repo.cleanWorktree();
      return;
    }
    if (evaluation.failureKind === "secret_leak") {
      await this.deps.repo.removeTracked(evaluation.secretPaths);
      await this.deps.repo.commitIfDirty("phase0: remove secrets flagged by gitleaks");
      return;
    }
    const task = plan.recipes.find((recipe) => recipe.id === evaluation.failingTaskId);
    if (!task) return;
    const attempt = (this.deps.store.getTask(request.projectId, task.id)?.attempt ?? 1) + 1;
    const slot = this.slot(request.projectId, task.id, attempt);
    const branch = branchName(task.id, attempt);
    try {
      await this.deps.repo.addWorktree(branch, slot);
      const execution = await this.deps.worker.execute({
        task,
        projectKind: request.projectKind,
        repoPath: slot,
        mode: "repair",
        attempt,
      });
      const prepared = prepareExecution(task, execution);
      await writeTree(slot, prepared.files);
      await this.deps.repo.commitAll(slot, `phase0: repair ${task.id}`);
      const merged = await this.deps.repo.mergeBranch(branch, task.id);
      this.merges.push({ taskId: task.id, sha: merged.sha, method: merged.method });
      this.save(request.projectId, {
        taskId: task.id,
        status: "done",
        integrationSha: merged.sha,
        unmergedSha: null,
        attempt,
        worktreePath: null,
        branch: null,
      });
    } catch (error) {
      if (isPhase0Error(error) && error.code === "empty_commit") return;
      throw error;
    } finally {
      await this.deps.repo.removeWorktree(slot, branch);
    }
  }

  private async evaluate(request: Phase0RunRequest, plan: Phase0Plan): Promise<Gate0Evaluation> {
    return this.deps.verifier.verify({
      activeTaskIds: plan.recipes.map((recipe) => recipe.id),
      capabilities: plan.capabilities,
      expectedLockfileHash: this.deps.store.installHash(request.projectId),
      playwrightBrowserAvailable: request.playwrightBrowserAvailable !== false,
      baseline: plan.projectKind === "brownfield" ? this.deps.baseline : null,
      brownfield: plan.projectKind === "brownfield",
    });
  }

  private async installOnIntegration(request: Phase0RunRequest, intents: readonly DependencyIntent[]): Promise<boolean> {
    const installed = this.deps.installer.install({
      taskId: "P0.1",
      dependencies: intents,
      frozenLockfile: true,
      offline: request.registryOffline === true,
    });
    if (!installed.ok) {
      this.card(request.projectId, "P0.1", installed.error ?? "kernel installer failed");
      return true;
    }
    const packagePath = path.join(this.deps.repo.root, "package.json");
    const currentPackage = await fs.readFile(packagePath, "utf8");
    await fs.writeFile(packagePath, mergePackageDependencies(currentPackage, installed.packageDependencies), "utf8");
    await fs.writeFile(path.join(this.deps.repo.root, "pnpm-lock.yaml"), installed.lockfileBody, "utf8");
    this.deps.store.saveInstallHash(request.projectId, installed.lockfileHash);
    try {
      await this.deps.repo.commitAll(this.deps.repo.root, "phase0: kernel installer lockfile");
    } catch (error) {
      if (isPhase0Error(error) && error.code === "empty_commit") return false;
      throw error;
    }
    return false;
  }

  private keepRunning(projectId: string, items: readonly ProducedTask[]): void {
    for (const item of items) {
      const current = this.deps.store.getTask(projectId, item.task.id);
      if (current?.status === "done") continue;
      this.save(projectId, {
        taskId: item.task.id,
        status: "running",
        integrationSha: current?.integrationSha ?? null,
        unmergedSha: item.sha,
        attempt: current?.attempt ?? 1,
        worktreePath: item.slot,
        branch: item.branch,
      });
    }
  }

  private async alreadyCertified(projectId: string, plan: Phase0Plan): Promise<boolean> {
    if (!this.allDone(projectId, plan.recipes)) return false;
    const head = await this.deps.repo.head();
    const receipt = this.deps.store.latestReceipt(projectId, head);
    if (!receipt || receipt.status !== "PASS") return false;
    for (const recipe of plan.recipes) {
      const stage = plan.projectKind === "brownfield" ? "brownfield" : recipe.id === "P0.1" ? "0A" : "0B";
      this.note(recipe.id, "skipped", stage);
    }
    return true;
  }

  private allDone(projectId: string, recipes: readonly Phase0Recipe[]): boolean {
    return recipes.every((recipe) => this.deps.store.getTask(projectId, recipe.id)?.status === "done");
  }

  private async assertIntegration(): Promise<void> {
    const branch = await this.deps.repo.branch();
    if (branch !== "harness/integration") {
      throw new Phase0Error("protected_branch", `Refusing to run Phase 0 on ${branch}`);
    }
  }

  private async finish(
    projectId: string,
    status: Phase0RunStatus,
    receipt: Gate0Receipt | null,
    manifest: FoundationManifest | null,
    repairAttempts: number,
    escalations: readonly Escalation[],
  ): Promise<Phase0RunResult> {
    const tasks = this.deps.store.listTasks(projectId);
    const head = await this.deps.repo.head();
    return {
      status,
      integrationSha: head,
      wave1Unlocked: wave1MayStart(receipt, head),
      completedTaskIds: tasks.filter((task) => task.status === "done").map((task) => task.taskId),
      queuedTaskIds: tasks.filter((task) => task.status === "queued").map((task) => task.taskId),
      failedTaskIds: tasks.filter((task) => task.status === "failed" || task.status === "blocked").map((task) => task.taskId),
      receipt,
      manifest,
      actionCards: this.deps.store.actionCards(projectId),
      escalations,
      schedule: [...this.schedule],
      maxConcurrency: { stage0A: this.stage0A.max, stage0B: this.stage0B.max },
      merges: [...this.merges],
      repairAttempts,
    };
  }

  private card(projectId: string, taskId: string, message: string): ActionCard {
    this.cardSequence += 1;
    const card: ActionCard = {
      id: `action-${projectId}-${this.cardSequence}`,
      kind: "kernel_installer_error",
      taskId,
      message,
      blocksStage0B: true,
    };
    this.deps.store.saveActionCard(projectId, card, this.stamp());
    return card;
  }

  private save(projectId: string, task: StoredTask): void {
    this.deps.store.mark(projectId, task, this.stamp());
  }

  private note(taskId: string, kind: ScheduleEvent["kind"], stage: ScheduleEvent["stage"]): void {
    this.schedule.push({ taskId, kind, stage, at: this.stamp() });
  }

  private slot(projectId: string, taskId: string, attempt: number): string {
    return path.resolve(this.deps.slotsRoot, projectId, taskId.replaceAll(".", "-"), String(attempt));
  }

  private stamp(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}

function selectionFrom(request: Phase0RunRequest): { projectKind: Phase0RunRequest["projectKind"]; database?: boolean; auth?: boolean } {
  if (request.database === undefined && request.auth === undefined) return { projectKind: request.projectKind };
  if (request.database === undefined) return { projectKind: request.projectKind, auth: request.auth === true };
  if (request.auth === undefined) return { projectKind: request.projectKind, database: request.database };
  return { projectKind: request.projectKind, database: request.database, auth: request.auth };
}

function attachHoisted(source: Phase0Plan, recipes: readonly Phase0Recipe[], hoisted: readonly DependencyIntent[]): Phase0Plan {
  const withIntents = recipes.map((recipe) => {
    if (recipe.id !== "P0.1" || hoisted.length === 0) return recipe;
    return { ...recipe, dependencyIntents: uniqueIntents([...(recipe.dependencyIntents ?? []), ...hoisted]) };
  });
  return { projectKind: source.projectKind, capabilities: source.capabilities, recipes: withIntents, omitted: source.omitted };
}

function branchName(taskId: string, attempt: number): string {
  return `harness/t/${taskId}/${attempt}`;
}

function blank(taskId: string, status: StoredTask["status"], attempt: number, worktreePath: string | null, branch: string | null): StoredTask {
  return { taskId, status, integrationSha: null, unmergedSha: null, attempt, worktreePath, branch };
}

function isWorkerFault(error: unknown): boolean {
  return isPhase0Error(error) && (error.code === "raw_install_forbidden" || error.code === "scope_violation" || error.code === "empty_commit" || error.code === "package_json");
}

function killPid(pid: number): void {
  try {
    process.kill(pid);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "ESRCH") return;
  }
}

class ConcurrencyProbe {
  private active = 0;
  max = 0;

  enter(): void {
    this.active += 1;
    if (this.active > this.max) this.max = this.active;
  }

  leave(): void {
    this.active = Math.max(0, this.active - 1);
  }

  reset(): void {
    this.active = 0;
    this.max = 0;
  }
}

class StartBarrier {
  private pending: number;
  private released = false;
  private readonly waiting: Array<() => void> = [];

  constructor(count: number) {
    this.pending = count;
  }

  async wait(): Promise<void> {
    if (this.released) return;
    this.pending -= 1;
    if (this.pending <= 0) {
      this.released = true;
      const queued = this.waiting.splice(0);
      for (const resolve of queued) resolve();
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }
}
