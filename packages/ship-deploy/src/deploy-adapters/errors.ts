export class DeployAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeployAdapterError";
    this.code = code;
  }
}

export class ShellPathRejectedError extends DeployAdapterError {
  constructor(value: string) {
    super("shell_path_rejected", `Refused unsafe shell path or tag: ${value}`);
    this.name = "ShellPathRejectedError";
  }
}

export class HostKeyConfirmationRequiredError extends DeployAdapterError {
  constructor(
    readonly host: string,
    readonly fingerprint: string,
  ) {
    super(
      "host_key_confirmation_required",
      `Trust SSH host ${host}? Fingerprint: ${fingerprint}`,
    );
    this.name = "HostKeyConfirmationRequiredError";
  }
}

export class HostKeyMismatchError extends DeployAdapterError {
  constructor(readonly host: string) {
    super("host_key_mismatch", `SSH host key for ${host} no longer matches the pinned fingerprint`);
    this.name = "HostKeyMismatchError";
  }
}

export class LiveKeyPreviewBlockedError extends DeployAdapterError {
  constructor(readonly secretName: string) {
    super(
      "live_key_preview_blocked",
      `Refused: Stripe LIVE key blocked from Preview (${secretName})`,
    );
    this.name = "LiveKeyPreviewBlockedError";
  }
}

export class TestKeyProductionBlockedError extends DeployAdapterError {
  constructor(readonly secretName: string) {
    super(
      "test_key_production_blocked",
      `Warning: Stripe TEST key detected for Production (${secretName})`,
    );
    this.name = "TestKeyProductionBlockedError";
  }
}

export class ProductionRequiresExplicitApprovalError extends DeployAdapterError {
  constructor(readonly effectType: string) {
    super(
      "production_requires_explicit_approval",
      `Production ${effectType} requires explicit payload-bound ApprovalCard approval`,
    );
    this.name = "ProductionRequiresExplicitApprovalError";
  }
}

export class UnhealthySwapAbortedError extends DeployAdapterError {
  constructor(readonly reason: string) {
    super("unhealthy_swap_aborted", `Health-gated swap aborted before cutting traffic: ${reason}`);
    this.name = "UnhealthySwapAbortedError";
  }
}

export class ArgvSecretLeakError extends DeployAdapterError {
  constructor() {
    super("argv_secret_leak", "Refused to pass secret values via docker run -e argv");
    this.name = "ArgvSecretLeakError";
  }
}