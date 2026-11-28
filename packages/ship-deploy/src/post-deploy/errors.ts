import type { FailedAsset, SmokeNetworkHop } from "./types.js";

export class StaleDeploymentBuildIdMismatch extends Error {
  readonly code = "StaleDeploymentBuildIdMismatch" as const;
  readonly expectedCommitSha: string;
  readonly actualBuildId: string | null;
  readonly liveUrl: string;
  readonly attempts: number;

  constructor(input: {
    readonly expectedCommitSha: string;
    readonly actualBuildId: string | null;
    readonly liveUrl: string;
    readonly attempts: number;
  }) {
    super(
      `StaleDeploymentBuildIdMismatch: live build id ${input.actualBuildId ?? "(missing)"} does not equal expected ${input.expectedCommitSha} at ${input.liveUrl}`,
    );
    this.name = "StaleDeploymentBuildIdMismatch";
    this.expectedCommitSha = input.expectedCommitSha;
    this.actualBuildId = input.actualBuildId;
    this.liveUrl = input.liveUrl;
    this.attempts = input.attempts;
  }
}

export class DevArtifactLeakError extends Error {
  readonly code = "DevArtifactLeakError" as const;
  readonly kind: "styleguide" | "data-ef-source";

  constructor(kind: "styleguide" | "data-ef-source", detail: string) {
    super(`DevArtifactLeakError: ${detail}`);
    this.name = "DevArtifactLeakError";
    this.kind = kind;
  }
}

export class StackTraceLeakError extends Error {
  readonly code = "StackTraceLeakError" as const;

  constructor(detail: string) {
    super(`StackTraceLeakError: ${detail}`);
    this.name = "StackTraceLeakError";
  }
}

export class TlsCertificateError extends Error {
  readonly code = "TlsCertificateError" as const;

  constructor(detail: string) {
    super(`TlsCertificateError: ${detail}`);
    this.name = "TlsCertificateError";
  }
}

export class HealthCheckTimeoutError extends Error {
  readonly code = "HealthCheckTimeoutError" as const;
  readonly attempts: number;

  constructor(detail: string, attempts: number) {
    super(`HealthCheckTimeoutError: ${detail}`);
    this.name = "HealthCheckTimeoutError";
    this.attempts = attempts;
  }
}

export class MutatingSmokeForbiddenError extends Error {
  readonly code = "MutatingSmokeForbiddenError" as const;

  constructor(detail: string) {
    super(`MutatingSmokeForbiddenError: ${detail}`);
    this.name = "MutatingSmokeForbiddenError";
  }
}

export interface SmokeFailure {
  readonly code:
    | "http-status"
    | "console-error"
    | "failed-asset"
    | "broken-image"
    | "missing-title"
    | "missing-shell"
    | "protected-route-unlocked"
    | "dev-artifact";
  readonly detail: string;
}

export class SmokeCheckFailedError extends Error {
  readonly code = "SmokeCheckFailedError" as const;
  readonly failures: readonly SmokeFailure[];
  readonly consoleErrors: readonly string[];
  readonly failedAssets: readonly FailedAsset[];
  readonly brokenImages: readonly string[];
  readonly network: readonly SmokeNetworkHop[];
  readonly screenshotSha256: string;
  readonly redactedExcerpt: string;

  constructor(input: {
    readonly failures: readonly SmokeFailure[];
    readonly consoleErrors: readonly string[];
    readonly failedAssets: readonly FailedAsset[];
    readonly brokenImages: readonly string[];
    readonly network: readonly SmokeNetworkHop[];
    readonly screenshotSha256: string;
    readonly redactedExcerpt: string;
  }) {
    super(`SmokeCheckFailedError: ${input.failures.map((failure) => failure.detail).join("; ")}`);
    this.name = "SmokeCheckFailedError";
    this.failures = input.failures;
    this.consoleErrors = input.consoleErrors;
    this.failedAssets = input.failedAssets;
    this.brokenImages = input.brokenImages;
    this.network = input.network;
    this.screenshotSha256 = input.screenshotSha256;
    this.redactedExcerpt = input.redactedExcerpt;
  }
}

export class ProtectedRouteUnlockedError extends Error {
  readonly code = "ProtectedRouteUnlockedError" as const;

  constructor(detail: string) {
    super(`ProtectedRouteUnlockedError: ${detail}`);
    this.name = "ProtectedRouteUnlockedError";
  }
}
