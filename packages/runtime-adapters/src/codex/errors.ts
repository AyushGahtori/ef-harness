export class CodexRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CodexRuntimeError";
    this.code = code;
  }
}

export class CodexAllowanceWindDownError extends CodexRuntimeError {
  readonly usedPpm: number;
  readonly resetAt: string;

  constructor(usedPpm: number, resetAt: string) {
    super(
      "allowance_wind_down",
      `Codex primary window reached ${usedPpm} ppm; wind down before usage_limit_reached`,
    );
    this.name = "CodexAllowanceWindDownError";
    this.usedPpm = usedPpm;
    this.resetAt = resetAt;
  }
}

export function isCodexRuntimeError(error: unknown): error is CodexRuntimeError {
  return error instanceof CodexRuntimeError;
}
