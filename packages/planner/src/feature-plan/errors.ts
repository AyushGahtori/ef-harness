export class FeaturePlanError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "FeaturePlanError";
    this.code = code;
    this.details = details;
  }
}

export function isFeaturePlanError(error: unknown): error is FeaturePlanError {
  return error instanceof FeaturePlanError;
}
