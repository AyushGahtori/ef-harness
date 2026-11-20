export class HintLadderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HintLadderError";
  }
}

export class CanonicalQueryMissingError extends HintLadderError {
  constructor(name: string) {
    super(`canonical query ${name} is missing from schema/queries.sql`);
    this.name = "CanonicalQueryMissingError";
  }
}

export class DisputeReferenceError extends HintLadderError {
  constructor(message: string) {
    super(message);
    this.name = "DisputeReferenceError";
  }
}

export class DisputeCounterexampleError extends HintLadderError {
  constructor(message: string) {
    super(message);
    this.name = "DisputeCounterexampleError";
  }
}

export class HiddenPoolInvariantError extends HintLadderError {
  constructor(message: string) {
    super(message);
    this.name = "HiddenPoolInvariantError";
  }
}
