import { describe, expect, it } from "vitest";
import {
  GitHubCopilotDeviceAuthFlow,
  ManualClock,
  ManualTimerRegistry,
  OfficialCliAuthProbe,
  RedactingAuditLog,
  assertOfficialCliArgv,
  cliReuseLabel,
} from "../../src/copilot-cursor-auth/index.js";
import {
  COPILOT_TOKEN,
  ControllableSleep,
  RecordingAgent,
  ScriptedGitHub,
  ScriptedRunner,
  ScriptedSeat,
  openCopilotStores,
  subscribedSeat,
} from "./fakes.js";

const GH_STATUS = "github.com\n  Logged in to github.com account octocat (keyring)\n";
const COPILOT_STATUS = "Logged in as octocat\n";

function setup(runner: ScriptedRunner) {
  const clock = new ManualClock();
  const { vault, connections } = openCopilotStores();
  const log = new RedactingAuditLog();
  const seat = new ScriptedSeat(subscribedSeat("octocat"));
  const flow = new GitHubCopilotDeviceAuthFlow({
    clientId: "fixture-github-oauth-app",
    scope: "read:user",
    http: new ScriptedGitHub(),
    sleep: new ControllableSleep(),
    clock,
    timers: new ManualTimerRegistry(),
    vault,
    connections,
    seat,
    cli: new OfficialCliAuthProbe(runner),
    log,
    agent: new RecordingAgent(),
  });
  return { flow, vault, connections, log, seat };
}

describe("existing Copilot and GitHub CLI auth reuse", () => {
  it("offers the signed-in GitHub account in one click and stores that token in DPAPI", async () => {
    const runner = new ScriptedRunner();
    runner.scripts.set("gh --version", { exitCode: 0, stdout: "gh version 2.40.0\n", stderr: "" });
    runner.scripts.set("gh auth status", { exitCode: 0, stdout: GH_STATUS, stderr: "" });
    runner.scripts.set("gh auth token", { exitCode: 0, stdout: `${COPILOT_TOKEN}\n`, stderr: "" });
    runner.scripts.set("copilot --version", { exitCode: 127, stdout: "", stderr: "not found" });
    const kit = setup(runner);
    const offers = await kit.flow.probeCliReuse();
    expect(runner.calls).toEqual([
      ["gh", "--version"],
      ["gh", "auth", "status"],
      ["gh", "auth", "token"],
      ["copilot", "--version"],
    ]);
    expect(offers).toEqual([
      {
        source: "gh",
        login: "octocat",
        version: "gh version 2.40.0",
        label: "Use your signed-in GitHub account (@octocat)",
      },
    ]);
    expect(offers[0]?.label).toBe(cliReuseLabel("octocat"));
    expect(JSON.stringify(offers)).not.toContain(COPILOT_TOKEN);
    const established = await kit.flow.acceptCliReuse("gh", "octocat");
    expect(kit.seat.seen).toEqual([COPILOT_TOKEN]);
    expect(established.connection.metadata).toMatchObject({
      authMode: "github_cli_reuse",
      accountLogin: "octocat",
      billingMode: "copilot_subscription",
    });
    expect(await kit.vault.readSecret(established.connection.vaultRef ?? "")).toBe(COPILOT_TOKEN);
    const persisted = [kit.connections.exportSnapshot(), kit.log.text(), kit.vault.exportAtRest()].join(
      "\n",
    );
    expect(persisted).not.toContain(COPILOT_TOKEN);
  });

  it("reuses a signed-in copilot CLI when gh is not installed", async () => {
    const runner = new ScriptedRunner();
    runner.scripts.set("gh --version", { exitCode: 127, stdout: "", stderr: "not found" });
    runner.scripts.set("copilot --version", { exitCode: 0, stdout: "copilot 1.0.0\n", stderr: "" });
    runner.scripts.set("copilot auth status", { exitCode: 0, stdout: COPILOT_STATUS, stderr: "" });
    runner.scripts.set("copilot auth token", { exitCode: 0, stdout: COPILOT_TOKEN, stderr: "" });
    const kit = setup(runner);
    const offers = await kit.flow.probeCliReuse();
    expect(runner.calls).toEqual([
      ["gh", "--version"],
      ["copilot", "--version"],
      ["copilot", "auth", "status"],
      ["copilot", "auth", "token"],
    ]);
    expect(offers.map((offer) => offer.source)).toEqual(["copilot"]);
    expect(offers[0]?.label).toBe("Use your signed-in GitHub account (@octocat)");
    const established = await kit.flow.acceptCliReuse("copilot", "octocat");
    expect(established.connection.metadata).toMatchObject({ authMode: "github_cli_reuse" });
    expect(await kit.vault.readSecret(established.connection.vaultRef ?? "")).toBe(COPILOT_TOKEN);
  });

  it("does not offer an account when the official token command is empty", async () => {
    const runner = new ScriptedRunner();
    runner.scripts.set("gh --version", { exitCode: 0, stdout: "gh version 2.40.0\n", stderr: "" });
    runner.scripts.set("gh auth status", { exitCode: 0, stdout: GH_STATUS, stderr: "" });
    runner.scripts.set("gh auth token", { exitCode: 1, stdout: "", stderr: "no token" });
    runner.scripts.set("copilot --version", { exitCode: 127, stdout: "", stderr: "not found" });
    const kit = setup(runner);
    await expect(kit.flow.probeCliReuse()).resolves.toEqual([]);
    await expect(kit.flow.acceptCliReuse("gh", "octocat")).rejects.toThrow(/No signed-in CLI/);
    expect(kit.connections.list()).toHaveLength(0);
  });

  it("drops a probed CLI token when the connection is disconnected before accept", async () => {
    const runner = new ScriptedRunner();
    runner.scripts.set("gh --version", { exitCode: 0, stdout: "gh version 2.40.0\n", stderr: "" });
    runner.scripts.set("gh auth status", { exitCode: 0, stdout: GH_STATUS, stderr: "" });
    runner.scripts.set("gh auth token", { exitCode: 0, stdout: COPILOT_TOKEN, stderr: "" });
    runner.scripts.set("copilot --version", { exitCode: 127, stdout: "", stderr: "not found" });
    const kit = setup(runner);
    await kit.flow.probeCliReuse();
    await kit.flow.disconnect("copilot-not-saved");
    await expect(kit.flow.acceptCliReuse("gh", "octocat")).rejects.toThrow(/No signed-in CLI/);
    expect(kit.vault.listPublicMetadata()).toHaveLength(0);
    expect(kit.log.text()).not.toContain(COPILOT_TOKEN);
  });

  it("refuses CLI argv that is not an official read-only auth probe", () => {
    expect(() => assertOfficialCliArgv(["gh", "--version"])).not.toThrow();
    expect(() => assertOfficialCliArgv(["copilot", "auth", "status"])).not.toThrow();
    expect(() => assertOfficialCliArgv(["gh", "api", "user"])).toThrow(/official read-only/);
    expect(() => assertOfficialCliArgv(["gh", "auth", "token", "--show"])).toThrow(/official read-only/);
  });
});
