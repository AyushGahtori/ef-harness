import { describe, expect, it } from "vitest";
import {
  SandboxTierSelector,
  TIER_C_CAPABILITIES,
  TIER_INSUFFICIENT_OFFERS,
  TaskHeldError,
  TierCHonestyError,
  WrappedModeForbiddenOnTierCError,
} from "../../src/tier-c-d-selector/index.js";
import type {
  CommandSpec,
  RuntimeDispatch,
  SandboxTierId,
  SandboxTierProvider,
  TaskSandboxSpec,
  TierCapabilityFlags,
} from "../../src/tier-c-d-selector/index.js";

const command: CommandSpec = { commandId: "cmd-1", executable: "pnpm", args: ["test"] };

function task(commands: TaskSandboxSpec["commands"], projectPath = "C:\\src\\app"): TaskSandboxSpec {
  return {
    taskId: "task-1",
    attemptId: "attempt-1",
    projectId: "project-1",
    projectPath,
    worktreePath: "C:\\src\\wt",
    tempPath: "C:\\src\\tmp",
    commands,
  };
}

function provider(
  tier: SandboxTierId,
  available: boolean,
  calls: string[],
  capabilities?: TierCapabilityFlags,
): SandboxTierProvider & { reconcileManagedContainers?: () => Promise<{ removed: string[] }> } {
  const caps: TierCapabilityFlags =
    capabilities ??
    (tier === "C"
      ? TIER_C_CAPABILITIES
      : {
          fileWritesEnforced: true,
          secretReadsDenied: true,
          networkEnforced: true,
          requiresAdmin: tier === "B",
        });
  return {
    tier,
    capabilities: caps,
    probe: () => {
      const result = { tier, available, requiresAdmin: tier === "B", capabilities: caps };
      return Promise.resolve(available ? result : { ...result, reason: "unavailable" });
    },
    acquireWarmInstance: (spec) => Promise.resolve({ id: spec.attemptId, tier }),
    executeCommand: () => {
      calls.push(`exec:${tier}`);
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    },
    spawnWrappedProcess: () => {
      calls.push(`wrap:${tier}`);
      return Promise.resolve({ pid: 4, tier });
    },
    disposeInstance: () => Promise.resolve(),
    reconcileManagedContainers: () => {
      calls.push("reconcile");
      return Promise.resolve({ removed: [] });
    },
  };
}

function selector(
  present: Partial<Record<SandboxTierId, boolean>>,
  calls: string[] = [],
  settings: { runUnsandboxed: boolean; pinTierDForLinuxParity: boolean } = {
    runUnsandboxed: false,
    pinTierDForLinuxParity: false,
  },
  pathClassifier?: (target: string) => "local" | "unc" | "network",
) {
  const providers = {
    ...(present.A !== undefined ? { tierA: provider("A", present.A, calls) } : {}),
    ...(present.B !== undefined ? { tierB: provider("B", present.B, calls) } : {}),
    ...(present.D !== undefined ? { tierD: provider("D", present.D, calls) } : {}),
    ...(present.C !== undefined ? { tierC: provider("C", present.C, calls) } : {}),
  };
  return new SandboxTierSelector({
    providers,
    settings,
    ...(pathClassifier ? { pathClassifier: (target) => pathClassifier(target) } : {}),
    now: () => "2026-11-20T00:00:00.000Z",
  });
}

const own: RuntimeDispatch = { kind: "own_loop", runtimeId: "native_worker" };

describe("SandboxTierSelector", () => {
  it("selects the strongest tier in A, B, D, C order", async () => {
    const calls: string[] = [];
    const all = selector({ A: true, B: true, D: true, C: true }, calls);
    await expect(all.resolve({ task: task(["pnpm test"]), runtime: own, command })).resolves.toMatchObject({
      tier: "A",
      mode: "own_loop",
    });
    await expect(selector({ A: false, B: true, D: true, C: true }).resolve({ task: task(["pnpm test"]), runtime: own, command })).resolves.toMatchObject({ tier: "B" });
    await expect(selector({ A: false, B: false, D: true, C: true }).resolve({ task: task(["pnpm test"]), runtime: own, command })).resolves.toMatchObject({ tier: "D" });
    const onlyC = await selector({ C: true }).resolve({ task: task(["pnpm test"]), runtime: own, command });
    expect(onlyC).toMatchObject({ tier: "C", mode: "own_loop", badge: "weaker_sandbox_yellow" });
    expect(calls).toContain("reconcile");
  });

  it("holds pnpm install on a Tier C-only machine and never executes it", async () => {
    const calls: string[] = [];
    const picked = selector({ C: true }, calls);
    const decision = await picked.resolve({ task: task(["pnpm install"]), runtime: own, command });
    expect(decision.kind).toBe("hold");
    if (decision.kind !== "hold") return;
    expect(decision.hold.reason).toBe("sandbox_tier_insufficient");
    expect(decision.hold.executed).toBe(false);
    expect(decision.hold.offers).toEqual(TIER_INSUFFICIENT_OFFERS);
    expect(decision.hold.explanation).toContain("Tier C");
    expect(decision.hold.explanation).toContain("unsandboxed");
    await expect(picked.execute({ task: task(["pnpm install"]), runtime: own, command })).rejects.toBeInstanceOf(
      TaskHeldError,
    );
    expect(calls.filter((call) => call.startsWith("exec:"))).toEqual([]);
  });

  it("stamps UNSANDBOXED only while the explicit red-warning opt-in is on", async () => {
    const calls: string[] = [];
    const unsandboxed: string[] = [];
    const settings = { runUnsandboxed: true, pinTierDForLinuxParity: false };
    const picked = new SandboxTierSelector({
      providers: { tierA: provider("A", true, calls), tierC: provider("C", true, calls) },
      settings,
      now: () => "2026-11-20T00:00:00.000Z",
      unsandboxedRunner: async () => {
        unsandboxed.push("ran");
      },
    });
    const first = await picked.execute({ task: task(["pnpm install"]), runtime: own, command });
    expect(first.receipt.sandboxTier).toBe("UNSANDBOXED");
    expect(first.receipt.tier).toBe("UNSANDBOXED");
    expect(first.receipt.redBannerWarning).toBe(true);
    expect(first.receipt.mode).toBe("own_loop");
    expect(first.taskCard.sandboxTier).toBe("UNSANDBOXED");
    expect(first.taskCard.redBannerWarning).toBe(true);
    expect(unsandboxed).toEqual(["ran"]);
    expect(calls.filter((call) => call.startsWith("exec:"))).toEqual([]);
    picked.setRunUnsandboxed(false);
    const second = await picked.execute({
      task: task(["pnpm test"]),
      runtime: own,
      command: { ...command, commandId: "cmd-2" },
    });
    expect(second.receipt.tier).toBe("A");
    expect(second.receipt.redBannerWarning).toBe(false);
    expect(picked.receipts[0]).toBe(first.receipt);
    expect(first.receipt.sandboxTier).toBe("UNSANDBOXED");
    expect(first.taskCard.sandboxTier).toBe("UNSANDBOXED");
    expect(second.taskCard.redBannerWarning).toBe(false);
  });

  it("forces stripped mode for a foreign agent and throws when wrapped mode is requested on Tier C", async () => {
    const stripped = await selector({ C: true }).resolve({
      task: task(["pnpm test"]),
      runtime: { kind: "foreign_agent", runtimeId: "Cursor", requestedMode: "stripped" },
      command,
    });
    expect(stripped).toMatchObject({ tier: "C", mode: "stripped", badge: "weaker_sandbox_yellow" });
    await expect(
      selector({ C: true }).resolve({
        task: task(["pnpm test"]),
        runtime: { kind: "foreign_agent", runtimeId: "Claude Code", requestedMode: "wrapped" },
        command,
      }),
    ).rejects.toBeInstanceOf(WrappedModeForbiddenOnTierCError);
    const held = await selector({ C: true }).resolve({
      task: task(["pnpm install"]),
      runtime: { kind: "foreign_agent", runtimeId: "Copilot", requestedMode: "stripped" },
      command,
    });
    expect(held.kind).toBe("hold");
    if (held.kind === "hold") expect(held.hold.alternative).toBe("native_worker_loop_held");
    await expect(
      selector({ A: true, C: true }).resolve({
        task: task(["pnpm test"]),
        runtime: { kind: "foreign_agent", runtimeId: "Cursor", requestedMode: "wrapped" },
        command,
      }),
    ).resolves.toMatchObject({ tier: "A", mode: "wrapped" });
  });

  it("rejects Tier C on UNC and network paths and prefers Tier A or Tier D", async () => {
    await expect(
      selector({ A: true, C: true }).resolve({ task: task(["pnpm test"], "\\\\server\\share\\app"), runtime: own, command }),
    ).resolves.toMatchObject({ tier: "A" });
    const held = await selector({ C: true }).resolve({
      task: task(["pnpm test"], "//files/share/app"),
      runtime: own,
      command,
    });
    expect(held.kind).toBe("hold");
    if (held.kind === "hold") expect(held.hold.explanation).toContain("UNC");
    const mapped = await selector({ A: true, B: true, C: true }, [], undefined, (target) =>
      target.startsWith("Z:") ? "network" : "local",
    ).resolve({ task: task(["pnpm test"], "Z:\\app"), runtime: own, command });
    expect(mapped).toMatchObject({ tier: "A" });
    const mappedHeld = await selector({ B: true, C: true }, [], undefined, () => "network").resolve({
      task: task(["pnpm test"], "Z:\\app"),
      runtime: own,
      command,
    });
    expect(mappedHeld.kind).toBe("hold");
  });

  it("pins Tier D for Linux parity and holds when that pin cannot run the task", async () => {
    const pinned = await selector({ A: true, B: true, D: true, C: true }, [], {
      runUnsandboxed: false,
      pinTierDForLinuxParity: true,
    }).resolve({ task: task(["pnpm test"]), runtime: own, command });
    expect(pinned).toMatchObject({ tier: "D" });
    const missing = await selector({ C: true }, [], {
      runUnsandboxed: false,
      pinTierDForLinuxParity: true,
    }).resolve({ task: task(["pnpm install"]), runtime: own, command });
    expect(missing.kind).toBe("hold");
    if (missing.kind === "hold") expect(missing.hold.explanation).toContain("pinned");
  });

  it("refuses a Tier C provider that claims secret or network enforcement", () => {
    expect(
      () =>
        new SandboxTierSelector({
          providers: {
            tierC: provider("C", true, [], {
              fileWritesEnforced: true,
              secretReadsDenied: true,
              networkEnforced: true,
              requiresAdmin: false,
              badge: "weaker_sandbox_yellow",
            }),
          },
        }),
    ).toThrow(TierCHonestyError);
  });

  it("describes all four tiers and the foreign runtimes restricted on a Tier C machine", async () => {
    const matrix = await selector({ C: true }).diagnosticMatrix();
    expect(matrix.activeTier).toBe("C");
    expect(matrix.tiers.map((tier) => tier.tier)).toEqual(["A", "B", "D", "C"]);
    expect(matrix.summary).toContain("weaker");
    expect(matrix.summary).toContain("Tier A");
    expect(matrix.summary).toContain("Tier B");
    expect(matrix.summary).toContain("Tier D");
    expect(matrix.restrictedForeignRuntimes).toEqual([
      "Copilot",
      "Cursor",
      "Claude Code",
      "Codex",
      "Gemini CLI",
      "OpenCode",
    ]);
    const strong = await selector({ A: true, C: true }).diagnosticMatrix();
    expect(strong.activeTier).toBe("A");
    expect(strong.restrictedForeignRuntimes).toEqual([]);
  });
});
