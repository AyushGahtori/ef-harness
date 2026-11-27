import type { ProjectStateDb } from "@ef-harness/db";
import { isUiProjectKind } from "@ef-harness/shared-contracts";
import type { BudgetLedgerPort, Reservation } from "./budget.js";
import { INTEGRATION_REF, MAX_FIX_ROUNDS, VIEWPORTS } from "./constants.js";
import { combineLayerA, DeterministicRepoAuditor, regressionsAgainst } from "./deterministic-repo-auditor.js";
import { CompletionWaveNotReadyError } from "./errors.js";
import { LandingSummaryGenerator } from "./landing-summary.js";
import { canonicalProjectKind, LiveRouteCrawler } from "./live-route-crawler.js";
import { ShardedFinalProjectAuditor } from "./sharded-final-project-auditor.js";
import { FinalAuditStore } from "./state-db.js";
import type {
  AppBootPort,
  AuditCheck,
  AuditFixTask,
  CanonicalCatalog,
  CheckRunnerPort,
  CleanVerifierHarnessPort,
  CliCommandSpec,
  CommandExecutor,
  ConfirmedFinding,
  FinalProjectAuditorModel,
  FixExecutor,
  LandingSummary,
  LayerAReport,
  LayerBReport,
  LedgerRecap,
  OpenApiOperation,
  PlannedFeature,
  PlannedShard,
  PlannedWave,
  ProjectKindInput,
  Regression,
  RepoSnapshot,
  ShardInputs,
  ShardRun,
  SpendSnapshot,
  UiPlaywrightContractVerifierPort,
  WebRoute,
} from "./types.js";

export interface CompletionWaveRequest {
  readonly projectId: string;
  readonly integrationRef: typeof INTEGRATION_REF;
  readonly waves: readonly PlannedWave[];
  readonly snapshot: RepoSnapshot;
  readonly catalog: CanonicalCatalog;
  readonly shardInputs: ShardInputs;
  readonly kind: ProjectKindInput;
  readonly routes: readonly WebRoute[];
  readonly commands: readonly CliCommandSpec[];
  readonly operations: readonly OpenApiOperation[];
  readonly boot: AppBootPort;
  readonly browser: UiPlaywrightContractVerifierPort;
  readonly commandsExec: CommandExecutor;
  readonly checkRunner: CheckRunnerPort;
  readonly verifier: CleanVerifierHarnessPort;
  readonly model: FinalProjectAuditorModel;
  readonly fixExecutor: FixExecutor;
  readonly ledger: BudgetLedgerPort;
  readonly ledgerRecap: LedgerRecap;
  readonly spend: SpendSnapshot;
  readonly projectBudgetUnits: bigint;
  readonly auditCostPerShardUnits: bigint;
  readonly defaultFixCostUnits: bigint;
  readonly concurrency?: number;
  readonly waivedFingerprints?: readonly string[];
}

export interface CompletionWaveResult {
  readonly runId: string;
  readonly fixRounds: number;
  readonly budgetCapHit: boolean;
  readonly roundCapHit: boolean;
  readonly llmTokens: { readonly layerA: 0; readonly layerB: 0; readonly layerC: number };
  readonly fixTasks: readonly AuditFixTask[];
  readonly regressions: readonly Regression[];
  readonly summary: LandingSummary;
  readonly shardCount: number;
  readonly shardPrompts: readonly { readonly shardId: string; readonly prompt: string; readonly tokenEstimate: number }[];
}

export interface CompletionWaveControllerDeps {
  readonly stateDb?: ProjectStateDb;
  readonly store?: FinalAuditStore;
  readonly auditor?: DeterministicRepoAuditor;
  readonly crawler?: LiveRouteCrawler;
  readonly sharded?: ShardedFinalProjectAuditor;
  readonly summaries?: LandingSummaryGenerator;
}

function dedupe(findings: readonly ConfirmedFinding[]): ConfirmedFinding[] {
  const seen = new Set<string>();
  const out: ConfirmedFinding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.fingerprint)) continue;
    seen.add(finding.fingerprint);
    out.push(finding);
  }
  return out;
}

function collect(layerA: LayerAReport, layerB: LayerBReport, shards: readonly ShardRun[]): ConfirmedFinding[] {
  return dedupe([...layerA.findings, ...layerB.findings, ...shards.flatMap((shard) => shard.findings)]);
}

function isActionable(finding: ConfirmedFinding, attempted: ReadonlySet<string>, waived: ReadonlySet<string>): boolean {
  if (finding.advisory) return false;
  if (finding.severity !== "critical" && finding.severity !== "high") return false;
  if (finding.filePath === null || finding.lineStart === null || finding.lineEnd === null) return false;
  if (attempted.has(finding.fingerprint) || waived.has(finding.fingerprint)) return false;
  if (finding.kind === "layer_a" || finding.kind === "layer_b") return true;
  return finding.requirementId !== null || finding.ruleId !== null;
}

function receiptSummary(layerA: LayerAReport, layerB: LayerBReport): string {
  return [...layerA.checks, ...layerB.checks].map((check) => `${check.id}=${check.passed ? "pass" : "fail"}`).join("\n");
}

function mergeShards(previous: readonly ShardRun[], next: readonly ShardRun[]): ShardRun[] {
  const map = new Map(previous.map((item) => [item.shard.id, item]));
  for (const item of next) map.set(item.shard.id, item);
  return [...map.values()];
}

function layerBIds(request: CompletionWaveRequest): string[] {
  const kind = canonicalProjectKind(request.kind);
  if (isUiProjectKind(kind)) {
    return request.routes.flatMap((route) => VIEWPORTS.map((viewport) => `B:route:${route.path}@${viewport}`));
  }
  if (kind === "cli_tool") return request.commands.map((command) => `B:cli:${command.argv.join(" ")}`);
  return request.operations.map((operation) => `B:openapi:${operation.method} ${operation.path}`);
}

function featuresOf(waves: readonly PlannedWave[]): PlannedFeature[] {
  return waves.flatMap((wave) => [...wave.features]);
}

export class CompletionWaveController {
  private readonly store: FinalAuditStore;
  private readonly crawler: LiveRouteCrawler;
  private readonly sharded: ShardedFinalProjectAuditor;
  private readonly summaries: LandingSummaryGenerator;
  private readonly ownsStore: boolean;

  constructor(private readonly deps: CompletionWaveControllerDeps = {}) {
    if (deps.store !== undefined) {
      this.ownsStore = false;
      this.store = deps.store;
    } else if (deps.stateDb !== undefined) {
      this.ownsStore = false;
      this.store = FinalAuditStore.fromState(deps.stateDb);
    } else {
      this.ownsStore = true;
      this.store = FinalAuditStore.open();
    }
    this.crawler = deps.crawler ?? new LiveRouteCrawler();
    this.sharded = deps.sharded ?? new ShardedFinalProjectAuditor();
    this.summaries = deps.summaries ?? new LandingSummaryGenerator();
  }

  close(): void {
    if (this.ownsStore) this.store.close();
  }

  async run(request: CompletionWaveRequest): Promise<CompletionWaveResult> {
    this.assertReady(request);
    const auditor = this.auditorFor(request);
    const scopes = await request.ledger.ensureCompletionScopes({
      projectId: request.projectId,
      projectLimitUnits: request.projectBudgetUnits,
    });
    const runId = this.store.beginRun(request.projectId);
    const waived = new Set(request.waivedFingerprints ?? []);
    const plan = this.sharded.plan(request.shardInputs);
    let latestA = await this.ensureLayerA(request, runId, auditor);
    const baseline = latestA.suiteCases;
    let latestB = await this.ensureLayerB(request, runId, false);
    let shards = await this.ensureShards(request, runId, plan, receiptSummary(latestA, latestB), scopes.auditScopeId);
    let latestFindings = collect(latestA, latestB, shards);
    let fixRounds = this.store.readFixRounds(runId);
    let budgetCapHit = false;
    let roundCapHit = false;
    const attempted = new Set<string>();
    const fixTasks: AuditFixTask[] = [];
    let regressions: Regression[] = [];

    while (true) {
      const pending = latestFindings.filter((finding) => isActionable(finding, attempted, waived));
      if (pending.length === 0) break;
      if (fixRounds >= MAX_FIX_ROUNDS) {
        roundCapHit = true;
        break;
      }
      const fixSnapshot = await request.ledger.getScopeSnapshot("feature", scopes.fixScopeId);
      if (fixSnapshot.hardStop || fixSnapshot.remainingUnits <= 0n) {
        budgetCapHit = true;
        break;
      }
      const batch: ConfirmedFinding[] = [];
      const reservations: Reservation[] = [];
      for (const finding of pending) {
        const reservation = await request.ledger.reserveAcrossScopes({
          scopeId: scopes.fixScopeId,
          units: finding.fixCostUnits,
          purpose: "audit_fix",
        });
        if (!reservation) {
          budgetCapHit = true;
          continue;
        }
        reservations.push(reservation);
        batch.push(finding);
      }
      if (batch.length === 0) break;
      fixRounds += 1;
      const tasks = batch.map((finding) => this.toTask(finding, fixRounds));
      try {
        const applied = await request.fixExecutor.apply(tasks);
        for (const reservation of reservations) {
          await request.ledger.settleReservation(reservation.reservationId);
        }
        for (const finding of batch) attempted.add(finding.fingerprint);
        fixTasks.push(...tasks);
        this.store.saveFixRounds(runId, fixRounds);
        latestA = await auditor.auditAll(request.snapshot, request.checkRunner, request.verifier, `round-${fixRounds}`);
        const found = regressionsAgainst(baseline, latestA.suiteCases);
        latestB = await this.ensureLayerB(request, runId, true);
        if (found.length > 0) {
          regressions = found;
          latestFindings = collect(latestA, latestB, shards);
          break;
        }
        const changed = new Set<string>([...applied.changedFiles, ...tasks.map((task) => task.filePath)]);
        const affected = plan.filter((shard) => shard.files.some((file) => changed.has(file.path)));
        if (affected.length > 0) {
          const rerun = await this.sharded.run(
            this.shardRequest(request, receiptSummary(latestA, latestB), scopes.auditScopeId, runId),
            affected,
          );
          shards = mergeShards(shards, rerun);
        }
        latestFindings = collect(latestA, latestB, shards);
      } catch (error) {
        for (const reservation of reservations) {
          await request.ledger.releaseReservation(reservation.reservationId);
        }
        throw error;
      }
    }

    const fixScopeSnap = await request.ledger.getScopeSnapshot("feature", scopes.fixScopeId);
    const auditScopeSnap = await request.ledger.getScopeSnapshot("wave_paperwork", scopes.auditScopeId);
    const unresolvedBlocking = latestFindings.some(
      (finding) => !finding.advisory && finding.severity !== "low" && !waived.has(finding.fingerprint),
    );
    if (
      !budgetCapHit &&
      (fixScopeSnap.hardStop || fixScopeSnap.remainingUnits === 0n) &&
      (unresolvedBlocking || regressions.length > 0)
    ) {
      budgetCapHit = true;
    }
    const summary = this.summaries.generate({
      features: featuresOf(request.waves),
      routes: request.routes.map((route) => route.path),
      commands: request.commands.map((command) => command.argv.join(" ")),
      layerA: latestA,
      layerB: latestB,
      findings: latestFindings,
      regressions,
      waivedFingerprints: [...waived],
      ledger: request.ledgerRecap,
      spend: request.spend,
      fixRounds,
      budgetCapHit,
      roundCapHit,
      auditFixUnits: scopes.fixLimitUnits - fixScopeSnap.remainingUnits,
      auditFixCapUnits: scopes.fixLimitUnits,
      finalAuditUnits: scopes.auditLimitUnits - auditScopeSnap.remainingUnits,
      finalAuditCapUnits: scopes.auditLimitUnits,
    });
    this.store.saveSummary(runId, summary);
    this.store.completeRun(runId, fixRounds);
    return {
      runId,
      fixRounds,
      budgetCapHit,
      roundCapHit,
      llmTokens: { layerA: 0, layerB: 0, layerC: shards.reduce((sum, shard) => sum + shard.llmTokens, 0) },
      fixTasks,
      regressions,
      summary,
      shardCount: plan.length,
      shardPrompts: shards.map((shard) => ({
        shardId: shard.shard.id,
        prompt: shard.prompt,
        tokenEstimate: shard.tokenEstimate,
      })),
    };
  }

  private auditorFor(request: CompletionWaveRequest): DeterministicRepoAuditor {
    return this.deps.auditor ?? new DeterministicRepoAuditor({ fixCostUnits: request.defaultFixCostUnits });
  }

  private assertReady(request: CompletionWaveRequest): void {
    if (request.integrationRef !== INTEGRATION_REF) {
      throw new CompletionWaveNotReadyError("*", `completion wave runs on ${INTEGRATION_REF}`);
    }
    for (const wave of request.waves) {
      for (const feature of wave.features) {
        if (feature.state !== "DONE" || feature.mergedTo !== INTEGRATION_REF) {
          throw new CompletionWaveNotReadyError(
            feature.id,
            `${feature.id} is ${feature.state} on ${feature.mergedTo}, not DONE on ${INTEGRATION_REF}`,
          );
        }
      }
    }
  }

  private async ensureLayerA(
    request: CompletionWaveRequest,
    runId: string,
    auditor: DeterministicRepoAuditor,
  ): Promise<LayerAReport> {
    const steps: { readonly id: string; readonly run: () => AuditCheck | Promise<AuditCheck> }[] = [
      { id: "A:static_audit", run: () => auditor.staticAuditCheck(request.snapshot) },
      { id: "A:secret_scan", run: () => auditor.secretScanCheck(request.snapshot) },
      { id: "A:migration_cleanliness", run: () => auditor.migrationCheck(request.snapshot) },
      { id: "A:env_example", run: () => auditor.envExampleCheck(request.snapshot) },
      { id: "A:production_build", run: () => auditor.commandCheck("production_build", request.checkRunner) },
      { id: "A:typecheck", run: () => auditor.commandCheck("typecheck", request.checkRunner) },
      { id: "A:lint", run: () => auditor.commandCheck("lint", request.checkRunner) },
      { id: "A:combined_test_suite", run: () => auditor.suiteCheck(request.verifier, "initial") },
    ];
    const checks: AuditCheck[] = [];
    for (const step of steps) {
      const saved = this.store.readCheck(runId, step.id);
      if (saved) {
        checks.push(saved);
        continue;
      }
      const check = await step.run();
      this.store.saveCheck(runId, check);
      checks.push(check);
    }
    return combineLayerA(checks);
  }

  private async ensureLayerB(request: CompletionWaveRequest, runId: string, fresh: boolean): Promise<LayerBReport> {
    const skip = new Set<string>();
    const saved: AuditCheck[] = [];
    if (!fresh) {
      for (const id of layerBIds(request)) {
        const existing = this.store.readCheck(runId, id);
        if (!existing) continue;
        skip.add(id);
        saved.push(existing);
      }
    }
    const crawl = {
      kind: request.kind,
      routes: request.routes,
      commands: request.commands,
      operations: request.operations,
      boot: request.boot,
      browser: request.browser,
      commandsExec: request.commandsExec,
      fixCostUnits: request.defaultFixCostUnits,
      skipCheckIds: skip,
    };
    const report = await this.crawler.crawl(
      fresh ? crawl : { ...crawl, onCheck: (check) => this.store.saveCheck(runId, check) },
    );
    if (fresh || saved.length === 0) return report;
    const byId = new Map<string, AuditCheck>(saved.map((check) => [check.id, check]));
    for (const check of report.checks) byId.set(check.id, check);
    const checks = [...byId.values()];
    const findings = checks.flatMap((check) => check.findings);
    return { ...report, checks, findings, passed: findings.length === 0 };
  }

  private shardRequest(request: CompletionWaveRequest, receipts: string, auditScopeId: string, runId: string) {
    const base = {
      projectId: request.projectId,
      inputs: request.shardInputs,
      catalog: request.catalog,
      files: request.snapshot.files,
      receiptSummary: receipts,
      model: request.model,
      ledger: request.ledger,
      auditScopeId,
      costPerShardUnits: request.auditCostPerShardUnits,
      fixCostUnits: request.defaultFixCostUnits,
      onShard: (run: ShardRun) => this.store.saveShard(runId, run),
    };
    if (request.concurrency === undefined) return base;
    return { ...base, concurrency: request.concurrency };
  }

  private async ensureShards(
    request: CompletionWaveRequest,
    runId: string,
    plan: readonly PlannedShard[],
    receipts: string,
    auditScopeId: string,
  ): Promise<ShardRun[]> {
    const saved: ShardRun[] = [];
    const missing: PlannedShard[] = [];
    for (const shard of plan) {
      const existing = this.store.readShard(runId, shard.id);
      if (existing) saved.push(existing);
      else missing.push(shard);
    }
    const ran = await this.sharded.run(this.shardRequest(request, receipts, auditScopeId, runId), missing);
    return [...saved, ...ran].sort((left, right) => left.shard.id.localeCompare(right.shard.id));
  }

  private toTask(finding: ConfirmedFinding, round: number): AuditFixTask {
    if (finding.filePath === null || finding.lineStart === null || finding.lineEnd === null) {
      throw new CompletionWaveNotReadyError(finding.id, "fix task is missing a file location");
    }
    if (finding.severity !== "critical" && finding.severity !== "high") {
      throw new CompletionWaveNotReadyError(finding.id, "fix task severity is not critical or high");
    }
    return {
      id: `fix-r${round}-${finding.fingerprint}`,
      round,
      fingerprint: finding.fingerprint,
      filePath: finding.filePath,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd,
      requirementId: finding.requirementId,
      ruleId: finding.ruleId,
      severity: finding.severity,
      detail: finding.detail,
      branch: INTEGRATION_REF,
      costUnits: finding.fixCostUnits,
    };
  }
}
