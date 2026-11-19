export class UnknownPromptContractError extends Error {
  readonly contractId: string;

  constructor(contractId: string) {
    super(`Unknown prompt contract: ${contractId}`);
    this.name = "UnknownPromptContractError";
    this.contractId = contractId;
  }
}

export class PromptEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptEnvelopeError";
  }
}

export class AmbiguousPromptJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousPromptJsonError";
  }
}

export class InvalidPromptJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPromptJsonError";
  }
}
