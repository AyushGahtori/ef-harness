export class SandboxUnavailableError extends Error {
  /**
   * @param {string} tier
   * @param {string} reason
   * @param {unknown} [details]
   */
  constructor(tier, reason, details = null) {
    super(`Sandbox tier ${tier} is unavailable: ${reason}`);
    this.name = "SandboxUnavailableError";
    this.code = "SANDBOX_UNAVAILABLE";
    this.tier = tier;
    this.reason = reason;
    this.details = details ?? null;
  }
}

/**
 * @param {unknown} error
 * @returns {error is SandboxUnavailableError}
 */
export function isSandboxUnavailable(error) {
  return error instanceof SandboxUnavailableError || (error instanceof Error && error.name === "SandboxUnavailableError");
}
