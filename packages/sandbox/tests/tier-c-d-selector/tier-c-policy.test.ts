import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NetworkPathRejectedError,
  TIER_C_CAPABILITIES,
  WorktreeNotEmptyError,
  buildTierCEnvironment,
  planTierCAcls,
  quoteWindowsArgument,
} from "../../src/tier-c-d-selector/index.js";
import { TierCRestrictedTokenProvider } from "../../src/tier-c-d-selector/tier-c-provider.js";
import type { SandboxLaunchSpec } from "../../src/tier-c-d-selector/index.js";

const launch = (worktree: string, temp: string): SandboxLaunchSpec => ({
  projectId: "project-1",
  attemptId: "attempt-1",
  taskId: "task-1",
  projectPath: worktree,
  worktreePath: worktree,
  tempPath: temp,
  mode: "own_loop",
});

describe("Tier C policy", () => {
  it("plans write grants only for the worktree and temp, and denies .git and node_modules", () => {
    const plan = planTierCAcls({
      worktreePath: "C:\\wt",
      tempPath: "C:\\tmp",
      sid: "S-1-5-21-1-2-3-1001",
    });
    expect(plan.emptyWorktreeRequired).toBe(true);
    expect(plan.nodeModulesReadOnly).toBe(true);
    expect(plan.gitWriteDenied).toBe(true);
    expect(plan.grants.map((entry) => entry.target)).toEqual(["worktree", "temp"]);
    expect(plan.denies.map((entry) => entry.target)).toEqual(["git", "node_modules"]);
    expect(plan.denies.every((entry) => entry.rights === "deny_write")).toBe(true);
  });

  it("builds an allowlisted advisory environment and drops secret names", () => {
    const env = buildTierCEnvironment({
      tempPath: "C:\\attempt\\tmp",
      systemRoot: "C:\\Windows",
      pathEntries: ["C:\\Windows\\System32"],
      extra: { GH_TOKEN: "leak-me", LANG: "C", AWS_SECRET_ACCESS_KEY: "leak-me-too" },
    });
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:9");
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:9");
    expect(env.NO_PROXY).toContain("127.0.0.1");
    expect(env.GIT_SSH_COMMAND).toContain("exit /b 1");
    expect(env.TEMP).toBe("C:\\attempt\\tmp");
    expect(env.USERPROFILE).toBe("C:\\attempt\\tmp");
    expect(env.LANG).toBe("C");
    expect(JSON.stringify(env)).not.toContain("leak-me");
    expect(quoteWindowsArgument("C:\\Program Files\\node.exe")).toBe('"C:\\Program Files\\node.exe"');
  });

  it("rejects UNC paths and parent segments before any token is created", async () => {
    const provider = new TierCRestrictedTokenProvider({ driveType: async () => "fixed" });
    await expect(
      provider.acquireWarmInstance(launch("\\\\server\\share\\wt", "C:\\tmp")),
    ).rejects.toBeInstanceOf(NetworkPathRejectedError);
    await expect(
      provider.acquireWarmInstance(launch("C:\\src\\..\\outside", "C:\\tmp")),
    ).rejects.toBeInstanceOf(Error);
  });

  it("rejects a network drive and a non-empty worktree without granting ACLs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-tierc-policy-"));
    const worktree = path.join(root, "work");
    const temp = path.join(root, "temp");
    fs.mkdirSync(worktree);
    fs.mkdirSync(temp);
    fs.writeFileSync(path.join(worktree, "already.txt"), "x");
    let prepared = false;
    const provider = new TierCRestrictedTokenProvider({
      driveType: async () => "fixed",
      broker: {
        prepare: async () => {
          prepared = true;
          return { ok: true };
        },
        classify: async () => ({ ok: true, drive: "fixed" }),
        launch: async () => ({ ok: false, error: "not used" }),
      },
    });
    await expect(provider.acquireWarmInstance(launch(worktree, temp))).rejects.toBeInstanceOf(WorktreeNotEmptyError);
    expect(prepared).toBe(false);
    const network = new TierCRestrictedTokenProvider({ driveType: async () => "remote" });
    await expect(network.acquireWarmInstance(launch(path.join(root, "empty"), path.join(root, "empty-tmp")))).rejects.toBeInstanceOf(
      NetworkPathRejectedError,
    );
    fs.rmSync(root, { recursive: true, force: true });
    expect(TIER_C_CAPABILITIES.networkEnforced).toBe(false);
    expect(TIER_C_CAPABILITIES.secretReadsDenied).toBe(false);
  });

  it("keeps CreateRestrictedToken with WRITE_RESTRICTED in the broker", () => {
    const script = fs.readFileSync(
      new URL("../../src/tier-c-d-selector/tier-c-broker.ps1", import.meta.url),
      "utf8",
    );
    expect(script).toContain("CreateRestrictedToken");
    expect(script).toContain("WRITE_RESTRICTED");
    expect(script).not.toContain(".wslconfig");
  });
});
