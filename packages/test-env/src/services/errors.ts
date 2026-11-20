export type StartableService = "postgres" | "redis" | "mailpit";

export class ServiceStartFailedError extends Error {
  override readonly name = "ServiceStartFailedError";
  readonly hint = "Offer Docker fallback" as const;
  readonly holdDependentTaskOnly = true as const;
  readonly failTask = false as const;
  readonly workerQualityPenalty = false as const;
  readonly disposition = "hold" as const;

  constructor(
    readonly service: StartableService,
    readonly logs: string,
  ) {
    super(`${service} failed to start. Offer Docker fallback\n${logs}`);
  }
}

export class UnsupportedPostgresExtensionError extends Error {
  override readonly name = "UnsupportedPostgresExtensionError";
  readonly hint = "Offer Docker fallback" as const;
  readonly holdDependentTaskOnly = true as const;
  readonly workerQualityPenalty = false as const;
  readonly disposition = "hold" as const;

  constructor(readonly extension: string) {
    super(`Requires Docker (Tier D) for extension ${extension}`);
  }
}

export class UnrecordedHttpRequestError extends Error {
  override readonly name = "UnrecordedHttpRequestError";
  readonly code = "UNRECORDED_HTTP_REQUEST" as const;

  constructor(
    readonly method: string,
    readonly url: string,
  ) {
    super(`UnrecordedHttpRequestError(${method}, ${url})`);
  }
}

export class UploadRejectedError extends Error {
  override readonly name = "UploadRejectedError";
  readonly ruleId = "X-08" as const;

  constructor(
    readonly rule: "size" | "type" | "public_path" | "escape",
    message: string,
  ) {
    super(message);
  }
}

export function asStartFailure(service: StartableService, error: unknown): ServiceStartFailedError {
  if (error instanceof ServiceStartFailedError && error.service === service) return error;
  const logs = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new ServiceStartFailedError(service, logs);
}
