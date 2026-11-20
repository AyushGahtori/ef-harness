export class CyclicDerivationError extends Error {
  readonly cycle: readonly string[];

  constructor(cycle: readonly string[]) {
    super(`Cyclic derivation: ${cycle.join(" -> ")}`);
    this.name = "CyclicDerivationError";
    this.cycle = cycle;
  }
}

export class RuleNotAllowlistedError extends Error {
  readonly rule: string;
  readonly criterion: string;

  constructor(criterion: string, rule: string) {
    super(`Rule ${rule} is not allowlisted for ${criterion}`);
    this.name = "RuleNotAllowlistedError";
    this.rule = rule;
    this.criterion = criterion;
  }
}

export class UnsettledPremiseError extends Error {
  readonly premiseId: string;
  readonly reason: "missing" | "unsettled" | "retracted" | "superseded";

  constructor(premiseId: string, reason: UnsettledPremiseError["reason"]) {
    super(`Premise ${premiseId} is ${reason}`);
    this.name = "UnsettledPremiseError";
    this.premiseId = premiseId;
    this.reason = reason;
  }
}

export class UngroundedDerivationError extends Error {
  readonly nodeId: string;
  readonly reason: "assistant_paraphrase" | "unrooted" | "disallowed_basis";

  constructor(nodeId: string, reason: UngroundedDerivationError["reason"]) {
    super(`Derivation ${nodeId} is ${reason}`);
    this.name = "UngroundedDerivationError";
    this.nodeId = nodeId;
    this.reason = reason;
  }
}

export class CostlyDerivationError extends Error {
  readonly criterion: string;

  constructor(criterion: string) {
    super(`Costly or hard-to-reverse criterion ${criterion} cannot be derived`);
    this.name = "CostlyDerivationError";
    this.criterion = criterion;
  }
}
