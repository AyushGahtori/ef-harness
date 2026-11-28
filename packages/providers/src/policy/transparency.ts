import type { PolicyTransparencyView, ProviderPolicyDocument } from "./types.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function formatPolicyAge(lastCheckedAtMs: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - lastCheckedAtMs);
  const days = Math.floor(elapsed / DAY_MS);
  if (days > 0) return `Policy last checked ${days}d ago`;
  const hours = Math.floor(elapsed / HOUR_MS);
  if (hours > 0) return `Policy last checked ${hours}h ago`;
  return "Policy last checked just now";
}

export function buildTransparency(input: {
  document: ProviderPolicyDocument;
  checkedAtMs: number | null;
  verifiedAtMs: number | null;
  nowMs: number;
}): PolicyTransparencyView {
  const diagnosticLine =
    input.checkedAtMs === null
      ? "Policy has not been checked remotely yet"
      : formatPolicyAge(input.checkedAtMs, input.nowMs);
  return {
    policyVersion: input.document.policyVersion,
    lastVerifiedAt: input.verifiedAtMs === null ? null : new Date(input.verifiedAtMs).toISOString(),
    lastCheckedAt: input.checkedAtMs === null ? null : new Date(input.checkedAtMs).toISOString(),
    diagnosticLine,
    routes: input.document.routes.map((route) => ({
      routeId: route.id,
      complianceStatus: route.status,
    })),
  };
}
