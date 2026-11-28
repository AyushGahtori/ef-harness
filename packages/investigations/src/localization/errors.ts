export class LocalizationToolkitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalizationToolkitError";
  }
}

export class FlakyReproBlocksBisectError extends LocalizationToolkitError {
  constructor(detail: string) {
    super(`flaky reproduction blocks bisect: ${detail}`);
    this.name = "FlakyReproBlocksBisectError";
  }
}

export class ShallowCloneBisectLimitedError extends LocalizationToolkitError {
  constructor(availableCommits: number) {
    super(
      `Repo is a shallow clone — bisect limited to available commits (${availableCommits})`,
    );
    this.name = "ShallowCloneBisectLimitedError";
  }
}

export class BisectDepthExceededError extends LocalizationToolkitError {
  constructor(steps: number) {
    super(`bisect depth exceeded limit (${steps} > ${8})`);
    this.name = "BisectDepthExceededError";
  }
}

export class DdminEvaluationBudgetExceededError extends LocalizationToolkitError {
  constructor(evaluations: number) {
    super(`ddmin evaluation budget exceeded (${evaluations} > ${40})`);
    this.name = "DdminEvaluationBudgetExceededError";
  }
}

export class DuplicateFalsifiedHypothesisError extends LocalizationToolkitError {
  constructor(hypothesisId: string) {
    super(`hypothesis ${hypothesisId} is already marked falsified`);
    this.name = "DuplicateFalsifiedHypothesisError";
  }
}