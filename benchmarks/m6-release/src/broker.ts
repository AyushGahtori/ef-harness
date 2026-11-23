import type { BrokerTrace } from "./types.ts";

const WEIGHTS = {
  interactive: 8,
  foreground: 4,
  background: 2,
  batch: 1,
} as const;

export type BrokerClass = keyof typeof WEIGHTS;

export function allocateWeighted(
  requests: readonly { readonly id: string; readonly weight: number }[],
  slots: number,
): Record<string, number> {
  const total = requests.reduce((sum, request) => sum + request.weight, 0);
  const raw = requests.map((request) => {
    const exact = total === 0 ? 0 : (slots * request.weight) / total;
    return { id: request.id, floor: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let used = raw.reduce((sum, request) => sum + request.floor, 0);
  const byRemainder = [...raw].sort((left, right) =>
    right.fraction === left.fraction ? (left.id < right.id ? -1 : 1) : right.fraction - left.fraction,
  );
  const extra = new Set<string>();
  for (const request of byRemainder) {
    if (used >= slots) break;
    extra.add(request.id);
    used += 1;
  }
  const shares: Record<string, number> = {};
  for (const request of raw) {
    shares[request.id] = request.floor + (extra.has(request.id) ? 1 : 0);
  }
  return shares;
}

export function reserveInteractiveSlot(backgroundQueued: number, interactiveQueued: number, cwnd: number): boolean {
  if (interactiveQueued < 1 || cwnd < 2) return false;
  const backgroundServed = Math.max(0, cwnd - 1);
  return backgroundServed < backgroundQueued && interactiveQueued > 0;
}

export function certifyBroker(): BrokerTrace {
  const projects = [
    { id: "interactive", weight: WEIGHTS.interactive },
    { id: "foreground", weight: WEIGHTS.foreground },
    { id: "background", weight: WEIGHTS.background },
  ] as const;
  const shares = allocateWeighted(projects, 14);
  const starved = Object.values(shares).some((share) => share <= 0);
  return {
    projects: projects.map((project) => project.id),
    shares,
    starved,
    reservedInteractiveSlot: reserveInteractiveSlot(10, 1, 2),
  };
}
