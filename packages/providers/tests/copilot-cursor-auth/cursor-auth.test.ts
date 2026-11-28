import { describe, expect, it } from "vitest";
import {
  CURSOR_KEY_LIFETIME_MS,
  CursorAuthCancelledError,
  CursorBrowserAuthFlow,
  CursorKeyExpiryReminderScheduler,
  CursorUnauthorizedError,
  DAY_MS,
  ManualClock,
  ManualTimerRegistry,
  RedactingAuditLog,
} from "../../src/copilot-cursor-auth/index.js";
import {
  CURSOR_KEY,
  CURSOR_KEY_NEXT,
  RecordingAccounts,
  RecordingAgent,
  RecordingFallback,
  RecordingParker,
  RecordingReminders,
  ScriptedCursor,
  openCopilotStores,
} from "./fakes.js";

const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

function setup() {
  const clock = new ManualClock(0);
  const timers = new ManualTimerRegistry();
  const { vault, connections } = openCopilotStores();
  const log = new RedactingAuditLog();
  const agent = new RecordingAgent();
  const cursor = new ScriptedCursor();
  cursor.keys = [CURSOR_KEY, CURSOR_KEY_NEXT];
  const flow = new CursorBrowserAuthFlow({
    cursor,
    clock,
    timers,
    vault,
    connections,
    log,
    agent,
  });
  const reminders = new RecordingReminders();
  const accounts = new RecordingAccounts();
  const parker = new RecordingParker();
  const fallback = new RecordingFallback();
  const scheduler = new CursorKeyExpiryReminderScheduler({
    connections,
    clock,
    reminders,
    accounts,
    parker,
    fallbackGuard: fallback,
    auth: flow,
  });
  return { clock, timers, vault, connections, log, agent, cursor, flow, reminders, accounts, parker, fallback, scheduler };
}

function persisted(kit: ReturnType<typeof setup>): string {
  return [kit.connections.exportSnapshot(), kit.log.text(), kit.vault.exportAtRest()].join("\n");
}

describe("Cursor browser auth and 7-day expiry reminder", () => {
  it("persists a 90-day key from Cursor.auth.login in DPAPI and validates usage", async () => {
    const kit = setup();
    const established = await kit.flow.login();
    expect(kit.agent.opens).toEqual([
      { url: "https://authenticator.cursor.sh/fixture-login", channel: "os_browser" },
    ]);
    expect(kit.cursor.opened).toEqual(["https://authenticator.cursor.sh/fixture-login"]);
    const metadata = established.connection.metadata;
    expect(metadata.kind).toBe("cursor");
    if (metadata.kind !== "cursor") return;
    expect(metadata.expiresAt - metadata.issuedAt).toBe(CURSOR_KEY_LIFETIME_MS);
    expect(metadata.issuedAt).toBe(0);
    expect(metadata.expiresAt).toBe(90 * DAY_MS);
    expect(metadata.billingMode).toBe("cursor_subscription");
    expect(metadata.authMode).toBe("cursor_browser");
    expect(established.connection.route).toBe("cursor_sdk");
    expect(established.connection.currency).toBe(`allowance:${established.connection.id}`);
    expect(await kit.vault.readSecret(established.connection.vaultRef ?? "")).toBe(CURSOR_KEY);
    expect(persisted(kit)).not.toContain(CURSOR_KEY);
    expect(JSON.stringify(kit.vault.listPublicMetadata())).not.toContain(CURSOR_KEY);
    expect(kit.timers.activeCount()).toBe(0);
  });

  it("cancels an in-progress browser login without a half-saved connection", async () => {
    const kit = setup();
    kit.cursor.hang = true;
    const pending = kit.flow.login();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(kit.agent.opens[0]?.channel).toBe("os_browser");
    expect(kit.timers.activeCount()).toBe(1);
    kit.flow.cancel();
    await expect(pending).rejects.toBeInstanceOf(CursorAuthCancelledError);
    expect(kit.connections.list()).toHaveLength(0);
    expect(kit.vault.listPublicMetadata()).toHaveLength(0);
    expect(kit.timers.activeCount()).toBe(0);
  });

  it("does not save a connection when Agent.getUsage returns 401", async () => {
    const kit = setup();
    kit.cursor.usage = { ok: false, status: 401, message: "unauthorized" };
    await expect(kit.flow.login()).rejects.toBeInstanceOf(CursorUnauthorizedError);
    expect(kit.connections.list()).toHaveLength(0);
    expect(kit.vault.exportAtRest()).not.toContain(CURSOR_KEY);
  });

  it("stays quiet on day 82 and emits one calm reminder from day 83", async () => {
    const kit = setup();
    const established = await kit.flow.login();
    const id = established.connection.id;
    kit.clock.set(82 * DAY_MS);
    expect(kit.scheduler.onColdOpen()).toEqual([]);
    expect(kit.reminders.cards).toHaveLength(0);
    kit.clock.set(83 * DAY_MS);
    const notices = kit.scheduler.onDailyTick();
    expect(notices).toHaveLength(1);
    expect(notices[0]?.card).toMatchObject({
      kind: "fyi_account_reminder",
      blocking: false,
      tone: "calm",
      phase: "seven_day",
      actionLabel: "Refresh now",
      message: "Your Cursor key expires in 7 days — Refresh in 1 click",
    });
    expect(kit.scheduler.onDailyTick()).toEqual([]);
    expect(kit.scheduler.onColdOpen()).toEqual([]);
    expect(kit.reminders.cards).toHaveLength(1);
    expect(kit.connections.get(id)?.route).toBe("cursor_sdk");
  });

  it("emits one 6-day reminder on day 84, stays quiet after acknowledgement, and speaks again inside 48 hours", async () => {
    const kit = setup();
    const established = await kit.flow.login();
    const id = established.connection.id;
    kit.clock.set(84 * DAY_MS);
    const first = kit.scheduler.onColdOpen();
    expect(first).toHaveLength(1);
    expect(first[0]?.card).toMatchObject({
      message: "Your Cursor key expires in 6 days — Refresh in 1 click",
      actionLabel: "Refresh now",
      blocking: false,
      tone: "calm",
    });
    expect(kit.scheduler.onDailyTick()).toEqual([]);
    kit.scheduler.acknowledge(id);
    expect(kit.scheduler.onColdOpen()).toEqual([]);
    kit.clock.set(90 * DAY_MS - FORTY_EIGHT_HOURS);
    const urgent = kit.scheduler.onDailyTick();
    expect(urgent).toHaveLength(1);
    expect(urgent[0]?.kind).toBe("reminder");
    if (urgent[0]?.kind === "reminder") expect(urgent[0].card.phase).toBe("urgent");
    expect(kit.scheduler.onDailyTick()).toEqual([]);
    expect(kit.reminders.cards).toHaveLength(2);
  });

  it("refreshes the key in place and resets expiry by 90 days", async () => {
    const kit = setup();
    const established = await kit.flow.login();
    const id = established.connection.id;
    const previousVault = established.connection.vaultRef ?? "";
    kit.clock.set(84 * DAY_MS);
    kit.scheduler.onColdOpen();
    const refreshed = await kit.scheduler.refreshNow(id);
    const metadata = refreshed.connection.metadata;
    expect(metadata.kind).toBe("cursor");
    if (metadata.kind !== "cursor") return;
    expect(metadata.issuedAt).toBe(84 * DAY_MS);
    expect(metadata.expiresAt - kit.clock.now()).toBe(CURSOR_KEY_LIFETIME_MS);
    expect(metadata.status).toBe("active");
    expect(refreshed.connection.enabled).toBe(1);
    expect(refreshed.connection.createdAt).toBe(0);
    expect(await kit.vault.readSecret(previousVault)).toBeNull();
    expect(await kit.vault.readSecret(refreshed.connection.vaultRef ?? "")).toBe(CURSOR_KEY_NEXT);
    expect(kit.scheduler.onColdOpen()).toEqual([]);
    expect(persisted(kit)).not.toContain(CURSOR_KEY);
    expect(persisted(kit)).not.toContain(CURSOR_KEY_NEXT);
  });

  it("parks on day 90 and on 401 without falling back to a paid API key", async () => {
    const kit = setup();
    const established = await kit.flow.login();
    const id = established.connection.id;
    kit.clock.set(90 * DAY_MS);
    const expired = kit.scheduler.onColdOpen();
    expect(expired[0]?.card).toMatchObject({
      kind: "AccountCard",
      actionLabel: "Re-sign in with Cursor",
      blocking: true,
      reason: "expired",
    });
    expect(kit.parker.events).toEqual([{ connectionId: id, reason: "expired" }]);
    expect(kit.fallback.events).toEqual([
      { connectionId: id, from: "cursor_subscription", to: "paid_api_key" },
    ]);
    const parked = kit.connections.get(id);
    expect(parked?.route).toBe("cursor_sdk");
    expect(parked?.currency.startsWith("allowance:")).toBe(true);
    expect(parked?.enabled).toBe(0);
    expect(parked?.metadata).toMatchObject({ status: "expired" });
    expect(kit.scheduler.onDailyTick()).toEqual([]);
    expect(kit.accounts.cards).toHaveLength(1);

    const fresh = setup();
    const second = await fresh.flow.login();
    const unauthorized = fresh.scheduler.onHttp401(second.connection.id);
    expect(unauthorized.card).toMatchObject({
      kind: "AccountCard",
      actionLabel: "Re-sign in with Cursor",
      reason: "unauthorized",
    });
    expect(fresh.parker.events).toEqual([
      { connectionId: second.connection.id, reason: "unauthorized" },
    ]);
    expect(fresh.fallback.events).toHaveLength(1);
    expect(fresh.connections.get(second.connection.id)?.route).toBe("cursor_sdk");
    fresh.scheduler.onHttp401(second.connection.id);
    expect(fresh.accounts.cards).toHaveLength(1);
    expect(persisted(fresh)).not.toContain(CURSOR_KEY);
  });

  it("disconnect wipes the Cursor key immediately", async () => {
    const kit = setup();
    const established = await kit.flow.login();
    const vaultRef = established.connection.vaultRef ?? "";
    await kit.flow.disconnect(established.connection.id);
    expect(kit.connections.list()).toHaveLength(0);
    expect(await kit.vault.readSecret(vaultRef)).toBeNull();
    expect(kit.vault.exportAtRest()).not.toContain(CURSOR_KEY);
    expect(kit.log.text()).not.toContain(CURSOR_KEY);
  });
});
