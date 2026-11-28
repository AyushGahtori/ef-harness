import { describe, expect, it } from "vitest";
import {
  COPY_AND_OPEN_BUTTON_LABEL,
  DEVICE_CODE_GRANT_TYPE,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_DEVICE_TOKEN_URL,
  GITHUB_DEVICE_VERIFICATION_URL,
  GitHubCopilotDeviceAuthFlow,
  ManualClock,
  ManualTimerRegistry,
  OrgPolicyBlockedError,
  RedactingAuditLog,
  interpretCopilotSeatHttp,
  CopilotPlanCostWeighting,
  LocalSignedProviderPolicy,
  NoCopilotEntitlementError,
  DeviceFlowCancelledError,
  DeviceFlowDeniedError,
  DeviceFlowExpiredError,
} from "../../src/copilot-cursor-auth/index.js";
import {
  AbsentCli,
  COPILOT_TOKEN,
  COPILOT_TOKEN_OTHER,
  ControllableSleep,
  DEVICE_CODE,
  RecordingAgent,
  ScriptedGitHub,
  ScriptedSeat,
  deviceCodeBody,
  openCopilotStores,
  releasePoll,
  subscribedSeat,
} from "./fakes.js";

function setup(seat = new ScriptedSeat(subscribedSeat("octocat"))) {
  const clock = new ManualClock();
  const sleep = new ControllableSleep();
  const timers = new ManualTimerRegistry();
  const { vault, connections } = openCopilotStores();
  const log = new RedactingAuditLog();
  const http = new ScriptedGitHub();
  const agent = new RecordingAgent();
  const flow = new GitHubCopilotDeviceAuthFlow({
    clientId: "fixture-github-oauth-app",
    scope: "read:user",
    http,
    sleep,
    clock,
    timers,
    vault,
    connections,
    seat,
    cli: new AbsentCli(),
    log,
    agent,
  });
  return { clock, sleep, timers, vault, connections, log, http, seat, agent, flow };
}

function secretFree(text: string, ...secrets: string[]): void {
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

function capture<T>(promise: Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; error: unknown }
> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
}

describe("GitHub Copilot device flow", () => {
  it("walks authorization_pending, slow_down, then success and stores only a vault reference", async () => {
    const kit = setup();
    kit.http.deviceResponses.push(deviceCodeBody());
    kit.http.pollResponses.push(
      { error: "authorization_pending" },
      { error: "slow_down" },
      { access_token: COPILOT_TOKEN },
    );
    const session = await kit.flow.beginDeviceFlow();
    expect(session.prompt.userCode).toBe("ABCD2345");
    expect(session.prompt.userCode).toHaveLength(8);
    expect(session.prompt.buttonLabel).toBe(COPY_AND_OPEN_BUTTON_LABEL);
    expect(session.prompt.verificationUrl).toBe(GITHUB_DEVICE_VERIFICATION_URL);
    const activated = session.prompt.activateCopyAndOpen();
    expect(activated).toEqual({
      copiedText: "ABCD2345",
      openedUrl: "https://github.com/login/device",
    });
    expect(kit.agent.opens).toEqual([
      { url: "https://github.com/login/device", channel: "os_browser" },
    ]);

    expect(await releasePoll(kit.sleep, kit.clock)).toBe(5_000);
    expect(await releasePoll(kit.sleep, kit.clock)).toBe(5_000);
    expect(await releasePoll(kit.sleep, kit.clock)).toBe(10_000);
    const established = await session.waitForAuthorization();

    expect(kit.sleep.delays).toEqual([5_000, 5_000, 10_000]);
    expect(kit.http.posts[0]).toMatchObject({
      url: GITHUB_DEVICE_CODE_URL,
      body: { client_id: "fixture-github-oauth-app", scope: "read:user" },
    });
    const tokenPosts = kit.http.posts.filter((post) => post.url === GITHUB_DEVICE_TOKEN_URL);
    expect(tokenPosts).toHaveLength(3);
    expect(tokenPosts[0]?.body.grant_type).toBe(DEVICE_CODE_GRANT_TYPE);
    expect(tokenPosts[0]?.body.device_code).toBe(DEVICE_CODE);
    expect(kit.seat.seen).toEqual([COPILOT_TOKEN]);
    expect(established.connection.vaultRef).toMatch(/^vault:gitHubToken:copilot-octocat:/);
    expect(await kit.vault.readSecret(established.connection.vaultRef ?? "")).toBe(COPILOT_TOKEN);
    expect(established.connection.route).toBe("copilot_sdk");
    expect(established.connection.currency).toBe(`allowance:${established.connection.id}`);
    expect(established.connection.metadata).toMatchObject({
      kind: "copilot",
      authMode: "github_device_flow",
      billingMode: "copilot_subscription",
      accountLogin: "octocat",
    });
    const persisted = [
      kit.connections.exportSnapshot(),
      kit.log.text(),
      kit.vault.exportAtRest(),
      JSON.stringify(kit.vault.listPublicMetadata()),
    ].join("\n");
    secretFree(persisted, COPILOT_TOKEN, DEVICE_CODE);
    expect(kit.timers.activeCount()).toBe(0);
    expect(kit.flow.pendingDeviceFlowCount()).toBe(0);
  });

  it("stops on expired_token and offers a new code without another poll", async () => {
    const kit = setup();
    kit.http.deviceResponses.push(deviceCodeBody(), deviceCodeBody("ZXCV9876"));
    kit.http.pollResponses.push({ error: "expired_token" });
    const session = await kit.flow.beginDeviceFlow();
    const pending = capture(session.waitForAuthorization());
    expect(await releasePoll(kit.sleep, kit.clock)).toBe(5_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DeviceFlowExpiredError);
      expect(result.error).toMatchObject({ retryAction: "Generate new code" });
    }
    expect(kit.http.tokenPosts()).toBe(1);
    expect(kit.sleep.pendingCount).toBe(0);
    expect(kit.connections.list()).toHaveLength(0);
    expect(kit.vault.listPublicMetadata()).toHaveLength(0);
    const again = await kit.flow.beginDeviceFlow();
    expect(again.prompt.userCode).toBe("ZXCV9876");
    kit.flow.cancel(again.sessionId);
    await expect(again.waitForAuthorization()).rejects.toBeInstanceOf(DeviceFlowCancelledError);
  });

  it("stops when the 15 minute grant elapses before the browser confirmation", async () => {
    const kit = setup();
    kit.http.deviceResponses.push(deviceCodeBody("ABCD2345", 15, 5));
    kit.http.pollResponses.push(
      { error: "authorization_pending" },
      { error: "authorization_pending" },
      { error: "authorization_pending" },
    );
    const session = await kit.flow.beginDeviceFlow();
    const pending = capture(session.waitForAuthorization());
    expect(await releasePoll(kit.sleep, kit.clock)).toBe(5_000);
    expect(await releasePoll(kit.sleep, kit.clock)).toBe(5_000);
    expect(await releasePoll(kit.sleep, kit.clock)).toBe(5_000);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DeviceFlowExpiredError);
    expect(kit.http.tokenPosts()).toBe(2);
    expect(kit.sleep.pendingCount).toBe(0);
    expect(kit.connections.list()).toHaveLength(0);
    expect(kit.timers.activeCount()).toBe(0);
  });

  it("cancels a poll immediately and leaves no connection, timer, or extra request", async () => {
    const kit = setup();
    kit.http.deviceResponses.push(deviceCodeBody());
    const session = await kit.flow.beginDeviceFlow();
    const pending = session.waitForAuthorization();
    expect(kit.timers.activeCount()).toBe(1);
    kit.flow.cancel(session.sessionId);
    await expect(pending).rejects.toBeInstanceOf(DeviceFlowCancelledError);
    expect(kit.http.tokenPosts()).toBe(0);
    expect(kit.connections.list()).toHaveLength(0);
    expect(kit.vault.listPublicMetadata()).toHaveLength(0);
    expect(kit.timers.activeCount()).toBe(0);
    expect(kit.sleep.pendingCount).toBe(0);
    expect(kit.flow.pendingDeviceFlowCount()).toBe(0);
  });

  it("does not save a connection when cancel wins the race after the token arrives", async () => {
    const seat = new ScriptedSeat(subscribedSeat("octocat"));
    let releaseSeat = (): void => undefined;
    seat.gate = new Promise((resolve) => {
      releaseSeat = resolve;
    });
    const kit = setup(seat);
    kit.http.deviceResponses.push(deviceCodeBody());
    kit.http.pollResponses.push({ access_token: COPILOT_TOKEN });
    const session = await kit.flow.beginDeviceFlow();
    const pending = capture(session.waitForAuthorization());
    await releasePoll(kit.sleep, kit.clock);
    expect(kit.seat.seen).toEqual([COPILOT_TOKEN]);
    kit.flow.cancel(session.sessionId);
    releaseSeat();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(DeviceFlowCancelledError);
    expect(kit.connections.list()).toHaveLength(0);
    expect(kit.vault.listPublicMetadata()).toHaveLength(0);
    expect(kit.timers.activeCount()).toBe(0);
  });

  it("explains a missing Copilot seat during onboarding and saves nothing", async () => {
    const seat = new ScriptedSeat(
      interpretCopilotSeatHttp(200, { entitlement: false, login: "octocat" }),
    );
    const kit = setup(seat);
    kit.http.deviceResponses.push(deviceCodeBody());
    kit.http.pollResponses.push({ access_token: COPILOT_TOKEN });
    const session = await kit.flow.beginDeviceFlow();
    const pending = capture(session.waitForAuthorization());
    await releasePoll(kit.sleep, kit.clock);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NoCopilotEntitlementError);
      expect(result.error).toBeInstanceOf(Error);
      if (result.error instanceof Error) {
        expect(result.error.message).toMatch(/no_copilot_entitlement/);
        expect(result.error.message).toMatch(/@octocat/);
      }
    }
    expect(kit.connections.list()).toHaveLength(0);
    expect(kit.vault.listPublicMetadata()).toHaveLength(0);
    secretFree(kit.connections.exportSnapshot() + kit.log.text(), COPILOT_TOKEN);
  });

  it("surfaces an organization policy message instead of a generic 403 and stores the allowed model subset", async () => {
    const orgMessage = "Acme Corp policy blocks third-party OAuth apps from using claude-sonnet";
    const blocked = interpretCopilotSeatHttp(403, { message: orgMessage, login: "octocat" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.message).toBe(orgMessage);
      expect(blocked.message).not.toBe("403");
    }
    const denied = setup(new ScriptedSeat(blocked));
    denied.http.deviceResponses.push(deviceCodeBody());
    denied.http.pollResponses.push({ access_token: COPILOT_TOKEN });
    const deniedSession = await denied.flow.beginDeviceFlow();
    const deniedPending = capture(deniedSession.waitForAuthorization());
    await releasePoll(denied.sleep, denied.clock);
    const deniedResult = await deniedPending;
    expect(deniedResult.ok).toBe(false);
    if (!deniedResult.ok) {
      expect(deniedResult.error).toBeInstanceOf(OrgPolicyBlockedError);
      expect(deniedResult.error).toBeInstanceOf(Error);
      if (deniedResult.error instanceof Error) expect(deniedResult.error.message).toBe(orgMessage);
    }
    expect(denied.connections.list()).toHaveLength(0);

    const allowed = ["included-fast", "standard-chat"];
    const restricted = setup(
      new ScriptedSeat(subscribedSeat("octocat", allowed, orgMessage)),
    );
    restricted.http.deviceResponses.push(deviceCodeBody("ZXCV9876"));
    restricted.http.pollResponses.push({ access_token: COPILOT_TOKEN_OTHER });
    const session = await restricted.flow.beginDeviceFlow();
    const pending = session.waitForAuthorization();
    await releasePoll(restricted.sleep, restricted.clock);
    const established = await pending;
    expect(established.connection.metadata).toMatchObject({
      orgPolicyMessage: orgMessage,
      allowedModels: allowed,
    });
    const choice = new CopilotPlanCostWeighting(new LocalSignedProviderPolicy()).select({
      preset: "balanced",
      difficulty: "senior",
      allowedModels:
        established.connection.metadata.kind === "copilot"
          ? established.connection.metadata.allowedModels
          : [],
    });
    expect(choice.modelId).not.toBe("claude-sonnet");
    expect(choice.multiplier).toBe(1);
  });

  it("stops on access_denied without a half-saved connection", async () => {
    const kit = setup();
    kit.http.deviceResponses.push(deviceCodeBody());
    kit.http.pollResponses.push({
      error: "access_denied",
      error_description: "The user denied the device prompt",
    });
    const session = await kit.flow.beginDeviceFlow();
    const pending = capture(session.waitForAuthorization());
    await releasePoll(kit.sleep, kit.clock);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(DeviceFlowDeniedError);
      expect(result.error).toBeInstanceOf(Error);
      if (result.error instanceof Error) {
        expect(result.error.message).toBe("The user denied the device prompt");
      }
    }
    expect(kit.connections.list()).toHaveLength(0);
    expect(kit.vault.listPublicMetadata()).toHaveLength(0);
  });

  it("rejects a user code that is not 8 characters before polling", async () => {
    const kit = setup();
    kit.http.deviceResponses.push({ ...deviceCodeBody(), user_code: "ABC" });
    await expect(kit.flow.beginDeviceFlow()).rejects.toThrow(/8 characters/);
    expect(kit.timers.activeCount()).toBe(0);
    expect(kit.http.tokenPosts()).toBe(0);
    expect(kit.connections.list()).toHaveLength(0);
  });

  it("keeps two GitHub accounts as separate connections", async () => {
    const seat = new ScriptedSeat(subscribedSeat("octocat"));
    const kit = setup(seat);
    kit.http.deviceResponses.push(deviceCodeBody(), deviceCodeBody("ZXCV9876"));
    kit.http.pollResponses.push(
      { access_token: COPILOT_TOKEN },
      { access_token: COPILOT_TOKEN_OTHER },
    );
    const firstSession = await kit.flow.beginDeviceFlow();
    const firstPending = firstSession.waitForAuthorization();
    await releasePoll(kit.sleep, kit.clock);
    const first = await firstPending;
    seat.decision = subscribedSeat("hubot");
    const secondSession = await kit.flow.beginDeviceFlow();
    const secondPending = secondSession.waitForAuthorization();
    await releasePoll(kit.sleep, kit.clock);
    const second = await secondPending;
    expect(first.connection.id).toBe("copilot-octocat");
    expect(second.connection.id).toBe("copilot-hubot");
    expect(await kit.vault.readSecret(first.connection.vaultRef ?? "")).toBe(COPILOT_TOKEN);
    expect(await kit.vault.readSecret(second.connection.vaultRef ?? "")).toBe(COPILOT_TOKEN_OTHER);
    secretFree(kit.connections.exportSnapshot(), COPILOT_TOKEN, COPILOT_TOKEN_OTHER);
  });

  it("disconnect wipes the DPAPI entry and cancels a pending poller", async () => {
    const kit = setup();
    kit.http.deviceResponses.push(deviceCodeBody(), deviceCodeBody("ZXCV9876"));
    kit.http.pollResponses.push({ access_token: COPILOT_TOKEN });
    const session = await kit.flow.beginDeviceFlow();
    const pending = session.waitForAuthorization();
    await releasePoll(kit.sleep, kit.clock);
    const established = await pending;
    const vaultRef = established.connection.vaultRef ?? "";
    const hanging = await kit.flow.beginDeviceFlow();
    const hangingResult = hanging.waitForAuthorization();
    expect(kit.timers.activeCount()).toBe(1);
    await kit.flow.disconnect(established.connection.id);
    await expect(hangingResult).rejects.toBeInstanceOf(DeviceFlowCancelledError);
    expect(kit.connections.get(established.connection.id)).toBeNull();
    expect(await kit.vault.readSecret(vaultRef)).toBeNull();
    expect(kit.vault.exportAtRest()).not.toContain(COPILOT_TOKEN);
    expect(kit.connections.exportSnapshot()).not.toContain(COPILOT_TOKEN);
    expect(kit.timers.activeCount()).toBe(0);
    expect(kit.flow.pendingDeviceFlowCount()).toBe(0);
  });
});
