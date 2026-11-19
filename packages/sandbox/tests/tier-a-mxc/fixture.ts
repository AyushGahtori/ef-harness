import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MxcAvailability, MxcKernelBackend, SandboxLaunchSpec } from "../../src/tier-a-mxc/index.js";

export function policySpec(overrides: Partial<SandboxLaunchSpec> = {}): SandboxLaunchSpec {
  return {
    attemptId: "attempt-1",
    worktree: "C:\\wt\\slot-1",
    tempDir: "C:\\wt\\slot-1-temp",
    buildOutputDir: "C:\\wt\\slot-1-build",
    developerCheckout: "C:\\src\\checkout",
    harnessDataRoot: "C:\\Users\\dev\\AppData\\Local\\EFHarness",
    userProfile: "C:\\Users\\dev",
    localAppData: "C:\\Users\\dev\\AppData\\Local",
    appData: "C:\\Users\\dev\\AppData\\Roaming",
    toolchainRoots: ["C:\\toolchain\\node"],
    pnpmStore: "C:\\pnpm-store",
    otherWorktrees: ["C:\\wt\\slot-2"],
    mcpPort: 47001,
    proxyPort: 47002,
    mode: "per_command",
    ...overrides,
  };
}

export async function realSpec(name: string, overrides: Partial<SandboxLaunchSpec> = {}): Promise<{
  readonly root: string;
  readonly spec: SandboxLaunchSpec;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `ef-mxc-${name}-`));
  const spec = policySpec({
    worktree: path.join(root, "work"),
    tempDir: path.join(root, "temp"),
    buildOutputDir: path.join(root, "build"),
    developerCheckout: path.join(root, "checkout"),
    harnessDataRoot: path.join(root, "harness"),
    userProfile: path.join(root, "profile"),
    localAppData: path.join(root, "local"),
    appData: path.join(root, "roaming"),
    toolchainRoots: [path.join(root, "toolchain")],
    pnpmStore: path.join(root, "store"),
    otherWorktrees: [path.join(root, "other")],
    ...overrides,
  });
  await fs.mkdir(spec.worktree, { recursive: true });
  await fs.mkdir(spec.tempDir, { recursive: true });
  await fs.mkdir(spec.buildOutputDir, { recursive: true });
  await fs.mkdir(spec.developerCheckout, { recursive: true });
  await fs.mkdir(path.join(spec.harnessDataRoot, "projects"), { recursive: true });
  await fs.mkdir(spec.userProfile, { recursive: true });
  await fs.mkdir(spec.pnpmStore, { recursive: true });
  await fs.mkdir(spec.toolchainRoots[0] ?? spec.worktree, { recursive: true });
  await fs.mkdir(spec.otherWorktrees[0] ?? spec.worktree, { recursive: true });
  return { root, spec };
}

export function readyAvailability(overrides: Partial<MxcAvailability> = {}): MxcAvailability {
  return {
    available: true,
    osBuild: "26200.9974",
    reason: null,
    policyBasedGrants: true,
    buildEligible: true,
    runtimeExportPresent: true,
    helperPresent: false,
    launchable: false,
    launchBlocker: "mxc_requires_pinned_helper",
    ...overrides,
  };
}

export function testKernel(
  launch: MxcKernelBackend["launch"],
): MxcKernelBackend {
  return { kind: "test_double", launch };
}
