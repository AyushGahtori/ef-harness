import { CcrError } from "./errors.js";
import type { LocalHybridRevision, LocalReverseImpactWalker, LocalRevisionAutoStartPolicy, LocalSurgicalHolds } from "./ports.js";
import type { ContractChangeDecisionCard, ImpactedBlast, SemanticAlternative } from "./types.js";
import { APPROVE_BREAKING, EXPAND_THEN_CONTRACT, KEEP_ORIGINAL, LOCKED_ADAPTER_INSTRUCTION } from "./types.js";

export class BreakingCcrRevisionReopener {
  constructor(
    private readonly impact: LocalReverseImpactWalker,
    private readonly autoStart: LocalRevisionAutoStartPolicy,
    private readonly holds: LocalSurgicalHolds,
    private readonly revision: LocalHybridRevision,
  ) {}

  blast(contractNodeId: string): ImpactedBlast {
    return this.impact.walk([contractNodeId]);
  }

  open(input: {
    readonly ccrId: string;
    readonly requestedChange: string;
    readonly whyWorkerHitIt: string;
    readonly contractNodeId: string;
    readonly semantic: boolean;
    readonly semanticConsumers: readonly string[];
    readonly semanticAlternatives: readonly SemanticAlternative[];
  }): ContractChangeDecisionCard {
    const blast = this.blast(input.contractNodeId);
    const alternatives = unique([
      EXPAND_THEN_CONTRACT,
      APPROVE_BREAKING,
      KEEP_ORIGINAL,
      ...input.semanticAlternatives.map((alternative) => alternative.summary),
    ]);
    return {
      ccrId: input.ccrId,
      requestedChange: input.requestedChange,
      whyWorkerHitIt: input.whyWorkerHitIt,
      affectedFeatures: blast.affectedFeatures,
      affectedTasks: [...blast.affectedActiveTasks, ...blast.affectedMergedTasks],
      affectedScreens: blast.affectedScreens,
      affectedChecks: unique([...blast.affectedChecks, ...input.semanticConsumers]),
      alternatives,
      autoExecutionBlocked: true,
      revisionTask: "Task-087",
      autoStartPolicy: "Task-108",
      semantic: input.semantic,
    };
  }

  approve(ccrId: string, affectedActiveTasks: readonly string[]): {
    readonly autoStart: false;
    readonly trigger: "breaking_contract";
    readonly holds: readonly string[];
    readonly revisionTask: "Task-087";
  } {
    const policy = this.autoStart.evaluate(true);
    if (policy.autoStart || policy.trigger !== "breaking_contract") {
      throw new CcrError("ccr_state", "Breaking CCRs cannot auto-start.");
    }
    this.holds.place(affectedActiveTasks, `ccr:${ccrId}`);
    const opened = this.revision.open(ccrId, affectedActiveTasks);
    return {
      autoStart: false,
      trigger: "breaking_contract",
      holds: [...affectedActiveTasks],
      revisionTask: opened.revisionTask,
    };
  }

  reject(): { readonly instruction: typeof LOCKED_ADAPTER_INSTRUCTION } {
    return { instruction: LOCKED_ADAPTER_INSTRUCTION };
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
