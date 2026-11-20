export const MCP_ERROR_LEASE_FENCED = "MCP_ERROR_LEASE_FENCED";

export const PULL_QUOTA_MESSAGE =
  "Pull quota reached; call harness.ask_owner if key context is missing";

export const NOT_FOUND = "NotFound";

export class LeaseFencedError extends Error {
  readonly code = MCP_ERROR_LEASE_FENCED;

  constructor() {
    super(MCP_ERROR_LEASE_FENCED);
    this.name = "LeaseFencedError";
  }
}

export function isLeaseFenced(error: unknown): boolean {
  return error instanceof LeaseFencedError || (error instanceof Error && error.message === MCP_ERROR_LEASE_FENCED);
}
