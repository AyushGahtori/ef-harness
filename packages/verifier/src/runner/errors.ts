import type { VerificationOutcome } from "./types.js";

/** Protected runner, command, config, expectation, or checkout bytes do not match dispatch. */
export class VerifierIntegrityError extends Error {
  readonly code = "verifier_integrity" as const;

  constructor(
    message: string,
    readonly field: "runner" | "command" | "config" | "expectations" | "checkout",
  ) {
    super(message);
    this.name = "VerifierIntegrityError";
  }
}

/**
 * Exit 0 (or any exit) collected none of the required check ids, or a required id is missing.
 * `missingIds` is the first constructor argument: `MissingRequiredChecksError(missingIds)`.
 */
export class MissingRequiredChecksError extends Error {
  readonly code = "missing_required_checks" as const;

  constructor(
    readonly missingIds: readonly string[],
    readonly outcome: VerificationOutcome,
  ) {
    super(`MissingRequiredChecksError(${missingIds.join(",")})`);
    this.name = "MissingRequiredChecksError";
  }
}

/** The verifier slot resolved to the worker's dirty attempt worktree. */
export class CleanCheckoutSeparationError extends Error {
  readonly code = "clean_checkout_separation" as const;

  constructor(message: string) {
    super(message);
    this.name = "CleanCheckoutSeparationError";
  }
}
