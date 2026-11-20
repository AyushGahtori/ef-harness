export class InvalidRubricMapError extends Error {
  readonly missingCriterionIds: readonly string[];

  constructor(missingCriterionIds: readonly string[]) {
    super(
      `opening-rubric-map@1 references missing catalog criteria: ${missingCriterionIds.join(", ")}`,
    );
    this.name = "InvalidRubricMapError";
    this.missingCriterionIds = missingCriterionIds;
  }
}

export class BasisStatusSeparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BasisStatusSeparationError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly opId: string;

  constructor(opId: string) {
    super(`op_id ${opId} was already committed with a different request`);
    this.name = "IdempotencyConflictError";
    this.opId = opId;
  }
}

export class DelegationBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegationBoundsError";
  }
}

export class UnknownQuestionError extends Error {
  constructor(questionId: string) {
    super(`question ${questionId} is not in the open batch`);
    this.name = "UnknownQuestionError";
  }
}

export class DiscoveryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryStateError";
  }
}
