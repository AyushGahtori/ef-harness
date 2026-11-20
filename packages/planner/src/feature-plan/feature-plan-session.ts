import { FeaturePlanError } from "./errors.js";
import { HiddenCheckPoolStore } from "./hidden-check-pool-store.js";
import { IndependentOracleAuthorSealer } from "./independent-oracle-author-sealer.js";
import { JitFeaturePlanner } from "./jit-feature-planner.js";
import { materialize } from "./materialize.js";
import { visibleExamplesFrom } from "./model-input.js";
import { MemoryDiagnosticLog, type DiagnosticLog, type PlanContext } from "./ports.js";
import { RelationsToEdgesNormalizer } from "./relations-to-edges-normalizer.js";
import type { FeaturePlanDatabase } from "./state-db.js";
import type {
  ContractInput,
  EntityInput,
  FeaturePlanDocument,
  ModelAssignment,
  ModelRoster,
  PlannerOracleModel,
  RequirementInput,
  SealReceipt,
  WorkerBrief,
} from "./types.js";
import { compileWorkerBrief } from "./worker-brief.js";
import type { FeatureArchitectureConsistency } from "./ports.js";

export interface SessionInput {
  readonly featureId: string;
  readonly featureTitle: string;
  readonly architecture: FeatureArchitectureConsistency;
  readonly requirements: readonly RequirementInput[];
  readonly contracts: readonly ContractInput[];
  readonly entities: readonly EntityInput[];
  readonly roster: ModelRoster;
  readonly buildWorker: ModelAssignment;
  readonly model: PlannerOracleModel;
  readonly now: number;
  readonly worktree: string;
  readonly workerCode?: string | null;
}

export interface ReplanInput {
  readonly requirements: readonly RequirementInput[];
  readonly impactedRequirementIds: readonly string[];
  readonly now: number;
}

export interface CompilePermit {
  readonly sealedAt: number;
  readonly compileStartedAt: number;
}

/**
 * Plans a feature, seals hidden checks, and only then allows graph compile
 * and worker briefs. Revision re-plans and re-seals the impacted delta.
 */
export class FeaturePlanningSession {
  readonly store: HiddenCheckPoolStore;
  private readonly planner = new JitFeaturePlanner();
  private readonly sealer = new IndependentOracleAuthorSealer();
  private readonly normalizer: RelationsToEdgesNormalizer;
  private plan: FeaturePlanDocument | null = null;
  private receipt: SealReceipt | null = null;
  private requirements: readonly RequirementInput[] = [];
  private contracts: readonly ContractInput[] = [];
  private entities: readonly EntityInput[] = [];
  private featureTitle = "";
  private roster: ModelRoster | null = null;
  private buildWorker: ModelAssignment | null = null;
  private model: PlannerOracleModel | null = null;
  private architecture: FeatureArchitectureConsistency | null = null;
  private compileStartedAt: number | null = null;

  constructor(
    readonly db: FeaturePlanDatabase,
    readonly log: DiagnosticLog = new MemoryDiagnosticLog(),
  ) {
    this.store = new HiddenCheckPoolStore(db);
    this.normalizer = new RelationsToEdgesNormalizer(db);
  }

  planAndSeal(input: SessionInput): SealReceipt {
    if (this.plan) {
      throw new FeaturePlanError("incremental_scope", "Feature is already planned; replan the impacted requirements");
    }
    const context = this.contextFrom(input);
    const plan = this.planner.plan({ context, model: input.model, roster: input.roster });
    const authored = this.sealer.author({
      featureId: input.featureId,
      requirements: input.requirements,
      contracts: input.contracts,
      visibleExamples: visibleExamplesFrom(input.requirements, checksOf(plan)),
      roster: input.roster,
      buildWorker: input.buildWorker,
      model: input.model,
      now: input.now,
      log: this.log,
      compileStarted: this.compileStartedAt !== null,
      workerCode: input.workerCode ?? null,
    });
    this.db.transaction(() => {
      this.normalizer.commit(
        materialize({
          featureId: input.featureId,
          featureTitle: input.featureTitle,
          requirements: input.requirements,
          contracts: input.contracts,
          entities: input.entities,
          plan,
          sealed: authored.cases,
          includeTaskIds: null,
          includeRequirementIds: null,
        }),
      );
      this.store.commit(authored.cases, input.featureId, input.now);
    });
    this.remember(input, plan, authored.receipt);
    return authored.receipt;
  }

  replan(input: ReplanInput): SealReceipt {
    if (!this.plan || !this.receipt || !this.roster || !this.buildWorker || !this.model || !this.architecture) {
      throw new FeaturePlanError("architecture_not_ready", "Re-plan requires a sealed feature plan");
    }
    const featureId = this.plan.featureId;
    const context: PlanContext = {
      featureId,
      featureTitle: this.featureTitle,
      architecture: this.architecture,
      requirements: input.requirements,
      contracts: this.contracts,
      entities: this.entities,
    };
    const plan = this.planner.replan({
      context,
      model: this.model,
      roster: this.roster,
      previous: this.plan,
      impactedRequirementIds: input.impactedRequirementIds,
    });
    const impacted = new Set(input.impactedRequirementIds);
    const impactedRequirements = input.requirements.filter((requirement) => impacted.has(requirement.id));
    const authored = this.sealer.author({
      featureId,
      requirements: impactedRequirements,
      contracts: this.contracts,
      visibleExamples: visibleExamplesFrom(impactedRequirements, checksOf(plan)),
      roster: this.roster,
      buildWorker: this.buildWorker,
      model: this.model,
      now: input.now,
      log: this.log,
      compileStarted: false,
      workerCode: null,
    });
    const includeTaskIds = new Set(
      plan.tasks.filter((task) => task.requirementIds.some((id) => impacted.has(id))).map((task) => task.id),
    );
    this.db.transaction(() => {
      this.normalizer.commit(
        materialize({
          featureId,
          featureTitle: this.featureTitle,
          requirements: input.requirements,
          contracts: this.contracts,
          entities: this.entities,
          plan,
          sealed: authored.cases,
          includeTaskIds,
          includeRequirementIds: impacted,
        }),
      );
      this.store.commit(authored.cases, featureId, input.now);
    });
    const sealed = this.store.listForFeature(featureId);
    const receipt: SealReceipt = {
      ...authored.receipt,
      checkIds: sealed.map((row) => row.id),
      caseCount: sealed.length,
    };
    this.plan = plan;
    this.receipt = receipt;
    this.requirements = input.requirements;
    this.compileStartedAt = null;
    return receipt;
  }

  beginGraphCompile(now: number): CompilePermit {
    if (!this.receipt) {
      throw new FeaturePlanError(
        "step3b_before_compile",
        "oracle-author@1 must seal hidden checks before graph compile and before any worker starts",
      );
    }
    if (now < this.receipt.sealedAt) {
      throw new FeaturePlanError("step3b_before_compile", "Graph compile cannot start before the seal timestamp");
    }
    this.compileStartedAt = now;
    return { sealedAt: this.receipt.sealedAt, compileStartedAt: now };
  }

  authorizeWorker(taskId: string): WorkerBrief {
    if (!this.receipt || !this.plan || this.compileStartedAt === null) {
      throw new FeaturePlanError(
        "step3b_before_compile",
        "Workers start only after oracle-author@1 seals checks and graph compile has begun",
      );
    }
    return compileWorkerBrief({
      plan: this.plan,
      taskId,
      requirements: this.requirements,
      store: this.store,
    });
  }

  currentPlan(): FeaturePlanDocument {
    if (!this.plan) {
      throw new FeaturePlanError("architecture_not_ready", "Feature has not been planned");
    }
    return this.plan;
  }

  private contextFrom(input: SessionInput): PlanContext {
    return {
      featureId: input.featureId,
      featureTitle: input.featureTitle,
      architecture: input.architecture,
      requirements: input.requirements,
      contracts: input.contracts,
      entities: input.entities,
    };
  }

  private remember(input: SessionInput, plan: FeaturePlanDocument, receipt: SealReceipt): void {
    this.plan = plan;
    this.receipt = receipt;
    this.requirements = input.requirements;
    this.contracts = input.contracts;
    this.entities = input.entities;
    this.featureTitle = input.featureTitle;
    this.roster = input.roster;
    this.buildWorker = input.buildWorker;
    this.model = input.model;
    this.architecture = input.architecture;
  }
}

function checksOf(plan: FeaturePlanDocument) {
  return [...plan.tasks, plan.integration].flatMap((task) => task.checks);
}
