import { describe, expect, it } from "vitest";

import {
  CrewPresetProfileEngine,
  DynamicScheduleRebalancer,
  HeftCriticalPathScheduler,
  InMemoryTaskClaimManager,
  LocalExpectedCostLevelSelector,
  WAITING_FOR_RESET_REASON,
  createScheduleState,
} from "../../src/scheduler/index.js";
import type { InFlightTurnInit, ProviderConnection, ScheduleTask } from "../../src/scheduler/index.js";
import { independent, task } from "./fixtures.js";

function connection(partial: Partial<ProviderConnection> & Pick<ProviderConnection, "id" | "kind">): ProviderConnection {
  return {
    throttled: false,
    allowanceExhausted: false,
    authorized: true,
    pacingSlots: 2,
    ...partial,
  };
}

function turn(taskId: string, level: InFlightTurnInit["level"] = "principal"): InFlightTurnInit {
  return {
    taskId,
    featureId: taskId,
    featureSlug: taskId,
    attemptId: `attempt:${taskId}:old`,
    connectionId: "sub",
    level,
    presetAtClaim: "Fastest",
    startedAtMs: 0,
    execTimeMs: 60_000,
    writeScope: [`src/${taskId}/**`],
    waveIndex: 1,
  };
}

describe("crew presets", () => {
  const engine = new CrewPresetProfileEngine();
  const scheduler = new HeftCriticalPathScheduler();

  it("gives the three presets distinct valid schedules", () => {
    const graph = independent(["a", "b", "c", "d", "e", "f"], 10 * 60_000);
    const schedules = (["Fastest", "Balanced", "Cheapest"] as const).map((preset) =>
      scheduler.schedule(
        createScheduleState({
          graph,
          preset,
          hardwarePoolCap: 8,
          worktreeSlotCap: 8,
        }),
      ),
    );
    const [fastest, balanced, cheapest] = schedules;
    expect(fastest?.parallelism.wEff).toBe(6);
    expect(balanced?.parallelism.wEff).toBe(5);
    expect(cheapest?.parallelism.wEff).toBe(3);
    expect(fastest?.projection.peakWorkers).toBe(6);
    expect(balanced?.projection.peakWorkers).toBe(5);
    expect(cheapest?.projection.peakWorkers).toBe(3);
    expect(fastest?.projection.parallelMinutes).toBeLessThan(balanced?.projection.parallelMinutes ?? 0);
    expect(fastest?.levels.every((row) => row.level === "Principal")).toBe(true);
    expect(balanced?.levels.every((row) => row.level === "Senior")).toBe(true);
    expect(cheapest?.levels.every((row) => row.level === "Junior")).toBe(true);
    expect(fastest?.levels.every((row) => row.modelId === "claude-opus-4-6")).toBe(true);
    expect(balanced?.levels.every((row) => row.modelId === "claude-sonnet-4-6")).toBe(true);
    expect(cheapest?.levels.every((row) => row.modelId === "claude-haiku-4-5")).toBe(true);
    expect(fastest?.prewarmNextWave?.reason).toBe("fastest-preset-jit");
    expect(fastest?.prewarmNextWave?.waveIndex).toBe(2);
    expect(balanced?.prewarmNextWave).toBeNull();
    expect(cheapest?.prewarmNextWave).toBeNull();
    const cost = (levels: { expectedCostMicroUsd: number }[] | undefined) =>
      (levels ?? []).reduce((sum, row) => sum + row.expectedCostMicroUsd, 0);
    expect(cost(cheapest?.levels)).toBeLessThan(cost(balanced?.levels));
    expect(cost(balanced?.levels)).toBeLessThan(cost(fastest?.levels));
  });

  it("keeps auth on the senior floor and escalates on hint 2", () => {
    const auth = task({
      id: "T-Auth",
      featureId: "auth",
      featureSlug: "auth",
      difficulty: "critical",
      riskTags: ["auth"],
      avgExecTimeMs: 60_000,
      successors: [],
    });
    const leaf = task({
      id: "T-Leaf",
      featureId: "leaf",
      featureSlug: "leaf",
      difficulty: "standard",
      avgExecTimeMs: 10_000,
      successors: [],
    });
    const selector = new LocalExpectedCostLevelSelector();
    expect(engine.assignLevel(auth, true, "Cheapest").level).toBe("Senior");
    expect(selector.selectLevel({ task: leaf, preset: "Cheapest", onCriticalPath: false, hintStep: 2 }).level).toBe(
      "Mid",
    );
    expect(engine.assignLevel(leaf, true, "Fastest").level).toBe("Principal");
    expect(engine.assignLevel(leaf, true, "Balanced").level).toBe("Senior");
    const complex = task({
      id: "T-Hard",
      featureId: "hard",
      featureSlug: "hard",
      difficulty: "complex",
      avgExecTimeMs: 10_000,
      successors: [],
    });
    const complexBalancedCp = engine.assignLevel(complex, true, "Balanced");
    const complexCheapest = engine.assignLevel(complex, false, "Cheapest");
    expect(complexBalancedCp.level).toBe("Senior");
    expect(complexBalancedCp.modelId).toBe("claude-sonnet-4-6");
    expect(complexCheapest.level).toBe("Mid");
    expect(complexCheapest.modelId).toBe("gpt-4.1-mini");
  });

  it("prefers an unthrottled subscription and parks instead of a silent paid fallback", () => {
    const graph = independent(["a"], 60_000);
    const rebalancer = new DynamicScheduleRebalancer();
    const routed = rebalancer.rebalance(
      createScheduleState({
        graph,
        preset: "Cheapest",
        hardwarePoolCap: 4,
        worktreeSlotCap: 4,
        connections: [
          connection({ id: "sub-throttled", kind: "subscription", throttled: true }),
          connection({ id: "sub-open", kind: "subscription" }),
          connection({ id: "paid", kind: "paid_api", pacingSlots: 4 }),
        ],
        paidFallbackApproved: true,
      }),
      { type: "provider_pacing", nowMs: 0, connections: [
        connection({ id: "sub-throttled", kind: "subscription", throttled: true }),
        connection({ id: "sub-open", kind: "subscription" }),
        connection({ id: "paid", kind: "paid_api", pacingSlots: 4 }),
      ] },
    );
    expect(routed.admissions.map((row) => row.connectionId)).toEqual(["sub-open"]);

    const parked = rebalancer.rebalance(
      createScheduleState({
        graph,
        preset: "Cheapest",
        hardwarePoolCap: 4,
        worktreeSlotCap: 4,
        paidFallbackApproved: false,
      }),
      {
        type: "provider_pacing",
        nowMs: 0,
        connections: [
          connection({ id: "sub-a", kind: "subscription", allowanceExhausted: true }),
          connection({ id: "sub-b", kind: "subscription", allowanceExhausted: true }),
          connection({ id: "paid", kind: "paid_api" }),
        ],
      },
    );
    expect(parked.admissions).toEqual([]);
    expect(parked.state.parkedReason).toBe(WAITING_FOR_RESET_REASON);
    expect(parked.abortedTaskIds).toEqual([]);
  });
});

describe("DynamicScheduleRebalancer", () => {
  const rebalancer = new DynamicScheduleRebalancer();

  it("fills the slot left by a held critical task without aborting the turn", () => {
    const tasks: ScheduleTask[] = [
      task({ id: "T-Auth", featureId: "auth", featureSlug: "auth", avgExecTimeMs: 50_000, writeScope: ["src/auth/**"] }),
      task({ id: "T-Ui", featureId: "ui", featureSlug: "ui", avgExecTimeMs: 10_000, writeScope: ["src/ui/**"] }),
      task({ id: "T-Data", featureId: "data", featureSlug: "data", avgExecTimeMs: 10_000, writeScope: ["src/data/**"] }),
      task({ id: "T-Copy", featureId: "copy", featureSlug: "copy", avgExecTimeMs: 10_000, writeScope: ["src/copy/**"] }),
    ];
    const result = rebalancer.rebalance(
      createScheduleState({
        graph: { tasks },
        preset: "Fastest",
        hardwarePoolCap: 4,
        worktreeSlotCap: 4,
        inFlight: [turn("T-Auth")],
      }),
      { type: "task_hold", taskId: "T-Auth", reason: "user_pause", source: "msg-1", nowMs: 5 },
    );
    expect(result.yieldedToHold).toEqual(["T-Auth"]);
    expect(result.abortedTaskIds).toEqual([]);
    expect(result.admissions.map((row) => row.taskId).sort()).toEqual(["T-Copy", "T-Data", "T-Ui"]);
    expect(result.state.inFlight.map((row) => row.taskId)).not.toContain("T-Auth");
    expect(result.admissions.every((row) => row.featureBranch.startsWith("harness/f/"))).toBe(true);
  });

  it("drops to one slot on Orange without killing in-flight work and prefers the critical path", () => {
    const graph = {
      tasks: [
        task({ id: "T-Long", featureId: "long", featureSlug: "long", avgExecTimeMs: 100_000 }),
        task({ id: "T-Short", featureId: "short", featureSlug: "short", avgExecTimeMs: 10_000 }),
      ],
    };
    const orange = rebalancer.rebalance(
      createScheduleState({ graph, preset: "Fastest", hardwarePoolCap: 8, worktreeSlotCap: 8 }),
      { type: "governor", pressure: "Orange", nowMs: 0 },
    );
    expect(orange.parallelism.wEff).toBe(1);
    expect(orange.admissions.map((row) => row.taskId)).toEqual(["T-Long"]);
    expect(orange.abortedTaskIds).toEqual([]);

    const busy = rebalancer.rebalance(
      createScheduleState({
        graph: independent(["a", "b", "c", "d"], 60_000),
        preset: "Fastest",
        hardwarePoolCap: 8,
        worktreeSlotCap: 8,
        inFlight: ["a", "b", "c", "d"].map((id) => turn(id)),
      }),
      { type: "governor", pressure: "Orange", nowMs: 1 },
    );
    expect(busy.admissions).toEqual([]);
    expect(busy.state.inFlight.map((row) => row.taskId)).toEqual(["a", "b", "c", "d"]);
    expect(busy.abortedTaskIds).toEqual([]);
  });

  it("recomputes the critical path and escalates the model when a short branch retries", () => {
    const graph = {
      tasks: [
        task({ id: "T-A", featureId: "a", featureSlug: "a", avgExecTimeMs: 100_000 }),
        task({ id: "T-C", featureId: "c", featureSlug: "c", avgExecTimeMs: 5_000, difficulty: "standard" }),
      ],
    };
    const result = rebalancer.rebalance(
      createScheduleState({ graph, preset: "Balanced", hardwarePoolCap: 1, worktreeSlotCap: 4 }),
      { type: "retry_escalation", taskId: "T-C", hintStep: 2, execTimeMs: 500_000, nowMs: 0 },
    );
    expect(result.ranks.rankUMs.get("T-C")).toBeGreaterThan(result.ranks.rankUMs.get("T-A") ?? 0);
    expect(result.ranks.onCriticalPath.has("T-C")).toBe(true);
    expect(result.admissions[0]?.taskId).toBe("T-C");
    expect(result.admissions[0]?.level).toBe("Principal");
    expect(result.admissions[0]?.modelId).toBe("claude-opus-4-6");
  });

  it("switches Fastest to Cheapest for the next claim and leaves running turns alone", () => {
    const waiting = task({ id: "wait", featureId: "wait", featureSlug: "wait", avgExecTimeMs: 60_000 });
    const running = ["a", "b", "c", "d"].map((id) =>
      task({ id, featureId: id, featureSlug: id, avgExecTimeMs: 60_000 }),
    );
    let state = createScheduleState({
      graph: { tasks: [...running, waiting] },
      preset: "Fastest",
      hardwarePoolCap: 8,
      worktreeSlotCap: 8,
      inFlight: running.map((item) => turn(item.id)),
    });
    const switched = rebalancer.rebalance(state, { type: "preset_switch", preset: "Cheapest", nowMs: 1 });
    expect(switched.abortedTaskIds).toEqual([]);
    expect(switched.admissions).toEqual([]);
    expect(switched.state.preset).toBe("Cheapest");
    expect(switched.state.inFlight.every((row) => row.presetAtClaim === "Fastest" && row.level === "Principal")).toBe(
      true,
    );
    state = switched.state;
    state = rebalancer.rebalance(state, { type: "task_completed", taskId: "a", nowMs: 2 }).state;
    const next = rebalancer.rebalance(state, { type: "task_completed", taskId: "b", nowMs: 3 });
    expect(next.admissions.map((row) => row.taskId)).toEqual(["wait"]);
    expect(next.admissions[0]?.level).toBe("Junior");
    expect(next.admissions[0]?.modelId).toBe("claude-haiku-4-5");
    expect(next.admissions[0]?.preset).toBe("Cheapest");
    expect(next.state.inFlight.filter((row) => row.taskId !== "wait").every((row) => row.level === "Principal")).toBe(
      true,
    );
  });

  it("asks the claim port before admitting and honors a sweep overlap refusal", () => {
    const graph = independent(["a", "b"], 60_000);
    const claims = new InMemoryTaskClaimManager({
      held: new Set(),
      completed: new Set(),
      predecessors: new Map(),
      leases: [{ id: "sweep", holder: "S", mode: "intent", prefixes: ["src/a/"] }],
      scopes: new Map([
        ["a", ["src/a/**"]],
        ["b", ["src/b/**"]],
      ]),
    });
    const guarded = new DynamicScheduleRebalancer({ claims });
    const result = guarded.rebalance(
      createScheduleState({
        graph,
        preset: "Fastest",
        hardwarePoolCap: 4,
        worktreeSlotCap: 4,
        pathLeases: [{ id: "sweep", holder: "S", mode: "intent", prefixes: ["src/a/"] }],
      }),
      { type: "governor", pressure: "Green", nowMs: 0 },
    );
    expect(result.admissions.map((row) => row.taskId)).toEqual(["b"]);
  });
});
