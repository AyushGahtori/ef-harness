export class UnredactedIpcPayloadError extends Error {
  readonly code = "UNREDACTED_IPC_PAYLOAD";

  constructor(channel: string) {
    super(`Refusing ${channel}: daemon payload was not pre-redacted`);
    this.name = "UnredactedIpcPayloadError";
  }
}

export class RangeLimitError extends Error {
  readonly code = "RANGE_LIMIT";

  constructor(message: string) {
    super(message);
    this.name = "RangeLimitError";
  }
}

export class InspectorMemoryCeilingError extends Error {
  readonly code = "INSPECTOR_MEMORY_CEILING";

  constructor(bytes: number, ceiling: number) {
    super(`Inspector retained ${bytes} bytes, above the ${ceiling} byte ceiling`);
    this.name = "InspectorMemoryCeilingError";
  }
}

export class PinnedBriefMismatchError extends Error {
  readonly code = "PINNED_BRIEF_MISMATCH";

  constructor(expected: string, actual: string) {
    super(`Pinned brief hash ${actual} did not match attempt pin ${expected}`);
    this.name = "PinnedBriefMismatchError";
  }
}

export function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
