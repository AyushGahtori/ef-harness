import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SANDBOX_OFFLINE_ACCOUNT, SANDBOX_ONLINE_ACCOUNT } from "../../src/tier-b-users/constants.js";
import {
  CreateProcessAsUserError,
  RecordingLogonExecutor,
  TierBCommandTimeoutError,
  TierBError,
  VolumeRejectedError,
  runTierBLiveRedTeam,
} from "../../src/tier-b-users/index.js";
import { harness, launchSpec, makeTree, removeLater } from "./fixture.js";

describe("Tier B warm logon provider", () => {
  it("runs coding commands as the offline user, nests a job, and wipes temp without provisioning", async () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      rig.acl.onEmptySlotCreated(tree.slot);
      const spec = launchSpec(tree);
      const instance = await rig.provider.acquireWarmInstance(spec);
      fs.writeFileSync(path.join(tree.temp, "residue.txt"), "left-over");
      const result = await rig.provider.executeCommand(instance, { command: "node", args: ["--version"] });
      expect(result.account).toBe(SANDBOX_OFFLINE_ACCOUNT);
      expect(result.desktop).toBe("EFHarnessSandboxWinSta\\EFHarnessSandboxDesktop");
      expect(fs.existsSync(path.join(tree.temp, "residue.txt"))).toBe(false);
      expect(rig.provisioner.executionCount).toBe(0);
      const plan = rig.logon.launches[0];
      expect(plan?.apis).toEqual(["LogonUser", "CreateRestrictedToken", "CreateProcessAsUserW"]);
      expect(plan?.restrictingSids).toEqual([rig.acl.requireSlotGrant(tree.slot).capabilitySid]);
      expect(plan?.env.GH_TOKEN).toBeUndefined();
      expect(plan?.env.USERNAME).toBe(SANDBOX_OFFLINE_ACCOUNT);
      expect(plan?.directExternalTcp).toBe("deny");
      expect(plan?.jobNested).toBe(true);
      const commandJob = rig.jobManager.created.find((job) => job.name.startsWith("tier-b-command-"));
      const attemptJob = rig.jobManager.created.find((job) => job.name.startsWith("tier-b-attempt-"));
      expect(commandJob?.parentId).toBe(attemptJob?.id);
      expect(commandJob?.limits.killOnJobClose).toBe(true);
      expect(commandJob?.limits.uiRestrictions).toBe(true);
      expect(rig.jobManager.assigned).toHaveLength(1);
      const online = await rig.provider.executeCommand(instance, {
        command: "proxy",
        purpose: "test_endpoint",
        kernelApproved: true,
        declaredEndpoints: ["payments.example"],
      });
      expect(online.account).toBe(SANDBOX_ONLINE_ACCOUNT);
      expect(rig.logon.launches[1]?.proxyDeclaredEndpoints).toEqual(["payments.example"]);
      await expect(
        rig.provider.executeCommand(instance, { command: "proxy", purpose: "test_endpoint" }),
      ).rejects.toBeInstanceOf(TierBError);
    } finally {
      removeLater(tree.root);
    }
  });

  it("injects one wrapped token and logs CreateProcessAsUserW diagnostics", async () => {
    const tree = makeTree();
    try {
      const logon = new RecordingLogonExecutor();
      const rig = harness(tree, { logon });
      rig.acl.onEmptySlotCreated(tree.slot);
      const spec = launchSpec(tree);
      const handle = await rig.provider.spawnWrappedProcess({
        ...spec,
        vendor: "codex",
        command: "codex",
        token: "scoped-access",
        tokenKind: "client_supplied",
        mode: "wrapped",
      });
      expect(handle.mode).toBe("wrapped");
      expect(handle.vendor).toBe("codex");
      expect(rig.logon.launches[0]?.env.ACCESS_TOKEN).toBe("scoped-access");
      expect(rig.logon.launches[0]?.env.GH_TOKEN).toBeUndefined();
      expect(rig.logon.launches[0]?.env.ANTHROPIC_API_KEY).toBeUndefined();
      await rig.provider.disposeInstance(handle.instance);
      logon.failWin32 = 5;
      const again = await rig.provider.acquireWarmInstance(spec);
      await expect(rig.provider.executeCommand(again, { command: "node" })).rejects.toBeInstanceOf(CreateProcessAsUserError);
      const entry = rig.logger.entries.find((item) => item.fields.api === "CreateProcessAsUserW");
      expect(entry?.fields.win32Error).toBe(5);
      expect(String(entry?.fields.edrHint)).toContain("CreateProcessAsUserW");
      expect(JSON.stringify(entry).includes("scoped-access")).toBe(false);
    } finally {
      removeLater(tree.root);
    }
  });

  it("times out a hung command and refuses FAT32 volumes", async () => {
    const tree = makeTree();
    try {
      const logon = new RecordingLogonExecutor();
      logon.delayMs = 200;
      const rig = harness(tree, { logon });
      rig.acl.onEmptySlotCreated(tree.slot);
      const instance = await rig.provider.acquireWarmInstance(launchSpec(tree));
      await expect(rig.provider.executeCommand(instance, { command: "sleep", timeoutMs: 20 })).rejects.toBeInstanceOf(
        TierBCommandTimeoutError,
      );
      const fat = harness(tree, {
        volumeOf: () => ({ fileSystem: "FAT32", unc: false, devDrive: false }),
      });
      await expect(fat.provider.acquireWarmInstance(launchSpec(tree))).rejects.toBeInstanceOf(VolumeRejectedError);
    } finally {
      removeLater(tree.root);
    }
  });
});

describe("Tier B live red team", () => {
  it("does not claim OS enforcement on an unprovisioned host", async () => {
    const report = await runTierBLiveRedTeam({ live: false });
    expect(report.claimedOsEnforcement).toBe(false);
    expect(report.status).toBe("skipped_unprovisioned");
    expect(report.probes.every((probe) => probe.executed === false && probe.actuallyBlocked === false)).toBe(true);
    const opted = await runTierBLiveRedTeam({ live: true });
    expect(opted.claimedOsEnforcement).toBe(false);
    expect(opted.probes.every((probe) => probe.executed === false)).toBe(true);
  });
});
