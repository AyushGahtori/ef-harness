export class ReplayCassetteStaleError extends Error {
  readonly code = "ReplayCassetteStaleError" as const;

  constructor(readonly inputHash: string) {
    super(`ReplayCassetteStaleError: no recorded response for input hash ${inputHash}`);
    this.name = "ReplayCassetteStaleError";
  }
}

export class EvalSetSizeError extends Error {
  readonly code = "EvalSetSizeError" as const;

  constructor(readonly size: number) {
    super(`eval set must contain 10 to 30 cases, received ${size}`);
    this.name = "EvalSetSizeError";
  }
}

export class JudgeFamilyError extends Error {
  readonly code = "JudgeFamilyError" as const;

  constructor(message: string) {
    super(message);
    this.name = "JudgeFamilyError";
  }
}
