import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DeployApprovalPolicyEngine,
  DockerOverSshDeployAdapter,
  HostKeyConfirmationRequiredError,
  InMemoryKnownHostsStore,
  LiveKeyPreviewBlockedError,
  NameOnlySyncEnvController,
  ProductionRequiresExplicitApprovalError,
  ShellPathRejectedError,
  TestKeyProductionBlockedError,
  UnhealthySwapAbortedError,
  VercelDeployAdapter,
  VercelHttpClient,
  assertDeployDispatchAllowed,
  assertShellSafeSegment,
} from "../../src/deploy-adapters/index.js";
import { MockVault } from "./support/mock-vault.js";
import { MockSshTransport } from "./support/mock-ssh.js";
import { startMockVercelServer } from "./support/mock-vercel-server.js";

function stripeLiveSample(): string {
  return ["sk", "_live_51ABC"].join("");
}

function stripeTestSample(): string {
  return ["sk", "_test_123"].join("");
}

describe("NameOnlySyncEnvController", () => {
  it("emits name-only diffs with zero secret bytes in approval lines", () => {
    const vault = new MockVault([
      { secretId: "1", name: "RESEND_API_KEY", value: "re_secret", envScope: "prod" },
      { secretId: "2", name: "STRIPE_KEY", value: "sk_other", envScope: "prod" },
    ]);
    const controller = new NameOnlySyncEnvController(vault);
    const remote = [
      {
        name: "OLD_FLAG",
        hmac: createHash("sha256").update("old").digest("hex"),
      },
    ];
    const plan = controller.plan("demo", "prod", remote);
    expect(plan.diff.summary).toContain("names only");
    expect(plan.approvalLines).toEqual([
      "+ RESEND_API_KEY (added)",
      "+ STRIPE_KEY (added)",
      "- OLD_FLAG (removed)",
    ]);
    controller.assertNoSecretBytesInLines(plan.approvalLines);
  });

  it("hard-blocks live stripe secrets on preview", async () => {
    const vault = new MockVault([
      { secretId: "1", name: "STRIPE_KEY", value: stripeLiveSample(), envScope: "test" },
    ]);
    const controller = new NameOnlySyncEnvController(vault);
    const secrets = await vault.listSecretsForDeploy("demo", "test");
    await expect(controller.guardSecrets("preview", secrets)).rejects.toBeInstanceOf(
      LiveKeyPreviewBlockedError,
    );
  });

  it("warns/blocks test stripe secrets on production", async () => {
    const vault = new MockVault([
      { secretId: "1", name: "STRIPE_KEY", value: stripeTestSample(), envScope: "prod" },
    ]);
    const controller = new NameOnlySyncEnvController(vault);
    const secrets = await vault.listSecretsForDeploy("demo", "prod");
    await expect(controller.guardSecrets("production", secrets)).rejects.toBeInstanceOf(
      TestKeyProductionBlockedError,
    );
  });
});

describe("DeployApprovalPolicyEngine", () => {
  it("requires explicit approval for production deploy/sync/rollback", () => {
    const approval = new DeployApprovalPolicyEngine();
    expect(() =>
      assertDeployDispatchAllowed(approval, {
        effectType: "deploy",
        targetEnv: "production",
        approvalStatus: "auto_allowed",
        autoApprove: true,
      }),
    ).toThrow(ProductionRequiresExplicitApprovalError);
    expect(() =>
      assertDeployDispatchAllowed(approval, {
        effectType: "sync_env",
        targetEnv: "production",
        approvalStatus: "approved",
      }),
    ).not.toThrow();
  });
});

describe("VercelDeployAdapter", () => {
  it("probes auth, syncs env by name, deploys, reconciles, and rolls back", async () => {
    const mock = await startMockVercelServer();
    const vault = new MockVault([
      { secretId: "1", name: "RESEND_API_KEY", value: "re_123", envScope: "prod" },
    ]);
    const client = new VercelHttpClient({
      baseUrl: mock.baseUrl,
      token: "vercel-token",
      projectId: "demo",
    });
    const approval = new DeployApprovalPolicyEngine();
    const adapter = new VercelDeployAdapter({
      projectId: "demo",
      envScope: "prod",
      vault,
      client,
      approval,
    });
    const auth = await adapter.probeAuth();
    expect(auth.ok).toBe(true);
    const plan = await adapter.planDeploy("production", "abc123def456");
    expect(plan.approvalLines.some((line) => line.includes("RESEND_API_KEY"))).toBe(true);
    const diff = await adapter.planEnvSync("production", "demo", "prod");
    await adapter.syncEnv("production", "demo", "prod", diff);
    expect(mock.state.envs.has("RESEND_API_KEY")).toBe(true);
    const deployed = await adapter.deploy("production", "abc123def456", "effect-1");
    expect(deployed.deploymentId).toMatch(/^dpl_/);
    const reconcile = await adapter.reconcile("effect-1", "abc123def456");
    expect(reconcile.state).toBe("succeeded");
    const rollback = await adapter.rollback("production", deployed.previousDeploymentId ?? deployed.deploymentId, "effect-1");
    expect(rollback.liveUrl).toContain("vercel.app");
    await mock.close();
  });
});

describe("DockerOverSshDeployAdapter", () => {
  it("requires host key pinning before connect", async () => {
    const ssh = new MockSshTransport("198.51.100.12", "SHA256:demo");
    const vault = new MockVault([]);
    const adapter = new DockerOverSshDeployAdapter({
      projectId: "demo",
      envScope: "prod",
      appName: "demoapp",
      vault,
      ssh,
      knownHosts: new InMemoryKnownHostsStore(),
      approval: new DeployApprovalPolicyEngine(),
    });
    await expect(adapter.probeAuth()).rejects.toBeInstanceOf(HostKeyConfirmationRequiredError);
  });

  it("rejects shell metacharacters in image tags", () => {
    expect(() => assertShellSafeSegment("app; rm -rf /", "tag")).toThrow(ShellPathRejectedError);
  });

  it("pipes secrets via 0600 stdin env-file with zero -e argv leaks", async () => {
    const ssh = new MockSshTransport("198.51.100.12", "SHA256:demo");
    const known = new InMemoryKnownHostsStore();
    known.pin("198.51.100.12", "SHA256:demo");
    const vault = new MockVault([
      { secretId: "1", name: "API_KEY", value: "secret-value", envScope: "prod" },
    ]);
    const adapter = new DockerOverSshDeployAdapter({
      projectId: "demo",
      envScope: "prod",
      appName: "demoapp",
      vault,
      ssh,
      knownHosts: known,
      approval: new DeployApprovalPolicyEngine(),
    });
    const diff = await adapter.planEnvSync("staging", "demo", "prod");
    await adapter.syncEnv("staging", "demo", "prod", diff);
    const stdinWrites = ssh.calls.filter((item) => item.command.startsWith("install -m 600"));
    expect(stdinWrites.length).toBeGreaterThan(0);
    expect(stdinWrites[0]?.stdin).toContain("API_KEY=secret-value");
    expect(ssh.argvSecretLeaks()).toEqual([]);
    await adapter.deploy("staging", "commitsha123456", "effect-ssh-1");
    expect(ssh.argvSecretLeaks()).toEqual([]);
  });

  it("aborts swap when container health is not healthy", async () => {
    const ssh = new MockSshTransport("198.51.100.12", "SHA256:demo");
    ssh.setHealth("demoapp-commitsha123", "unhealthy");
    const known = new InMemoryKnownHostsStore();
    known.pin("198.51.100.12", "SHA256:demo");
    const vault = new MockVault([]);
    const adapter = new DockerOverSshDeployAdapter({
      projectId: "demo",
      envScope: "prod",
      appName: "demoapp",
      vault,
      ssh,
      knownHosts: known,
      approval: new DeployApprovalPolicyEngine(),
    });
    await expect(adapter.deploy("staging", "commitsha123456", "effect-ssh-2")).rejects.toBeInstanceOf(
      UnhealthySwapAbortedError,
    );
  });

  it("rolls back to previous image tag", async () => {
    const ssh = new MockSshTransport("198.51.100.12", "SHA256:demo");
    const known = new InMemoryKnownHostsStore();
    known.pin("198.51.100.12", "SHA256:demo");
    const vault = new MockVault([]);
    const adapter = new DockerOverSshDeployAdapter({
      projectId: "demo",
      envScope: "prod",
      appName: "demoapp",
      vault,
      ssh,
      knownHosts: known,
      approval: new DeployApprovalPolicyEngine(),
    });
    await adapter.deploy("staging", "commitsha123456", "effect-ssh-3");
    const rollback = await adapter.rollback("staging", "previousSha", "effect-ssh-3");
    expect(rollback.liveUrl).toContain("198.51.100.12");
    expect(ssh.calls.some((item) => item.command.includes("rollback-previousSha"))).toBe(true);
  });

  it("changes the approval hash when envDiff changes", async () => {
    const known = new InMemoryKnownHostsStore();
    known.pin("198.51.100.12", "SHA256:demo");
    const shared = {
      projectId: "demo",
      envScope: "prod",
      appName: "demoapp",
      knownHosts: known,
      approval: new DeployApprovalPolicyEngine(),
    };
    const empty = new DockerOverSshDeployAdapter({
      ...shared,
      vault: new MockVault([]),
      ssh: new MockSshTransport("198.51.100.12", "SHA256:demo"),
    });
    const withName = new DockerOverSshDeployAdapter({
      ...shared,
      vault: new MockVault([
        { secretId: "1", name: "RESEND_API_KEY", value: "re_123", envScope: "prod" },
      ]),
      ssh: new MockSshTransport("198.51.100.12", "SHA256:demo"),
    });
    const commitSha = "abc123def456";
    const first = await empty.planDeploy("production", commitSha);
    const second = await withName.planDeploy("production", commitSha);
    const hashOf = (lines: readonly string[]): string => {
      const line = lines.find((item) => item.startsWith("payload "));
      return line ? line.slice("payload ".length) : "";
    };
    const firstHash = hashOf(first.approvalLines);
    const secondHash = hashOf(second.approvalLines);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(secondHash).toMatch(/^[a-f0-9]{64}$/);
    expect(firstHash).not.toBe(secondHash);
    expect(firstHash).not.toBe(commitSha);
    expect(secondHash).not.toBe(commitSha);
  });
});