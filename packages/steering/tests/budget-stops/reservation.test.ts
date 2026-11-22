import { describe, expect, it } from "vitest";

import { createHarness, queuedTask } from "./helpers.js";

describe("atomic budget reservation ceiling", () => {
  it("grants only two of four parallel $0.50 reservations when $1.10 remains", async () => {
    const { ledger, controller } = createHarness();
    ledger.postHistoricalSpend("micro-usd", 8_900_000);
    const ids = ["W-1", "W-2", "W-3", "W-4"];
    for (const id of ids) controller.enqueue(queuedTask(id, { ceilingUnits: 500_000 }));
    const results = await Promise.all(ids.map((id) => controller.tryClaim(id)));
    const granted = results.filter((result) => result.claimed);
    const denied = results.filter((result) => !result.claimed);
    expect(granted).toHaveLength(2);
    expect(denied).toHaveLength(2);
    expect(denied.every((result) => result.windDown && result.reason === "wind_down")).toBe(true);
    expect(ledger.heldCount()).toBe(2);
    const committed = ledger.snapshot("micro-usd")?.committed ?? 0;
    expect(committed).toBe(9_900_000);
    expect(committed).toBeLessThanOrEqual(10_000_000);
    expect(controller.observe().step).toBe("wind_down_90");
    for (const result of granted) {
      if (!result.reservationId) throw new Error("granted reservation is missing an id");
      ledger.settle(result.reservationId, 500_000);
    }
    const spent = ledger.snapshot("micro-usd")?.spent ?? 0;
    expect(spent).toBe(9_900_000);
    expect(spent).toBeLessThanOrEqual(10_000_000);
    expect(8_900_000 + 4 * 500_000).toBe(10_900_000);
    controller.enqueue(queuedTask("W-5", { ceilingUnits: 500_000 }));
    expect(await controller.tryClaim("W-5")).toMatchObject({ claimed: false, reason: "wind_down" });
    expect(ledger.heldCount()).toBe(0);
  });
});
