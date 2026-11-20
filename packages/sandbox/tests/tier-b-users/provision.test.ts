import { describe, expect, it } from "vitest";
import {
  ConsentRequiredError,
  ProvisionFailedError,
  SANDBOX_OFFLINE_ACCOUNT,
  SANDBOX_ONLINE_ACCOUNT,
  buildTierBFirewallRules,
  evaluateTierBNetwork,
  excludedPortRanges,
  explainProvisionFailure,
  passwordLooksStrong,
  rangeCovers,
  sandboxUserCanDecryptDeveloperDpapi,
} from "../../src/tier-b-users/index.js";
import { generateSandboxPassword } from "../../src/tier-b-users/password.js";
import { DEVELOPER_SID, MCP_PORT, PROXY_PORT, harness, makeTree, removeLater } from "./fixture.js";

describe("Tier B provisioner and firewall", () => {
  it("builds a consent-gated plan whose script does not embed passwords", async () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      const password = generateSandboxPassword();
      const plan = rig.provisioner.createPlan();
      expect(passwordLooksStrong(password)).toBe(true);
      expect(plan.accounts).toEqual([SANDBOX_OFFLINE_ACCOUNT, SANDBOX_ONLINE_ACCOUNT]);
      expect(plan.adminGroupMembership).toBe(false);
      expect(plan.interactiveLogon).toBe("denied");
      expect(plan.denyLogonRights).toEqual(["SeDenyInteractiveLogonRight", "SeDenyRemoteInteractiveLogonRight"]);
      expect(plan.passwordEmbeddedInScript).toBe(false);
      expect(plan.passwordStorage).toBe("dpapi_or_lsa");
      expect(plan.silent).toBe(false);
      expect(plan.script.includes(password)).toBe(false);
      expect(plan.script.includes(SANDBOX_OFFLINE_ACCOUNT)).toBe(true);
      expect(plan.script.includes(SANDBOX_ONLINE_ACCOUNT)).toBe(true);
      expect(plan.script.includes("USER_PRIV_USER")).toBe(true);
      expect(plan.script.includes("Not an administrator")).toBe(true);
      expect(plan.script.includes("settings_sandbox_setup")).toBe(true);
      await expect(rig.provisioner.provision({ explicit: true })).rejects.toBeInstanceOf(ConsentRequiredError);
      expect(rig.provisioner.executionCount).toBe(0);
      expect(rig.runner.invocations).toHaveLength(0);
    } finally {
      removeLater(tree.root);
    }
  });

  it("stores passwords in DPAPI for the developer and runs only after UAC consent", async () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      const result = await rig.provisioner.provision({
        source: "settings_sandbox_setup",
        explicit: true,
        uacAccepted: true,
        action: "provision",
      });
      expect(rig.provisioner.executionCount).toBe(1);
      const invocation = rig.runner.invocations[0];
      expect(invocation?.stdinIsSecret).toBe(true);
      expect(invocation?.script.includes(invocation.stdin.split("\n")[0] ?? "missing")).toBe(false);
      expect(result.secrets).toHaveLength(2);
      const offline = result.secrets[0];
      expect(offline?.protection).toBe("dpapi");
      expect(offline?.ownerSid).toBe(DEVELOPER_SID);
      expect(sandboxUserCanDecryptDeveloperDpapi()).toBe(false);
      expect(offline ? rig.protector.unprotect(offline, "S-1-5-21-42424242-1-1001") : "present").toBeNull();
      expect(offline ? rig.protector.unprotect(offline, DEVELOPER_SID) : null).toEqual(expect.any(String));
      const logged = JSON.stringify(rig.logger.entries);
      const secret = invocation?.stdin.split("\n")[0] ?? "";
      expect(logged.includes(secret)).toBe(false);
    } finally {
      removeLater(tree.root);
    }
  });

  it("maps Group Policy failures to a plain-English Tier A, D, or C fallback and rolls back the vault", async () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      rig.runner.exitCode = 5;
      await expect(
        rig.provisioner.provision({
          source: "settings_sandbox_setup",
          explicit: true,
          uacAccepted: true,
          action: "provision",
        }),
      ).rejects.toBeInstanceOf(ProvisionFailedError);
      expect(rig.protector.list()).toEqual([]);
      const user = explainProvisionFailure(5, "NetUserAdd");
      expect(user.policyBlocked).toBe(true);
      expect(user.summary).toContain("Group Policy");
      expect(user.fallbackTiers).toEqual(["A", "D", "C"]);
      const firewall = explainProvisionFailure(0x80070422, "Firewall");
      expect(firewall.policyBlocked).toBe(true);
      expect(firewall.summary).toContain("Firewall");
      expect(explainProvisionFailure(1058, "Firewall").policyBlocked).toBe(true);
      expect(explainProvisionFailure(2224, "NetUserAdd").summary).toContain("already exists");
    } finally {
      removeLater(tree.root);
    }
  });

  it("blocks non-loopback traffic and leaves only the proxy and MCP loopback ports open", () => {
    const rules = buildTierBFirewallRules({ proxyPort: PROXY_PORT, mcpPort: MCP_PORT });
    const offline = rules.filter((rule) => rule.localUser === SANDBOX_OFFLINE_ACCOUNT);
    expect(offline.length).toBeGreaterThan(0);
    expect(offline.every((rule) => rule.action === "block" && rule.direction === "out")).toBe(true);
    const otherTcp = offline.find((rule) => rule.name.includes("Loopback-OtherTcp"));
    expect(otherTcp?.remotePorts).not.toBe("any");
    if (!otherTcp || otherTcp.remotePorts === "any") throw new Error("missing loopback port block");
    expect(rangeCovers(otherTcp.remotePorts, PROXY_PORT)).toBe(false);
    expect(rangeCovers(otherTcp.remotePorts, MCP_PORT)).toBe(false);
    expect(rangeCovers(otherTcp.remotePorts, 443)).toBe(true);
    expect(rangeCovers(otherTcp.remotePorts, 80)).toBe(true);
    expect(excludedPortRanges([PROXY_PORT, MCP_PORT]).some((range) => range.start === PROXY_PORT)).toBe(false);
    const nonLoopback = offline.find((rule) => rule.name.includes("NonLoopback-IPv4"));
    expect(nonLoopback?.remoteAddresses.join(",")).not.toContain("127.0.0.1");
    expect(nonLoopback?.remoteAddresses.join(",")).toContain("0.0.0.0-126.255.255.255");
    expect(evaluateTierBNetwork({
      account: "offline",
      host: "1.1.1.1",
      port: 443,
      proxyPort: PROXY_PORT,
      mcpPort: MCP_PORT,
    }).allowed).toBe(false);
    expect(evaluateTierBNetwork({
      account: "offline",
      host: "127.0.0.1",
      port: PROXY_PORT,
      proxyPort: PROXY_PORT,
      mcpPort: MCP_PORT,
    }).allowed).toBe(true);
    expect(evaluateTierBNetwork({
      account: "online",
      host: "example.com",
      port: 443,
      proxyPort: PROXY_PORT,
      mcpPort: MCP_PORT,
    }).ruleId).toBe("firewall_online_non_loopback");
  });

  it("removes both users, firewall rules, and vault entries when deprovisioning is consented", async () => {
    const tree = makeTree();
    try {
      const rig = harness(tree);
      await rig.provisioner.provision({
        source: "settings_sandbox_setup",
        explicit: true,
        uacAccepted: true,
        action: "provision",
      });
      const plan = rig.provisioner.createDeprovisionPlan();
      expect(plan.accountsRemoved).toEqual([SANDBOX_OFFLINE_ACCOUNT, SANDBOX_ONLINE_ACCOUNT]);
      expect(plan.firewallRulesRemoved.length).toBe(plan.reversible ? rig.provisioner.firewallRules().length : 0);
      expect(plan.vaultEntriesRemoved).toEqual([SANDBOX_OFFLINE_ACCOUNT, SANDBOX_ONLINE_ACCOUNT]);
      expect(plan.script.includes(SANDBOX_OFFLINE_ACCOUNT)).toBe(true);
      await expect(rig.provisioner.unprovision({ action: "unprovision" })).rejects.toBeInstanceOf(ConsentRequiredError);
      const removed = await rig.provisioner.unprovision({
        source: "settings_sandbox_setup",
        explicit: true,
        uacAccepted: true,
        action: "unprovision",
      });
      expect(removed.reversible).toBe(true);
      expect(rig.protector.list()).toEqual([]);
    } finally {
      removeLater(tree.root);
    }
  });
});
