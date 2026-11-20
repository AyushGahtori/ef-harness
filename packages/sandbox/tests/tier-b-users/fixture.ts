import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EmptySlotAclManager } from "../../src/tier-b-users/acl.js";
import { RecordingAclPort } from "../../src/tier-b-users/memory.js";
import { TierBAdminProvisioner } from "../../src/tier-b-users/provisioner.js";
import { createTierBSandboxUsersProvider } from "../../src/tier-b-users/provider.js";
import type { SandboxLaunchSpec, VolumeInfo } from "../../src/tier-b-users/types.js";
import {
  MemoryAuditLog,
  MemoryGovernor,
  MemoryJobManager,
  MemorySecretProtector,
  RecordingLogonExecutor,
  RecordingScriptRunner,
  readyInspector,
} from "../../src/tier-b-users/index.js";

export const PROXY_PORT = 4318;
export const MCP_PORT = 4320;
export const DEVELOPER_SID = "S-1-5-21-100-200-1001";

export function ntfs(devDrive = false): VolumeInfo {
  return { fileSystem: devDrive ? "ReFS" : "NTFS", unc: false, devDrive };
}

export function removeLater(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function makeTree(): {
  readonly root: string;
  readonly profile: string;
  readonly slot: string;
  readonly otherSlot: string;
  readonly temp: string;
  readonly build: string;
  readonly checkout: string;
  readonly harness: string;
  readonly local: string;
  readonly appData: string;
  readonly store: string;
  readonly toolchain: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-tier-b-"));
  const profile = path.join(root, "profile");
  const slot = path.join(root, "slot");
  const otherSlot = path.join(root, "other-slot");
  const temp = path.join(root, "temp");
  const build = path.join(root, "build");
  const checkout = path.join(root, "checkout");
  const harness = path.join(root, "harness");
  const local = path.join(root, "local");
  const appData = path.join(root, "appdata");
  const store = path.join(root, "pnpm-store");
  const toolchain = path.join(root, "toolchain");
  for (const dir of [profile, slot, otherSlot, temp, build, checkout, harness, local, appData, store, toolchain]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return { root, profile, slot, otherSlot, temp, build, checkout, harness, local, appData, store, toolchain };
}

export function launchSpec(tree: ReturnType<typeof makeTree>, attemptId = "attempt-1"): SandboxLaunchSpec {
  return {
    attemptId,
    worktree: tree.slot,
    tempDir: tree.temp,
    buildOutputDir: tree.build,
    developerCheckout: tree.checkout,
    harnessDataRoot: tree.harness,
    userProfile: tree.profile,
    localAppData: tree.local,
    appData: tree.appData,
    toolchainRoots: [tree.toolchain],
    pnpmStore: tree.store,
    otherWorktrees: [tree.otherSlot],
    mcpPort: MCP_PORT,
    proxyPort: PROXY_PORT,
    mode: "per_command",
  };
}

export function harness(
  tree: ReturnType<typeof makeTree>,
  options: {
    readonly logon?: RecordingLogonExecutor;
    readonly volumeOf?: (target: string) => VolumeInfo;
  } = {},
) {
  const logon = options.logon ?? new RecordingLogonExecutor();
  const aclPort = new RecordingAclPort();
  const acl = new EmptySlotAclManager({
    accountSid: "S-1-5-21-42424242-1-1001",
    acl: aclPort,
    userProfile: tree.profile,
    tempDirForSlot: () => tree.temp,
  });
  const runner = new RecordingScriptRunner();
  const protector = new MemorySecretProtector();
  const logger = new MemoryAuditLog();
  const provisioner = new TierBAdminProvisioner({
    runner,
    protector,
    developerSid: DEVELOPER_SID,
    proxyPort: PROXY_PORT,
    mcpPort: MCP_PORT,
    logger,
  });
  const jobManager = new MemoryJobManager();
  const governor = new MemoryGovernor();
  const provider = createTierBSandboxUsersProvider({
    provisioner,
    inspector: readyInspector(provisioner.firewallRules()),
    volumeOf: options.volumeOf ?? (() => ntfs()),
    acl,
    jobManager,
    logger,
    governor,
    logon,
    envSource: {
      PATH: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      GH_TOKEN: "personal-token",
      OPENAI_API_KEY: "personal-key",
      USERNAME: "developer",
      HOME: tree.profile,
    },
  });
  return { aclPort, acl, runner, protector, logger, provisioner, jobManager, governor, provider, logon };
}
