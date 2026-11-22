import type {
  DiscoverySessionCoordinatorPort,
  KnowledgeGraphRepoPort,
  ProjectBudgetPort,
  RevisionAutoStartPolicyPort,
} from "./ports.js";
import { isRevivalStatus, type SteeringRuntime } from "./runtime.js";
import { displayTitle, featureIdFromTitle, workerSnapshot } from "./local-ports.js";
import {
  SteeringError,
  type FeatureRecord,
  type FeatureStatus,
  type MiniDiscoverySession,
  type NewFeatureAdditionInput,
} from "./types.js";

export interface NewFeaturePlan {
  readonly action: "revived" | "created" | "reused_active" | "budget_blocked";
  readonly featureId: string;
  readonly title: string;
  readonly status: FeatureStatus;
  readonly warning: string | null;
  readonly revived: boolean;
  readonly preservedAnswerIds: readonly string[];
  readonly session: MiniDiscoverySession | null;
  readonly scheduledWave: number | null;
  readonly emptyStub: boolean;
  readonly workersUnchanged: true;
}

export class NewFeatureDedupSpawner {
  constructor(
    private readonly runtime: SteeringRuntime,
    private readonly graph: KnowledgeGraphRepoPort,
    private readonly discovery: DiscoverySessionCoordinatorPort,
    private readonly budget: ProjectBudgetPort,
    private readonly policy: RevisionAutoStartPolicyPort,
  ) {}

  spawn(input: NewFeatureAdditionInput): NewFeaturePlan {
    const beforeWorkers = workerSnapshot(this.runtime.listWorkers());
    const title = displayTitle(input.text);
    const matches = this.graph.searchFeatures(input.text).filter((match) => isSearchable(match.feature.status));
    const existing = matches[0]?.feature ?? this.graph.getFeature(featureIdFromTitle(title));
    if (existing && (existing.status === "active" || existing.status === "building")) {
      this.assertWorkers(beforeWorkers);
      return {
        action: "reused_active",
        featureId: existing.featureId,
        title: existing.title,
        status: existing.status,
        warning: null,
        revived: false,
        preservedAnswerIds: existing.settledAnswers.map((answer) => answer.id),
        session: null,
        scheduledWave: existing.wave,
        emptyStub: false,
        workersUnchanged: true,
      };
    }

    const revived = existing !== null && existing !== undefined && isRevivalStatus(existing.status);
    const featureId = existing?.featureId ?? this.allocate(title);
    if (featureId.endsWith("-2")) {
      throw new SteeringError("DUPLICATE_FEATURE_ID", `refusing duplicate id ${featureId}`);
    }
    const blocked = this.blockForBudget(input, existing?.title ?? title, featureId, beforeWorkers);
    if (blocked) return blocked;
    const estimate = this.budget.estimate({
      text: input.text,
      ...(input.estimatedCostMicroUsd === undefined ? {} : { costMicroUsd: input.estimatedCostMicroUsd }),
      ...(input.estimatedWindowPpm === undefined ? {} : { windowPpm: input.estimatedWindowPpm }),
    });
    const preserved = existing?.settledAnswers ?? [];
    const criteria = input.openCriteria ?? [`Define acceptance for ${title}`];
    const session = this.discovery.openMiniDiscovery({
      featureId,
      criteria,
      preservedAnswerIds: preserved.map((answer) => answer.id),
      haltUnrelatedWorkers: false,
    });
    const wave = this.scheduleWave(input, estimate.costMicroUsd, estimate.windowPpm);
    const record: FeatureRecord = {
      featureId,
      slug: existing?.slug ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      title: existing?.title ?? title,
      status: "discovering",
      scope: existing?.scope ?? title,
      settledAnswers: preserved,
      wave,
      priorStatus: existing?.status ?? null,
      originMsgSeq: input.msgSeq,
      emptyStub: !revived,
    };
    this.graph.upsertFeature(record);
    this.assertWorkers(beforeWorkers);
    return {
      action: revived ? "revived" : "created",
      featureId,
      title: record.title,
      status: "discovering",
      warning: null,
      revived,
      preservedAnswerIds: preserved.map((answer) => answer.id),
      session,
      scheduledWave: wave,
      emptyStub: record.emptyStub,
      workersUnchanged: true,
    };
  }

  private blockForBudget(input: NewFeatureAdditionInput, title: string, featureId: string, beforeWorkers: string): NewFeaturePlan | null {
    const estimate = this.budget.estimate({
      text: input.text,
      ...(input.estimatedCostMicroUsd === undefined ? {} : { costMicroUsd: input.estimatedCostMicroUsd }),
      ...(input.estimatedWindowPpm === undefined ? {} : { windowPpm: input.estimatedWindowPpm }),
    });
    const snapshot = this.budget.snapshot();
    const overSpend = snapshot.spentMicroUsd + estimate.costMicroUsd > snapshot.capMicroUsd;
    const overWindow = snapshot.windowUsedPpm + estimate.windowPpm > snapshot.windowCapPpm;
    if (!overSpend && !overWindow) return null;
    this.assertWorkers(beforeWorkers);
    return {
      action: "budget_blocked",
      featureId,
      title,
      status: "active",
      warning: overSpend
        ? `Adding '${title}' exceeds the active spend cap`
        : `Adding '${title}' exceeds the active window cap`,
      revived: false,
      preservedAnswerIds: [],
      session: null,
      scheduledWave: null,
      emptyStub: false,
      workersUnchanged: true,
    };
  }

  private allocate(title: string): string {
    const candidate = featureIdFromTitle(title);
    if (candidate.endsWith("-2") || this.graph.getFeature(candidate)) {
      const found = this.graph.getFeature(candidate);
      if (found) return found.featureId;
      throw new SteeringError("DUPLICATE_FEATURE_ID", `refusing duplicate id ${candidate}`);
    }
    return candidate;
  }

  private scheduleWave(input: NewFeatureAdditionInput, costMicroUsd: bigint, windowPpm: number): number {
    const current = this.runtime.currentWave;
    if (input.completelyDisjoint !== true) return current + 1;
    const decision = this.policy.evaluate({
      revisionId: `feature-${input.msgSeq}`,
      deltaTasks: 1,
      deltaCostMicroUsd: costMicroUsd,
      deltaPlanWindowPpm: windowPpm,
      breakingContract: false,
      destructiveMigration: false,
      unresolvedMustAsk: false,
      unresolvedConflict: false,
      newPackages: [],
      externalEffects: [],
      nowMs: input.nowMs ?? 0,
    });
    return decision.autoStart ? current : current + 1;
  }

  private assertWorkers(before: string): void {
    const after = workerSnapshot(this.runtime.listWorkers());
    if (before !== after) {
      throw new SteeringError("DISCOVERY_DISRUPTION", "new-feature discovery changed an active worker");
    }
  }
}

function isSearchable(status: FeatureStatus): boolean {
  return status === "active" || status === "building" || status === "deferred" || status === "undone";
}
