export class HumanStepError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HumanStepError";
    this.code = code;
  }
}

export function isHumanStepError(error: unknown): error is HumanStepError {
  return error instanceof HumanStepError;
}
