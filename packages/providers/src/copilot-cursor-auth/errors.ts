export class DeviceFlowExpiredError extends Error {
  readonly code = "expired_token" as const;
  readonly retryAction = "Generate new code" as const;

  constructor() {
    super("The GitHub device code expired before sign-in finished. Generate a new code.");
    this.name = "DeviceFlowExpiredError";
  }
}

export class DeviceFlowCancelledError extends Error {
  readonly code = "cancelled" as const;

  constructor() {
    super("GitHub device sign-in was cancelled.");
    this.name = "DeviceFlowCancelledError";
  }
}

export class DeviceFlowDeniedError extends Error {
  readonly code = "access_denied" as const;

  constructor(message: string) {
    super(message);
    this.name = "DeviceFlowDeniedError";
  }
}

export class NoCopilotEntitlementError extends Error {
  readonly code = "no_copilot_entitlement" as const;

  constructor(message: string) {
    super(message);
    this.name = "NoCopilotEntitlementError";
  }
}

export class OrgPolicyBlockedError extends Error {
  readonly code = "org_policy" as const;
  readonly orgPolicyMessage: string;

  constructor(orgPolicyMessage: string) {
    super(orgPolicyMessage);
    this.name = "OrgPolicyBlockedError";
    this.orgPolicyMessage = orgPolicyMessage;
  }
}

export class CopilotOverageConfirmationRequiredError extends Error {
  readonly code = "paid_overage_confirmation_required" as const;

  constructor(connectionId: string) {
    super(
      `Copilot connection ${connectionId} would enter paid overage. Explicit confirmation is required before any charge.`,
    );
    this.name = "CopilotOverageConfirmationRequiredError";
  }
}

export class CopilotPremiumExhaustedError extends Error {
  readonly code = "premium_exhausted" as const;

  constructor(message: string) {
    super(message);
    this.name = "CopilotPremiumExhaustedError";
  }
}

export class NoAllowedCopilotModelError extends Error {
  readonly code = "no_allowed_copilot_model" as const;

  constructor() {
    super("The Copilot organization policy allows none of the configured models.");
    this.name = "NoAllowedCopilotModelError";
  }
}

export class CursorAuthCancelledError extends Error {
  readonly code = "cancelled" as const;

  constructor() {
    super("Cursor browser sign-in was cancelled.");
    this.name = "CursorAuthCancelledError";
  }
}

export class CursorUnauthorizedError extends Error {
  readonly code = "unauthorized" as const;
  readonly status = 401 as const;

  constructor(message: string) {
    super(message);
    this.name = "CursorUnauthorizedError";
  }
}

export class RawCredentialPersistenceError extends Error {
  readonly code = "raw_credential" as const;

  constructor(label: string) {
    super(`Refusing to write a raw credential in ${label}`);
    this.name = "RawCredentialPersistenceError";
  }
}
