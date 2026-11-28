import { UndoDataRetentionDialog } from "./dialog.js";
import { FeatureUndoExecutor, type ExecutorDeps } from "./executor.js";
import { CombinedRegressionGatePort } from "./gate.js";
import { GitRepo } from "./git.js";
import { FeatureUndoInventoryAnalyzer } from "./inventory.js";
import { SharedOwnershipTransferPlanner } from "./ownership.js";
import { ActiveTaskHaltPort, InboxRetirementPort } from "./ports.js";
import { RefLeasePort } from "./ref-lease.js";
import { KnowledgeGraphPort } from "./state-db.js";
import type { ReviveRequest, ReviveResult, UndoChoice, UndoResult } from "./types.js";
import { CrossFeatureUsageGraphChecker, ReverseImpactWalkerPort } from "./usage-graph.js";
import { UnknownFeatureError } from "./errors.js";

export interface FeatureUndoEngineOptions {
  readonly repo: string;
  readonly stateFile: string;
  readonly now?: () => number;
  readonly beforeCas?: ExecutorDeps["beforeCas"];
}

export class FeatureUndoEngine {
  readonly git: GitRepo;
  readonly graph: KnowledgeGraphPort;
  readonly usage: CrossFeatureUsageGraphChecker;
  readonly impact: ReverseImpactWalkerPort;
  readonly analyzer: FeatureUndoInventoryAnalyzer;
  readonly ownership: SharedOwnershipTransferPlanner;
  readonly dialog: UndoDataRetentionDialog;
  readonly gate: CombinedRegressionGatePort;
  readonly lease: RefLeasePort;
  readonly halt: ActiveTaskHaltPort;
  readonly inbox: InboxRetirementPort;
  readonly executor: FeatureUndoExecutor;

  constructor(options: FeatureUndoEngineOptions) {
    const now = options.now ?? Date.now;
    this.git = new GitRepo(options.repo);
    this.graph = KnowledgeGraphPort.open(options.stateFile);
    this.usage = new CrossFeatureUsageGraphChecker(this.git, this.graph);
    this.impact = new ReverseImpactWalkerPort(this.graph);
    this.analyzer = new FeatureUndoInventoryAnalyzer(this.git, this.graph, this.usage);
    this.ownership = new SharedOwnershipTransferPlanner();
    this.dialog = new UndoDataRetentionDialog();
    this.gate = new CombinedRegressionGatePort();
    this.lease = new RefLeasePort(this.graph, this.git, now);
    this.halt = new ActiveTaskHaltPort(this.graph);
    this.inbox = new InboxRetirementPort(this.graph);
    const deps: ExecutorDeps = {
      git: this.git,
      graph: this.graph,
      analyzer: this.analyzer,
      planner: this.ownership,
      dialog: this.dialog,
      gate: this.gate,
      lease: this.lease,
      halt: this.halt,
      inbox: this.inbox,
      now,
      ...(options.beforeCas ? { beforeCas: options.beforeCas } : {}),
    };
    this.executor = new FeatureUndoExecutor(deps);
  }

  execute(featureId: string, choice: UndoChoice): Promise<UndoResult> {
    return this.executor.execute(featureId, choice);
  }

  revive(request: ReviveRequest): ReviveResult {
    const feature = request.featureId
      ? this.graph.getFeature(request.featureId)
      : this.graph.findUndoneByText(request.text ?? "");
    if (!feature) throw new UnknownFeatureError(request.featureId || request.text || "(empty)");
    const revived = this.graph.revive(feature.featureId);
    return {
      featureId: revived.featureId,
      title: revived.title,
      nodeStatus: revived.nodeStatus,
      lifecycle: revived.lifecycle,
      specs: revived.specs,
      decisions: revived.decisions,
      mergeSha: revived.mergeSha,
      revived: revived.nodeStatus === "active" && revived.featureId === feature.featureId,
    };
  }

  close(): void {
    this.graph.close();
  }
}
