export class SpikeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SpikeError";
    this.code = code;
  }
}

export class ReadinessTimeoutError extends SpikeError {
  readonly service: string;
  readonly logs: string;

  constructor(service: string, logs: string) {
    super(
      "readiness_timeout",
      `${service} was not ready before the deadline. Captured output:\n${logs || "(no output)"}`,
    );
    this.name = "ReadinessTimeoutError";
    this.service = service;
    this.logs = logs;
  }
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
