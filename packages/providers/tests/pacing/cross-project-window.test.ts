import { describe, expect, it } from "vitest";
import { AllowancePacingController, harnessCeilingPpm } from "../../src/pacing/index.js";
import { chatGptRegistration, createHarness } from "./harness.js";

const START = Date.UTC(2026, 10, 22, 12, 0, 0);
const CONNECTION = "chatgpt-plus";

describe("pacing cross-project shared window", () => {
  it("keeps one atomic connection_windows row for two projects on the same account", async () => {
    const projectA = createHarness("project-a", START);
    const projectB = new AllowancePacingController({
      projectId: "project-b",
      repo: projectA.repo,
      windDown: projectA.windDown,
      board: projectA.board,
      ledger: projectA.ledger,
      preflight: projectA.preflight,
      weightSink: projectA.weights,
      now: () => projectA.clock.now(),
      random: () => 0,
    });
    await projectA.controller.registerConnection(chatGptRegistration(START, 0.2));
    await projectB.registerConnection(chatGptRegistration(START, 0.2));
    const rowsA = await projectA.controller.windowRows(CONNECTION);
    const rowsB = await projectB.windowRows(CONNECTION);
    expect(rowsA).toEqual(rowsB);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.connection).toBe(CONNECTION);
    expect(rowsA[0]?.windowKind).toBe("5h");
    expect(rowsA[0]?.limitUnits).toBe(1_000_000);

    const ceiling = harnessCeilingPpm(0.2);
    await projectA.repo.withTransaction((tx) => {
      tx.tryAddEstimated(CONNECTION, "5h", 700_000, ceiling);
    });
    const [first, second] = await Promise.all([
      projectA.repo.withTransaction(async (tx) => {
        const before = tx.require(CONNECTION).windows[0]?.usedPpm ?? -1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        const result = tx.tryAddEstimated(CONNECTION, "5h", 100_000, ceiling);
        return { before, ...result };
      }),
      projectA.repo.withTransaction(async (tx) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const before = tx.require(CONNECTION).windows[0]?.usedPpm ?? -1;
        const result = tx.tryAddEstimated(CONNECTION, "5h", 100_000, ceiling);
        return { before, ...result };
      }),
    ]);
    const applied = [first.appliedPpm, second.appliedPpm].sort((left, right) => left - right);
    expect(applied).toEqual([0, 100_000]);
    expect(new Set([first.before, second.before])).toEqual(new Set([700_000, 800_000]));
    const shared = await projectA.controller.telemetry(CONNECTION);
    const sharedToo = await projectB.telemetry(CONNECTION);
    expect(shared.windowUsedPpm).toBe(800_000);
    expect(sharedToo.windowUsedPpm).toBe(800_000);
    expect(shared.cwnd).toBe(sharedToo.cwnd);
  });
});
