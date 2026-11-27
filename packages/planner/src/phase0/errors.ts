export class Phase0Error extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Phase0Error";
    this.code = code;
  }
}

export function isPhase0Error(error: unknown): error is Phase0Error {
  return error instanceof Phase0Error;
}
