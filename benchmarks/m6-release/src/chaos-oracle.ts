import type { ChaosTrace } from "./types.ts";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function chaosViolations(seed: number, steps: number, violate: boolean): number {
  const rng = mulberry32(seed);
  const tasks = ["t0", "t1", "t2", "t3"];
  let owner = new Map<string, string>();
  let lease = new Map<string, string>();
  let outbox: string[] = [];
  let violations = 0;
  for (let step = 0; step < steps; step += 1) {
    const pendingOwner = new Map(owner);
    const pendingLease = new Map(lease);
    const pendingOutbox = [...outbox];
    const task = tasks[Math.floor(rng() * tasks.length)] ?? "t0";
    const worker = `w${Math.floor(rng() * 3)}`;
    if (!pendingOwner.has(task)) {
      pendingOwner.set(task, worker);
      pendingLease.set(task, worker);
      pendingOutbox.push(`${seed}:${step}:${task}`);
    }
    if (violate && step === 0) {
      pendingLease.set(task, `${worker}-extra`);
    }
    const crash = rng() < 0.2;
    if (!crash) {
      owner = pendingOwner;
      lease = pendingLease;
      outbox = pendingOutbox;
    }
    if (lease.size !== owner.size) violations += 1;
    for (const [taskId, holder] of owner) {
      if (lease.get(taskId) !== holder) violations += 1;
    }
    if (new Set(outbox).size !== outbox.length) violations += 1;
  }
  return violations;
}

export function certifyChaos(seeds: number, inject: readonly string[]): ChaosTrace {
  let violations = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    violations += chaosViolations(seed, 24, false);
  }
  if (inject.includes("chaos-violation")) {
    violations += chaosViolations(1, 1, true);
  }
  return {
    seeds,
    violations,
    implementation: "local-port-oracle",
    integratedDaemon: false,
  };
}
