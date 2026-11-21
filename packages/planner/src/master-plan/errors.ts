export class MasterPlanError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "MasterPlanError";
  }
}

export function isMasterPlanError(error: unknown): error is MasterPlanError {
  return error instanceof MasterPlanError;
}
