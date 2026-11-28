import { describe, expect, it } from "vitest";
import { bindBudgetLedger, openProjectStateDb } from "@ef-harness/db";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AtomicBudgetReservationLedger, StopEventStore } from "../../src/budget-stops/index.js";

describe("durable budget stops", () => {
  it("keeps stop events and reservations on ProjectStateDb across a new store", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c50-budget-"));
    const projectId = `c50-budget-${process.pid}`;
    const state = openProjectStateDb({ projectId, rootDir, appVersion: "0.0.0" });
    try {
      const events = new StopEventStore(state);
      const recorded = events.record({
        trigger: "user_stop",
        timestampMs: 10,
        checkpointShas: ["abc"],
        recoveryOption: null,
      });
      expect(events.tableName()).toBe("stop_events");
      const ledger = new AtomicBudgetReservationLedger({
        microUsdLimit: 1_000_000,
        ppmLimit: null,
        state,
      });
      ledger.postHistoricalSpend("micro-usd", 100_000);
      const held = await ledger.reserve({ workerId: "W-1", currency: "micro-usd", ceilingUnits: 50_000 });
      expect(held.ok).toBe(true);
      events.close();
      ledger.close();
      const again = new StopEventStore(state);
      expect(again.list()[0]?.id).toBe(recorded.id);
      const rows = bindBudgetLedger(state).getBudgetRemaining("project", "wind-down");
      expect(rows[0]?.spentUnits).toBe(100_000);
      expect(rows[0]?.reservedUnits).toBe(50_000);
      again.close();
    } finally {
      state.close();
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
