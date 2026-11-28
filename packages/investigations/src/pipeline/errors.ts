export class InvestigationPipelineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InvestigationPipelineError";
    this.code = code;
  }
}

export class ProductionEditsForbiddenBeforeReproError extends InvestigationPipelineError {
  constructor(path: string) {
    super(
      "ProductionEditsForbiddenBeforeRepro",
      `Production write blocked during CLEAN_REPRO: ${path}`,
    );
    this.name = "ProductionEditsForbiddenBeforeReproError";
  }
}

export class ReproMustFailOnBaseError extends InvestigationPipelineError {
  constructor() {
    super(
      "ReproMustFailOnBase",
      "Repro script passed on baseline (exitCode === 0); it must fail with the target fingerprint first.",
    );
    this.name = "ReproMustFailOnBaseError";
  }
}

export class StageTransitionForbiddenError extends InvestigationPipelineError {
  constructor(from: string, to: string, reason: string) {
    super("StageTransitionForbidden", `Cannot advance ${from} → ${to}: ${reason}`);
    this.name = "StageTransitionForbiddenError";
  }
}

export class ScratchInstrumentationLeakError extends InvestigationPipelineError {
  constructor(paths: readonly string[]) {
    super(
      "ScratchInstrumentationLeak",
      `Stage 3 debug instrumentation would leak into fix worktree: ${paths.join(", ")}`,
    );
    this.name = "ScratchInstrumentationLeakError";
  }
}

export class MinimalFlipRejectedError extends InvestigationPipelineError {
  constructor(hypothesisId: string) {
    super(
      "MinimalFlipRejected",
      `Minimal-flip proof rejected hypothesis ${hypothesisId}; repro stayed red after causal toggle.`,
    );
    this.name = "MinimalFlipRejectedError";
  }
}

export class UnreproducibleBugEscalation extends InvestigationPipelineError {
  readonly escalation: string;

  constructor(escalation: string) {
    super("UnreproducibleBugEscalation", escalation);
    this.name = "UnreproducibleBugEscalation";
    this.escalation = escalation;
  }
}

export class PermanentTestsIncompleteError extends InvestigationPipelineError {
  constructor(detail: string) {
    super("PermanentTestsIncomplete", detail);
    this.name = "PermanentTestsIncompleteError";
  }
}

export class StageBudgetExceededError extends InvestigationPipelineError {
  constructor(stage: string) {
    super("StageBudgetExceeded", `Stage ${stage} exceeded its investigation turn budget.`);
    this.name = "StageBudgetExceededError";
  }
}