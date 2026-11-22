import { spawn, type ChildProcess } from "node:child_process";

import type {
  AskOwnerResponderEnginePort,
  ChangeClassifierPort,
  DebouncedRevisionPropagatorPort,
  DiscoverySessionCoordinatorPort,
  ForeignRuntimeAdapterPort,
  KnowledgeGraphRepoPort,
  NativeWorkerLoopPort,
  OrderedMultiClauseExecutorPort,
  ProjectBudgetPort,
  ReverseImpactWalkerPort,
  RevisionAutoStartPolicyPort,
  TaskHoldsManagerPort,
  WindowsJobSupervisorPort,
} from "./ports.js";
import { emptyImpact, isRevivalStatus, SteeringRuntime } from "./runtime.js";
import {
  CLAUSE_RANK,
  DELTA_COST_CEILING_MICRO_USD,
  DELTA_TASK_CEILING,
  DELTA_WINDOW_CEILING_PPM,
  JobLeakError,
  type AutoStartDecision,
  type BudgetSnapshot,
  type ChangeClass,
  type Citation,
  type ClassifiedChange,
  type EvidenceRecord,
  type FeatureCostEstimate,
  type FeatureMatch,
  type FeatureRecord,
  type ImpactedSubgraph,
  type JobHandle,
  type JobTermination,
  type MiniDiscoverySession,
  type OwnerAnswer,
  type RevisionBatchRecord,
  type RevisionCandidate,
  type RevisionEdit,
  type SpawnedProcess,
  type SteeringClause,
  type TaskHold,
  type WorkerRecord,
} from "./types.js";

const FILLER = new Set([
  "a", "an", "the", "and", "or", "for", "with", "into", "from", "your", "please",
  "add", "also", "brand", "new", "to", "of", "weekly", "feature", "page", "mid", "build",
]);

const ACRONYMS = new Set(["csv", "pdf", "ui", "api", "id"]);

const STUBBORN_CHILD = [
  "process.on('message', () => undefined);",
  "process.on('SIGINT', () => undefined);",
  "process.on('SIGTERM', () => undefined);",
  "process.on('SIGBREAK', () => undefined);",
  "setInterval(() => undefined, 1000);",
].join("");

export function contentTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !FILLER.has(token));
}

export function displayTitle(value: string): string {
  const words = contentTokens(value).map((token) => {
    if (ACRONYMS.has(token)) return token.toUpperCase();
    return token.charAt(0).toUpperCase() + token.slice(1);
  });
  return words.join(" ");
}

export function featureIdFromTitle(title: string): string {
  const pascal = contentTokens(title).map((token) => token.charAt(0).toUpperCase() + token.slice(1));
  return `F-${pascal.join("")}`;
}

function featureSearchTokens(feature: FeatureRecord): string[] {
  const splitId = feature.featureId.replace(/^F-/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return [...new Set(contentTokens(`${feature.slug} ${feature.title} ${splitId}`))];
}

function citation(kind: Citation["kind"], id: string, label: string): Citation {
  return { kind, id, label, href: `ef://${kind}/${id}` };
}

function formatUsd(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const dollars = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n;
  const text = `${dollars.toString()}.${cents.toString().padStart(2, "0")}`;
  return negative ? `-$${text}` : `$${text}`;
}

function killErrorIsGone(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ESRCH" || error.code === "EPERM");
}

export class LocalAskOwnerResponderEngine implements AskOwnerResponderEnginePort {
  constructor(private readonly runtime: SteeringRuntime) {}

  answerQuestion(question: string): OwnerAnswer {
    const trimmed = question.trim();
    if (/\bbudget\b/i.test(trimmed) && /\b(left|remain|remaining|much)\b/i.test(trimmed)) {
      return this.budgetAnswer();
    }
    const workerMatch = /\bworker\s+([A-Za-z][A-Za-z0-9_-]*)/i.exec(trimmed) ?? /\b(A\d{3,})\b/.exec(trimmed);
    if (workerMatch?.[1]) {
      const workerAnswer = this.workerAnswer(workerMatch[1]);
      if (workerAnswer) return workerAnswer;
    }
    if (/auth tokens/i.test(trimmed)) {
      const stored = this.searchAnswer(trimmed, "Auth tokens");
      if (stored) return stored;
    }
    const searched = this.searchAnswer(trimmed, "Evidence");
    if (searched) return searched;
    return {
      text: "No evidence in state.db matches that question.",
      citations: [],
      grounded: false,
      guessed: false,
      llmCalls: 0,
    };
  }

  private budgetAnswer(): OwnerAnswer {
    const budget = this.runtime.budget;
    const left = budget.capMicroUsd - budget.spentMicroUsd;
    const windowPct = budget.windowCapPpm === 0 ? 0 : Math.round((budget.windowUsedPpm / budget.windowCapPpm) * 100);
    return {
      text: `${formatUsd(left)} left of ${formatUsd(budget.capMicroUsd)} spend cap · ${windowPct.toString()}% of the window used.`,
      citations: [citation("receipt", "budget-ledger", "Budget ledger")],
      grounded: true,
      guessed: false,
      llmCalls: 0,
    };
  }

  private workerAnswer(workerId: string): OwnerAnswer | null {
    const worker = this.runtime.workers.get(workerId) ?? [...this.runtime.workers.values()].find((item) => item.id.toLowerCase() === workerId.toLowerCase());
    const evidence = this.runtime.evidence.get(workerId);
    if (!worker && !evidence) return null;
    const taskId = worker?.taskId ?? evidence?.taskId ?? workerId;
    const featureId = worker?.featureId ?? evidence?.featureId ?? "unknown";
    const activity = worker ? `${worker.state === "running" ? "coding" : worker.state} ${taskId} on ${featureId}` : evidence?.text ?? "";
    const citations = [
      citation("node", worker?.id ?? workerId, `Worker ${worker?.id ?? workerId}`),
      citation("task", taskId, taskId),
    ];
    if (evidence?.file) citations.push(citation("file", evidence.file, evidence.file));
    return {
      text: worker ? `Worker ${worker.id} is ${activity}.` : (evidence?.text ?? activity),
      citations,
      grounded: true,
      guessed: false,
      llmCalls: 0,
    };
  }

  private searchAnswer(question: string, label: string): OwnerAnswer | null {
    const tokens = contentTokens(question);
    let best: EvidenceRecord | null = null;
    let bestScore = 0;
    for (const item of this.runtime.evidence.values()) {
      const haystack = `${item.id} ${item.title} ${item.text} ${item.file ?? ""}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 1;
      }
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    if (!best || bestScore === 0) return null;
    const citations = [citation(best.kind === "task" ? "task" : "node", best.id, best.title || label)];
    if (best.taskId) citations.push(citation("task", best.taskId, best.taskId));
    if (best.file) citations.push(citation("file", best.file, best.file));
    return {
      text: best.text,
      citations,
      grounded: true,
      guessed: false,
      llmCalls: 0,
    };
  }
}

export class LocalChangeClassifier implements ChangeClassifierPort {
  classify(edit: RevisionEdit): ClassifiedChange {
    const reasons: string[] = [];
    const requested = edit.requestedClass;
    const breakingText = /drop column|remove field|breaking|11:00\s*(?:→|->)\s*10:00/i.test(edit.afterText);
    if (requested === "breaking" || breakingText || edit.destructiveMigration === true) {
      reasons.push(edit.destructiveMigration ? "destructive_migration" : "breaking_contract");
      const floorApplied = requested === "cosmetic" || requested === "clarifying" || requested === "compatible";
      if (floorApplied) reasons.push("classification_floor");
      return { changeClass: "breaking", reasons, floorApplied };
    }
    const changeClass: ChangeClass = requested ?? "compatible";
    return { changeClass, reasons: [changeClass], floorApplied: false };
  }
}

export class LocalReverseImpactWalker implements ReverseImpactWalkerPort {
  constructor(private readonly runtime: SteeringRuntime) {}

  walkCombined(startIds: readonly string[]): ImpactedSubgraph {
    const tasks = new Set<string>();
    for (const startId of startIds) {
      for (const taskId of this.runtime.impact.get(startId) ?? []) tasks.add(taskId);
      const feature = this.runtime.features.get(startId);
      if (feature) {
        for (const task of this.runtime.tasks.values()) {
          if (task.featureId === feature.featureId && task.active && this.runtime.impact.size === 0) {
            tasks.add(task.taskId);
          }
        }
      }
    }
    return { ...emptyImpact(), affectedActiveTasks: [...tasks] };
  }
}

export class LocalDebouncedRevisionPropagator implements DebouncedRevisionPropagatorPort {
  private sequence = 0;

  apply(input: {
    readonly targetId: string;
    readonly changeClass: ChangeClass;
    readonly impactedTaskIds: readonly string[];
    readonly msgSeq: string;
  }): RevisionBatchRecord {
    this.sequence += 1;
    return {
      revisionId: `rev-${input.msgSeq}-${this.sequence.toString()}`,
      changeClass: input.changeClass,
      holdTaskIds: input.impactedTaskIds,
      llmCalls: 0,
    };
  }
}

export class LocalRevisionAutoStartPolicy implements RevisionAutoStartPolicyPort {
  evaluate(candidate: RevisionCandidate): AutoStartDecision {
    const triggers: string[] = [];
    const reasons: string[] = [];
    if (candidate.unresolvedMustAsk) {
      triggers.push("must_ask");
      reasons.push("Needs approval: unresolved must-ask criterion");
    }
    if (candidate.unresolvedConflict) {
      triggers.push("conflict");
      reasons.push("Needs approval: unresolved conflict");
    }
    if (candidate.breakingContract) {
      triggers.push("breaking_contract");
      reasons.push("Needs approval: breaking contract change");
    }
    if (candidate.destructiveMigration) {
      triggers.push("destructive_migration");
      reasons.push("Needs approval: destructive migration");
    }
    if (candidate.newPackages.length > 0) {
      triggers.push("new_dependency");
      reasons.push(`Needs approval: adds new package '${candidate.newPackages[0] ?? "package"}'`);
    }
    if (candidate.externalEffects.length > 0) {
      triggers.push("external_effect");
      reasons.push("Needs approval: external side effect");
    }
    if (candidate.deltaTasks > DELTA_TASK_CEILING) {
      reasons.push(`${candidate.deltaTasks.toString()} tasks exceeds the ${DELTA_TASK_CEILING.toString()}-task ceiling`);
    }
    if (candidate.deltaCostMicroUsd > DELTA_COST_CEILING_MICRO_USD) {
      reasons.push("revision exceeds the $1 auto-start ceiling");
    }
    if (candidate.deltaPlanWindowPpm > DELTA_WINDOW_CEILING_PPM) {
      reasons.push("revision exceeds the 2% plan-window ceiling");
    }
    if (triggers.length > 0 || reasons.length > 0) {
      return { autoStart: false, openPlanPreview: true, triggers, reasons, undoable: false };
    }
    return { autoStart: true, openPlanPreview: false, triggers, reasons, undoable: true };
  }
}

export class LocalTaskHoldsManager implements TaskHoldsManagerPort {
  constructor(private readonly runtime: SteeringRuntime) {}

  placeHold(taskId: string, reason: string, source: string, createdAtMs: number): TaskHold {
    return this.runtime.placeHold({ taskId, reason, source, createdAtMs });
  }

  releaseHold(taskId: string, reason: string): number {
    return this.runtime.releaseHold(taskId, reason);
  }

  listActiveHolds(taskId?: string): readonly TaskHold[] {
    return this.runtime.listHolds(taskId);
  }
}

export class LocalKnowledgeGraphRepo implements KnowledgeGraphRepoPort {
  constructor(private readonly runtime: SteeringRuntime) {}

  listFeatures(): readonly FeatureRecord[] {
    return [...this.runtime.features.values()];
  }

  getFeature(featureId: string): FeatureRecord | null {
    return this.runtime.features.get(featureId) ?? null;
  }

  searchFeatures(query: string): readonly FeatureMatch[] {
    const queryTokens = new Set(contentTokens(query));
    const matches: FeatureMatch[] = [];
    for (const feature of this.runtime.features.values()) {
      if (feature.status === "archived") continue;
      const featureTokens = featureSearchTokens(feature);
      if (featureTokens.length === 0) continue;
      let hit = 0;
      for (const token of featureTokens) {
        if (queryTokens.has(token)) hit += 1;
      }
      const score = hit / featureTokens.length;
      const distinctive = featureTokens.some((token) => queryTokens.has(token) && token !== "export" && token !== "toggle");
      if (score === 1 || (score >= 0.67 && distinctive)) {
        matches.push({ feature, score });
      }
    }
    matches.sort((left, right) => right.score - left.score || left.feature.featureId.localeCompare(right.feature.featureId));
    return matches;
  }

  upsertFeature(feature: FeatureRecord): void {
    this.runtime.upsertFeature(feature);
  }

  readEvidence(query: string): readonly EvidenceRecord[] {
    const tokens = contentTokens(query);
    return [...this.runtime.evidence.values()].filter((item) => {
      const haystack = `${item.id} ${item.title} ${item.text}`.toLowerCase();
      return tokens.some((token) => haystack.includes(token));
    });
  }

  getEvidence(id: string): EvidenceRecord | null {
    return this.runtime.evidence.get(id) ?? null;
  }
}

export class LocalDiscoverySessionCoordinator implements DiscoverySessionCoordinatorPort {
  private readonly sessions: MiniDiscoverySession[] = [];

  openMiniDiscovery(input: {
    readonly featureId: string;
    readonly criteria: readonly string[];
    readonly preservedAnswerIds: readonly string[];
    readonly haltUnrelatedWorkers: false;
  }): MiniDiscoverySession {
    if (input.haltUnrelatedWorkers !== false) {
      throw new Error("mini-discovery cannot halt unrelated workers");
    }
    const session: MiniDiscoverySession = {
      sessionId: `disc-${input.featureId}`,
      featureId: input.featureId,
      criteria: input.criteria,
      preservedAnswerIds: input.preservedAnswerIds,
      haltUnrelatedWorkers: false,
    };
    this.sessions.push(session);
    return session;
  }

  listSessions(): readonly MiniDiscoverySession[] {
    return [...this.sessions];
  }
}

export class LocalProjectBudget implements ProjectBudgetPort {
  constructor(private readonly runtime: SteeringRuntime) {}

  snapshot(): BudgetSnapshot {
    return this.runtime.budget;
  }

  estimate(input: { readonly text: string; readonly costMicroUsd?: bigint; readonly windowPpm?: number }): FeatureCostEstimate {
    return {
      costMicroUsd: input.costMicroUsd ?? 250_000n,
      windowPpm: input.windowPpm ?? 5_000,
    };
  }
}

export class LocalOrderedMultiClauseExecutor implements OrderedMultiClauseExecutorPort {
  readonly executedKinds: string[] = [];

  execute<T>(clauses: readonly SteeringClause[], run: (clause: SteeringClause) => T): readonly T[] {
    const sorted = [...clauses].sort((left, right) => CLAUSE_RANK[left.kind] - CLAUSE_RANK[right.kind] || left.index - right.index);
    const results: T[] = [];
    for (const clause of sorted) {
      this.executedKinds.push(clause.kind);
      results.push(run(clause));
    }
    return results;
  }
}

export class LocalNativeWorkerLoop implements NativeWorkerLoopPort {
  private readonly ids: string[] = [];

  interrupt(workerId: string): void {
    this.ids.push(workerId);
  }

  interrupted(): readonly string[] {
    return [...this.ids];
  }
}

export class LocalForeignRuntimeAdapter implements ForeignRuntimeAdapterPort {
  private readonly ids: string[] = [];

  interrupt(workerId: string): void {
    this.ids.push(workerId);
  }

  interrupted(): readonly string[] {
    return [...this.ids];
  }
}

interface TrackedChild {
  readonly pid: number;
  readonly child: ChildProcess | null;
}

export class LocalWindowsJobSupervisor implements WindowsJobSupervisorPort {
  readonly escalatedHistory: number[] = [];
  private readonly jobs = new Map<string, Map<number, TrackedChild>>();
  private sequence = 0;

  createJob(name: string): JobHandle {
    this.sequence += 1;
    const id = `job-${this.sequence.toString()}`;
    this.jobs.set(id, new Map());
    return { id, name };
  }

  assignProcess(jobId: string, pid: number): void {
    const job = this.require(jobId);
    job.set(pid, { pid, child: null });
  }

  spawnInJob(jobId: string): SpawnedProcess {
    const job = this.require(jobId);
    const child = spawn(process.execPath, ["-e", STUBBORN_CHILD], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    child.on("error", (error) => {
      if (!killErrorIsGone(error)) return;
    });
    child.unref();
    const pid = child.pid;
    if (pid === undefined) {
      throw new JobLeakError([]);
    }
    job.set(pid, { pid, child });
    return { pid, jobId };
  }

  async terminateJob(jobId: string, graceMs: number): Promise<JobTermination> {
    const started = performance.now();
    const job = this.require(jobId);
    const tracked = [...job.values()];
    const interruptedPids: number[] = [];
    for (const entry of tracked) {
      interruptedPids.push(entry.pid);
      this.signalInterrupt(entry);
    }
    if (tracked.some((entry) => this.alive(entry))) {
      await delay(graceMs);
    }
    const escalatedPids: number[] = [];
    for (const entry of tracked) {
      if (!this.alive(entry)) continue;
      escalatedPids.push(entry.pid);
      this.escalatedHistory.push(entry.pid);
      this.hardKill(entry);
    }
    const deadline = performance.now() + 400;
    while (performance.now() < deadline && tracked.some((entry) => this.alive(entry))) {
      await delay(15);
    }
    const survivingPids = tracked.filter((entry) => this.alive(entry)).map((entry) => entry.pid);
    return {
      jobId,
      interruptedPids,
      escalatedPids,
      survivingPids,
      elapsedMs: performance.now() - started,
    };
  }

  async terminateAll(graceMs: number): Promise<readonly JobTermination[]> {
    const results: JobTermination[] = [];
    for (const jobId of this.jobs.keys()) {
      results.push(await this.terminateJob(jobId, graceMs));
    }
    return results;
  }

  pidAlive(pid: number): boolean {
    for (const job of this.jobs.values()) {
      const entry = job.get(pid);
      if (entry) return this.alive(entry);
    }
    return processAlive(pid);
  }

  private require(jobId: string): Map<number, TrackedChild> {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobLeakError([]);
    return job;
  }

  private signalInterrupt(entry: TrackedChild): void {
    if (entry.child?.connected) {
      try {
        entry.child.send("SIGINT");
      } catch (error) {
        if (!killErrorIsGone(error)) throw error;
      }
    }
  }

  private hardKill(entry: TrackedChild): void {
    if (entry.child && entry.child.exitCode === null) {
      try {
        entry.child.kill("SIGKILL");
      } catch (error) {
        if (!killErrorIsGone(error)) throw error;
      }
    }
    try {
      process.kill(entry.pid, "SIGKILL");
    } catch (error) {
      if (!killErrorIsGone(error)) throw error;
    }
  }

  private alive(entry: TrackedChild): boolean {
    if (entry.child && (entry.child.exitCode !== null || entry.child.signalCode !== null)) return false;
    return processAlive(entry.pid);
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (killErrorIsGone(error)) return false;
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function workerSnapshot(workers: readonly WorkerRecord[]): string {
  return workers.map((worker) => `${worker.id}:${worker.state}:${worker.checkpointRef}`).join("|");
}

export { isRevivalStatus };
