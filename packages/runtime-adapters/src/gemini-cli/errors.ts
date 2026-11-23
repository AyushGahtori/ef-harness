export class GeminiOptInRequiredError extends Error {
  readonly code = "gemini_opt_in_required" as const;

  constructor(
    readonly reason: "opt_in_required" | "notice_mismatch" | "disabled" | "forbidden_vendor",
  ) {
    super(`Gemini CLI cannot start (${reason}).`);
    this.name = "GeminiOptInRequiredError";
  }
}

export class GeminiRouteRevokedError extends Error {
  readonly code = "route_revoked" as const;

  constructor(readonly notice: string) {
    super(notice);
    this.name = "GeminiRouteRevokedError";
  }
}

export class GeminiHomeAccessError extends Error {
  readonly code = "gemini_credentials_path" as const;

  constructor(readonly attemptedPath: string) {
    super("Gemini credential directories are never read or written.");
    this.name = "GeminiHomeAccessError";
  }
}

export class GeminiVersionGateError extends Error {
  readonly code = "cli_min_version" as const;

  constructor(readonly reason: "binary_missing" | "below_minimum" | "missing_acp_flag" | "unparseable") {
    super(`Gemini CLI failed the version gate (${reason}).`);
    this.name = "GeminiVersionGateError";
  }
}

export class AcpRpcError extends Error {
  readonly code = "acp_rpc" as const;

  constructor(
    message: string,
    readonly data: unknown,
  ) {
    super(message);
    this.name = "AcpRpcError";
  }
}
