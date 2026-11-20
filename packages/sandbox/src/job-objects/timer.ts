export const MAX_SETTIMEOUT_MS = 2_147_483_647;

export function delayFor(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 1) return 1;
  return Math.min(MAX_SETTIMEOUT_MS, Math.ceil(ms));
}
