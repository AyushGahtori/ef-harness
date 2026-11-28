export class PolicyDocumentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PolicyDocumentError";
    this.code = code;
  }
}

export type ComplianceLockCode =
  | "anthropic_subscription_oauth"
  | "anthropic_setup_token"
  | "claude_credentials_path"
  | "gemini_credentials_path"
  | "forbidden_vendor"
  | "gemini_opt_in"
  | "immutable_lock";

export class ComplianceLockError extends Error {
  readonly code: ComplianceLockCode;

  constructor(code: ComplianceLockCode, message: string) {
    super(message);
    this.name = "ComplianceLockError";
    this.code = code;
  }
}
