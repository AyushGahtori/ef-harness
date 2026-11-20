import { emptyTokenUsage, type TokenUsage } from "./usage.js";

export const NORMALIZED_ERROR_KINDS = [
  "auth",
  "rate_limit",
  "usage_limit",
  "billing",
  "overloaded",
  "context_overflow",
  "stream_stall",
  "unknown_timeout",
  "malformed_request",
  "unknown",
] as const;

export type NormalizedErrorKind = (typeof NORMALIZED_ERROR_KINDS)[number];

export interface NormalizedModelErrorInit {
  readonly kind: NormalizedErrorKind;
  readonly message: string;
  readonly httpStatus?: number | null;
  readonly providerCode?: string | null;
  readonly retryAfterMs?: number | null;
  readonly rateLimitResetMs?: number | null;
  readonly isProviderSchedulingError?: boolean;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly partialUsage?: TokenUsage | null;
}

export class NormalizedModelError extends Error {
  readonly kind: NormalizedErrorKind;
  readonly httpStatus: number | null;
  readonly providerCode: string | null;
  readonly retryAfterMs: number | null;
  readonly rateLimitResetMs: number | null;
  readonly isProviderSchedulingError: boolean;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly partialUsage: TokenUsage | null;

  constructor(init: NormalizedModelErrorInit) {
    super(init.message);
    this.name = "NormalizedModelError";
    this.kind = init.kind;
    this.httpStatus = init.httpStatus ?? null;
    this.providerCode = init.providerCode ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.rateLimitResetMs = init.rateLimitResetMs ?? null;
    this.isProviderSchedulingError = init.isProviderSchedulingError ?? false;
    this.clientRequestId = init.clientRequestId;
    this.idempotencyKey = init.idempotencyKey;
    this.partialUsage = init.partialUsage ?? null;
  }
}

export class StreamStallError extends NormalizedModelError {
  constructor(partialUsage: TokenUsage, clientRequestId: string, idempotencyKey: string) {
    super({
      kind: "stream_stall",
      message: "No tokens for 60s",
      isProviderSchedulingError: false,
      clientRequestId,
      idempotencyKey,
      partialUsage,
    });
    this.name = "StreamStallError";
  }
}

export class UnknownOutcomeTimeoutError extends NormalizedModelError {
  constructor(
    clientRequestId: string,
    idempotencyKey: string,
    partialUsage: TokenUsage | null = null,
  ) {
    super({
      kind: "unknown_timeout",
      message:
        "Timeout after the request body was transmitted; hold the reservation for reconciliation",
      isProviderSchedulingError: false,
      clientRequestId,
      idempotencyKey,
      partialUsage: partialUsage ?? emptyTokenUsage(),
    });
    this.name = "UnknownOutcomeTimeoutError";
  }
}

export class SiwcConstraintError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`Sign in with ChatGPT request violates preview constraints: ${violations.join(", ")}`);
    this.name = "SiwcConstraintError";
    this.violations = violations;
  }
}

export class SiwcHostedToolError extends Error {
  readonly toolNames: readonly string[];

  constructor(toolNames: readonly string[]) {
    super(`Sign in with ChatGPT rejects hosted tools: ${toolNames.join(", ")}`);
    this.name = "SiwcHostedToolError";
    this.toolNames = toolNames;
  }
}
