export class CommandDeniedError extends Error {
  readonly rule: string;
  readonly reason: string;

  constructor(rule: string, reason: string) {
    super(`command denied (${rule}): ${reason}`);
    this.name = "CommandDeniedError";
    this.rule = rule;
    this.reason = reason;
  }
}

export class CwdEscapeDeniedError extends Error {
  readonly rule: string;
  readonly reason: string;

  constructor(rule: string, reason: string) {
    super(`cwd denied (${rule}): ${reason}`);
    this.name = "CwdEscapeDeniedError";
    this.rule = rule;
    this.reason = reason;
  }
}

export class CommandLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandLaunchError";
  }
}

export class InvalidLineRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLineRangeError";
  }
}

export class SandboxTierHoldError extends Error {
  readonly reason = "sandbox_tier_insufficient" as const;

  constructor(message: string) {
    super(message);
    this.name = "SandboxTierHoldError";
  }
}
