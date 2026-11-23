import { describe, expect, it } from "vitest";

import {
  CrossProjectGrantLeaseManager,
  GRANT_TTL_MS,
  InMemoryGlobalGrantStore,
  InsufficientGrantPoolError,
} from "../../src/broker/index.js";

describe("CrossProjectGrantLeaseManager", () => {
  it("never over-allocates a shared $2.50 OpenRouter balance across concurrent projects", () => {
    const store = new InMemoryGlobalGrantStore();
    store.seedPool("openrouter-key-1", "micro_usd", 2_500_000);
    const manager = new CrossProjectGrantLeaseManager(store);
    const r1 = manager.requestGrant({
      grantId: "g-a",
      projectId: "proj-a",
      connectionId: "openrouter-key-1",
      currency: "micro_usd",
      requestedAmount: 2_000_000,
      nowMs: 1_000,
    });
    expect(r1.grantedAmount).toBe(2_000_000);
    expect(r1.partial).toBe(false);
    const r2 = manager.requestGrant({
      grantId: "g-b",
      projectId: "proj-b",
      connectionId: "openrouter-key-1",
      currency: "micro_usd",
      requestedAmount: 2_000_000,
      nowMs: 1_001,
    });
    expect(r2.grantedAmount).toBe(500_000);
    expect(r2.partial).toBe(true);
    expect(manager.totalCommitted("openrouter-key-1", "micro_usd")).toBe(2_500_000);
  });

  it("reclaims unspent ppm after 10-minute expiry", () => {
    const store = new InMemoryGlobalGrantStore();
    store.seedPool("chatgpt-personal", "ppm", 1_000_000);
    const manager = new CrossProjectGrantLeaseManager(store);
    manager.requestGrant({
      grantId: "g-ppm",
      projectId: "proj-a",
      connectionId: "chatgpt-personal",
      currency: "ppm",
      requestedAmount: 100_000,
      nowMs: 0,
    });
    const row = store.getGrant("g-ppm");
    expect(row).toBeDefined();
    row!.consumedAmount = 20_000;
    store.updateGrant(row!);
    const reclaimed = manager.reclaimExpiredGrants(GRANT_TTL_MS + 1);
    expect(reclaimed).toBe(80_000);
    expect(store.getPoolRemaining("chatgpt-personal", "ppm")).toBe(980_000);
  });

  it("throws when the shared pool is empty", () => {
    const store = new InMemoryGlobalGrantStore();
    const manager = new CrossProjectGrantLeaseManager(store);
    expect(() =>
      manager.requestGrant({
        grantId: "g-x",
        projectId: "proj-a",
        connectionId: "openrouter-key-1",
        currency: "micro_usd",
        requestedAmount: 1,
        nowMs: 0,
      }),
    ).toThrow(InsufficientGrantPoolError);
  });
});