export class SandboxUnavailableError extends Error {
  override readonly name = "SandboxUnavailableError";
  readonly code = "SANDBOX_UNAVAILABLE";
  readonly tier = "A" as const;

  constructor(readonly reason: string) {
    super(`Sandbox tier A is unavailable: ${reason}`);
  }
}

export class MxcPolicyPathError extends Error {
  override readonly name = "MxcPolicyPathError";

  constructor(
    readonly code: string,
    readonly path: string,
  ) {
    super(`MXC policy rejected path (${code}): ${path}`);
  }
}

export class MxcModeError extends Error {
  override readonly name = "MxcModeError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class MxcForegroundExitError extends Error {
  override readonly name = "MxcForegroundExitError";
  readonly code = "background_requires_environment_orchestrator" as const;

  constructor() {
    super(
      "Detached MXC commands do not survive foreground exit; start them on the Task 049 environment orchestrator",
    );
  }
}

export class MxcCommandTimeoutError extends Error {
  override readonly name = "MxcCommandTimeoutError";
  readonly reason = "timeout" as const;

  constructor(readonly timeoutMs: number) {
    super(`MXC command exceeded ${timeoutMs}ms`);
  }
}

export class MxcPoolError extends Error {
  override readonly name = "MxcPoolError";
  readonly code = "warm_pool_exhausted" as const;

  constructor(readonly poolSize: number) {
    super(`Tier A warm pool has no idle instance (${poolSize} in use)`);
  }
}
