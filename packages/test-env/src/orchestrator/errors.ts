export class ManifestValidationError extends Error {
  readonly code = "manifest_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

export class MissingEnvironmentSecretError extends Error {
  readonly code = "missing_environment_secret" as const;
  readonly secretName: string;

  constructor(secretName: string) {
    super(`missing environment secret ${secretName}`);
    this.name = "MissingEnvironmentSecretError";
    this.secretName = secretName;
  }
}

export class UnresolvedEnvironmentPlaceholderError extends Error {
  readonly code = "unresolved_environment_placeholder" as const;
  readonly placeholder: string;

  constructor(placeholder: string) {
    super(`unresolved environment placeholder {${placeholder}}`);
    this.name = "UnresolvedEnvironmentPlaceholderError";
    this.placeholder = placeholder;
  }
}

export class AppIgnoresPortError extends Error {
  readonly code = "app_ignores_port" as const;
  readonly expectedPort: number;
  readonly observedPort: number;

  constructor(expectedPort: number, observedPort: number) {
    super(`app ignores PORT (bound ${observedPort}, expected ${expectedPort})`);
    this.name = "AppIgnoresPortError";
    this.expectedPort = expectedPort;
    this.observedPort = observedPort;
  }
}

export class ChildExitedBeforeReadyError extends Error {
  readonly code = "child_exited_before_ready" as const;
  readonly exitCode: number | null;
  readonly logs: string;

  constructor(exitCode: number | null, logs: string) {
    super(`child exited before ready (code ${exitCode ?? "null"})\n${logs}`);
    this.name = "ChildExitedBeforeReadyError";
    this.exitCode = exitCode;
    this.logs = logs;
  }
}

export class ReadinessTimeoutError extends Error {
  readonly code = "readiness_timeout" as const;
  readonly logs: string;
  readonly timeoutMs: number;

  constructor(timeoutMs: number, logs: string) {
    super(`readiness probe timed out after ${timeoutMs}ms\n${logs}`);
    this.name = "ReadinessTimeoutError";
    this.timeoutMs = timeoutMs;
    this.logs = logs;
  }
}

export class ReadinessProbeError extends Error {
  readonly code = "readiness_probe_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "ReadinessProbeError";
  }
}

export class EnvironmentAdmissionDeniedError extends Error {
  readonly code = "environment_admission_denied" as const;
  readonly reason: string;

  constructor(reason: string) {
    super(`hardware governor paused a new environment: ${reason}`);
    this.name = "EnvironmentAdmissionDeniedError";
    this.reason = reason;
  }
}

export class PortRangeExhaustedError extends Error {
  readonly code = "port_range_exhausted" as const;

  constructor() {
    super("no free port remains in 41000-48999");
    this.name = "PortRangeExhaustedError";
  }
}

export class EnvironmentDestroyedError extends Error {
  readonly code = "environment_destroyed" as const;

  constructor(environmentId: string) {
    super(`environment ${environmentId} is destroyed`);
    this.name = "EnvironmentDestroyedError";
  }
}

export class EnvironmentStateError extends Error {
  readonly code = "environment_state" as const;

  constructor(message: string) {
    super(message);
    this.name = "EnvironmentStateError";
  }
}

export class UnknownServiceError extends Error {
  readonly code = "unknown_service" as const;
  readonly serviceName: string;

  constructor(serviceName: string) {
    super(`unknown environment service ${serviceName}`);
    this.name = "UnknownServiceError";
    this.serviceName = serviceName;
  }
}
