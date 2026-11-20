import { describe, expect, it } from "vitest";
import {
  TIER_C_CAPABILITIES,
  TIER_PREFERENCE,
  TierCRestrictedTokenProvider,
  createSyntheticCapabilitySid,
  isTaskEligibleForTierC,
} from "../../src/tier-c-d-selector/index.js";
import type { RuntimeDispatch, TaskSandboxSpec } from "../../src/tier-c-d-selector/index.js";

const ownLoop: RuntimeDispatch = { kind: "own_loop", runtimeId: "native_worker" };
const copilotWrapped: RuntimeDispatch = {
  kind: "foreign_agent",
  runtimeId: "Copilot",
  requestedMode: "wrapped",
};
const copilotDefault: RuntimeDispatch = { kind: "foreign_agent", runtimeId: "Copilot" };

function task(commands: TaskSandboxSpec["commands"], extra: Partial<TaskSandboxSpec> = {}): TaskSandboxSpec {
  return {
    taskId: "task-1",
    attemptId: "attempt-1",
    projectId: "project-1",
    projectPath: "C:\\src\\app",
    worktreePath: "C:\\src\\wt",
    tempPath: "C:\\src\\tmp",
    commands,
    ...extra,
  };
}

describe("Tier C eligibility", () => {
  it("blocks dependency installs and tells the caller to use Tier A, B, or D", () => {
    for (const command of ["pnpm install", "pnpm i --frozen-lockfile", "npm ci", "yarn install", "bun add left-pad"]) {
      const result = isTaskEligibleForTierC(task([command]), ownLoop);
      expect(result.eligible).toBe(false);
      expect(result.blocks).toContain("dependency_install");
      expect(result.requiredTiers).toEqual(["A", "B", "D"]);
    }
  });

  it("blocks untrusted dev servers, network, and untrusted package runners", () => {
    expect(isTaskEligibleForTierC(task(["pnpm dev"]), ownLoop).blocks).toContain("untrusted_dev_server");
    expect(isTaskEligibleForTierC(task(["next dev"]), ownLoop).blocks).toContain("untrusted_dev_server");
    expect(isTaskEligibleForTierC(task(["pnpm test"], { needsExternalNetwork: true }), ownLoop).blocks).toContain(
      "external_network",
    );
    expect(isTaskEligibleForTierC(task(["npx eslint"]), ownLoop).blocks).toContain("untrusted_packages");
    expect(isTaskEligibleForTierC(task(["pnpm dlx cowsay"]), ownLoop).blocks).toContain("untrusted_packages");
    expect(
      isTaskEligibleForTierC(task(["pnpm test"], { runsThirdPartyCodeBeyondLockedDeps: true }), ownLoop).blocks,
    ).toContain("third_party_code");
  });

  it("allows a pure locked-dependency task and keeps the yellow weaker-sandbox badge", () => {
    const result = isTaskEligibleForTierC(task([["pnpm", "test"], "pnpm exec vitest run", "tsc --noEmit"]), ownLoop);
    expect(result.eligible).toBe(true);
    expect(result.blocks).toEqual([]);
    expect(result.badge).toBe("weaker_sandbox_yellow");
    expect(result.forcedMode).toBe("own_loop");
    expect(TIER_C_CAPABILITIES).toEqual({
      fileWritesEnforced: true,
      secretReadsDenied: false,
      networkEnforced: false,
      requiresAdmin: false,
      badge: "weaker_sandbox_yellow",
    });
    expect(new TierCRestrictedTokenProvider({ driveType: async () => "fixed" }).capabilities).toEqual(
      TIER_C_CAPABILITIES,
    );
  });

  it("does not treat vitest or pnpm exec as an untrusted dev server", () => {
    expect(isTaskEligibleForTierC(task(["pnpm exec vitest"]), ownLoop).eligible).toBe(true);
  });

  it("forces foreign agents to stripped mode and flags wrapped mode", () => {
    const allowed = isTaskEligibleForTierC(task(["pnpm test"]), copilotDefault);
    expect(allowed.eligible).toBe(true);
    expect(allowed.forcedMode).toBe("stripped");
    expect(allowed.wrappedForbidden).toBe(false);
    const wrapped = isTaskEligibleForTierC(task(["pnpm test"]), copilotWrapped);
    expect(wrapped.wrappedForbidden).toBe(true);
    expect(wrapped.forcedMode).toBe("stripped");
  });

  it("mints a synthetic capability SID", () => {
    expect(createSyntheticCapabilitySid()).toMatch(/^S-1-5-21-\d+-\d+-\d+-\d+$/);
    expect(TIER_PREFERENCE).toEqual(["A", "B", "D", "C"]);
  });
});
