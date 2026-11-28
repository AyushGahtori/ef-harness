export class CopilotAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CopilotAdapterError";
    this.code = code;
  }
}

export class CopilotOveragePausedError extends CopilotAdapterError {
  readonly checkpoint = true as const;

  constructor(message: string) {
    super("paid_overage_paused", message);
    this.name = "CopilotOveragePausedError";
  }
}

export class CopilotAuthExpiredError extends CopilotAdapterError {
  readonly cardTitle = "Re-authenticate GitHub Copilot" as const;

  constructor() {
    super("auth_expired", "Re-authenticate GitHub Copilot");
    this.name = "CopilotAuthExpiredError";
  }
}

export class CopilotByokComplianceError extends CopilotAdapterError {
  constructor(message: string) {
    super("byok_compliance", message);
    this.name = "CopilotByokComplianceError";
  }
}
