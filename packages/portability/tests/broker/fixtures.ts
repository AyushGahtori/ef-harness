import type { PacingCwndPort } from "../../src/broker/types.js";
import { InMemoryGlobalGrantStore } from "../../src/broker/in-memory-global-grant-store.js";
import { GlobalMultiProjectBroker } from "../../src/broker/global-multi-project-broker.js";

export class FakePacingCwnd implements PacingCwndPort {
  private readonly byConnection = new Map<string, number>();

  set(connectionId: string, cwnd: number): void {
    this.byConnection.set(connectionId, cwnd);
  }

  getCwnd(connectionId: string): number {
    return this.byConnection.get(connectionId) ?? 2;
  }
}

export function buildThreeProjectBroker(opts?: {
  poolUsd?: number;
  poolPpm?: number;
  pool2?: number;
  heavy?: number;
}) {
  const store = new InMemoryGlobalGrantStore();
  store.seedPool("openrouter-key-1", "micro_usd", opts?.poolUsd ?? 2_500_000);
  store.seedPool("chatgpt-personal", "ppm", opts?.poolPpm ?? 1_000_000);
  const pacing = new FakePacingCwnd();
  pacing.set("chatgpt-personal", 4);
  pacing.set("openrouter-key-1", 2);
  const broker = new GlobalMultiProjectBroker(store, pacing, {
    pool2WarmSlots: opts?.pool2 ?? 2,
    heavyLanePermits: opts?.heavy ?? 1,
    sessionProcessCap: 4,
  });
  broker.registerProject("proj-a", "background");
  broker.registerProject("proj-b", "background");
  broker.registerProject("proj-c", "batch");
  broker.registerConnectionLabel(
    "chatgpt-personal",
    "Shared ChatGPT Plus: Project A 3 slots · Project B 1 interactive slot",
  );
  return { broker, store, pacing };
}