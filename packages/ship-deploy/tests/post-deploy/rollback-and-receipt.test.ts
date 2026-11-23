import { afterEach, describe, expect, it } from "vitest";
import {
  EnvironmentRollbackPolicyController,
  InMemoryCasBlobStore,
  InMemoryPostDeployStore,
  InMemoryProductionAlertCardSink,
  PostDeployReleaseGate,
  createFallbackPacketSecurityRedactor,
  defaultEnvApprovalPolicy,
  developerEnabledProductionAutoRollbackPolicy,
} from "../../src/post-deploy/index.js";
import type { HostObservabilitySource } from "../../src/post-deploy/index.js";
import {
  NEW_SHA,
  OLD_SHA,
  PREVIOUS_SHA,
  RecordingAdapter,
  RecordingLedger,
  createAutoAdvanceClock,
  healthySample,
  spikeSample,
  startMockDeploy,
  syntheticLiveKey,
  type MockDeploy,
} from "./helpers.js";

const redactor = createFallbackPacketSecurityRedactor();
let app: MockDeploy | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("post-deploy rollback policy and shipped receipt", () => {
  it("does not dispatch a rollback when the effect ledger refuses to dispatch", async () => {
    const order: string[] = [];
    const ledger = new RecordingLedger();
    ledger.markDispatched = async (effectId) => {
      order.push(`dispatch:${effectId}`);
      throw new Error("writer epoch fence");
    };
    const adapter = new RecordingAdapter(() => {
      order.push("rollback");
      return { deploymentId: "prev", liveUrl: "http://127.0.0.1:9", buildId: PREVIOUS_SHA };
    });
    const controller = new EnvironmentRollbackPolicyController({
      adapter,
      ledger,
      policy: defaultEnvApprovalPolicy(),
      cards: new InMemoryProductionAlertCardSink(),
      redactor,
    });
    await expect(
      controller.handle({
        shipRunId: "ship-fence",
        env: "staging",
        commitSha: NEW_SHA,
        liveUrl: "http://127.0.0.1:9",
        deploymentId: "dep-new",
        previousSha: PREVIOUS_SHA,
        previousDeploymentId: "dep-prev",
        failingCheck: "health",
        consoleErrors: [],
        redactedLogs: "",
        screenshotSha256: null,
      }),
    ).rejects.toThrow(/writer epoch fence/);
    expect(order).toEqual(["dispatch:eff-1"]);
    expect(ledger.events[0]).toBe("plan:auto_allowed");
    expect(adapter.calls).toHaveLength(0);
  });

  it("auto-rolls preview and staging, then confirms the previous release is healthy", async () => {
    app = await startMockDeploy({ buildId: OLD_SHA });
    const order: string[] = [];
    const ledger = new RecordingLedger();
    const originalDispatch = ledger.markDispatched.bind(ledger);
    ledger.markDispatched = async (effectId) => {
      order.push("dispatch");
      await originalDispatch(effectId);
    };
    const adapter = new RecordingAdapter(() => {
      order.push("rollback");
      app?.setBuildId(PREVIOUS_SHA);
      return { deploymentId: "dep-prev", liveUrl: app?.origin ?? "", buildId: PREVIOUS_SHA };
    });
    const gate = gateWith(ledger, adapter, {
      kind: "vercel-metrics",
      poll: async () => healthySample(),
    });
    const outcome = await gate.run({
      shipRunId: "ship-preview",
      env: "preview",
      commitSha: NEW_SHA,
      liveUrl: app.origin,
      deploymentId: "dep-new",
      previousSha: PREVIOUS_SHA,
      previousDeploymentId: "dep-prev",
      healthMaxWaitMs: 40,
      healthIntervalMs: 10,
    });
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.previousHealthy).toBe(true);
    expect(outcome.state).toBe("ROLLED_BACK");
    expect(outcome.receipt.rollbackTargetId).toBe("dep-prev");
    expect(order.indexOf("dispatch")).toBeLessThan(order.indexOf("rollback"));
    expect(ledger.events[0]).toBe("plan:auto_allowed");
    expect(adapter.calls[0]?.env).toBe("preview");
  });

  it("rolls staging back when the minute-4 5xx spike arrives and redacts runtime logs", async () => {
    app = await startMockDeploy();
    const clock = createAutoAdvanceClock();
    const secret = syntheticLiveKey();
    const cas = new InMemoryCasBlobStore();
    const ledger = new RecordingLedger();
    const adapter = new RecordingAdapter(() => {
      app?.setBuildId(PREVIOUS_SHA);
      return { deploymentId: "dep-prev", liveUrl: app?.origin ?? "", buildId: PREVIOUS_SHA };
    });
    const gate = new PostDeployReleaseGate({
      adapter,
      ledger,
      policy: defaultEnvApprovalPolicy(),
      cards: new InMemoryProductionAlertCardSink(),
      source: {
        kind: "docker-logs",
        poll: async (input) => {
          expect(input.pollCommand.startsWith("docker logs --since ")).toBe(true);
          if (clock.now() >= 4 * 60 * 1000) return spikeSample(`token ${secret}`);
          return healthySample();
        },
      },
      connectivity: { isOnline: () => true },
      store: new InMemoryPostDeployStore(),
      redactor,
      cas,
      clock,
    });
    const outcome = await gate.run({
      shipRunId: "ship-staging",
      env: "staging",
      commitSha: NEW_SHA,
      liveUrl: app.origin,
      deploymentId: "dep-new",
      previousSha: PREVIOUS_SHA,
      previousDeploymentId: "dep-prev",
      containerName: "kitchen",
    });
    expect(outcome.state).toBe("ROLLED_BACK");
    expect(outcome.previousHealthy).toBe(true);
    expect(outcome.receipt.tenMinWatchVerdict).toBe("breached");
    expect(outcome.watchLogs.join("\n")).not.toContain(secret);
    expect(outcome.watchLogs.join("\n")).toContain("[REDACTED:STRIPE_LIVE_KEY]");
    expect(cas.blobs.map((blob) => blob.text).join("\n")).not.toContain(secret);
    expect(adapter.calls).toHaveLength(1);
  });

  it("raises a production P0 card and rolls back only after approval", async () => {
    app = await startMockDeploy({ ordersBroken: true });
    const cards = new InMemoryProductionAlertCardSink();
    const ledger = new RecordingLedger();
    const adapter = new RecordingAdapter(() => {
      app?.setBuildId(PREVIOUS_SHA);
      return { deploymentId: "dep-prev", liveUrl: app?.origin ?? "", buildId: PREVIOUS_SHA };
    });
    const gate = gateWith(ledger, adapter, {
      kind: "vercel-metrics",
      poll: async () => {
        throw new Error("production watch must not start after smoke failure");
      },
    }, cards);
    const outcome = await gate.run({
      shipRunId: "ship-prod",
      env: "production",
      commitSha: NEW_SHA,
      liveUrl: app.origin,
      deploymentId: "dep-new",
      previousSha: PREVIOUS_SHA,
      previousDeploymentId: "dep-prev",
      publicRoutes: ["/orders"],
      healthMaxWaitMs: 50,
      healthIntervalMs: 10,
    });
    expect(outcome.rolledBack).toBe(false);
    expect(outcome.state).toBe("AWAITING_PROD_ROLLBACK_APPROVAL");
    expect(adapter.calls).toHaveLength(0);
    expect(ledger.events).toEqual(["plan:pending_approval"]);
    const card = cards.cards[0];
    expect(card?.severity).toBe("P0");
    expect(card?.interruptNow).toBe(true);
    expect(card?.actions[0]?.label).toBe(`Approve Rollback to ${PREVIOUS_SHA} Now`);
    expect(card?.actions[1]?.label).toBe("Investigate / Keep Live");
    expect(card?.evidence.consoleErrors.some((line) => line.includes("window is not defined"))).toBe(true);
    const approved = await gate.approveRollback(outcome.cardId ?? "");
    expect(approved.rolledBack).toBe(true);
    expect(approved.previousHealthy).toBe(true);
    expect(approved.receipt.state).toBe("ROLLED_BACK");
    expect(ledger.events).toContain("dispatch:eff-1");
    expect(adapter.calls).toHaveLength(1);
  });

  it("keeps production live when the developer investigates instead of rolling back", async () => {
    app = await startMockDeploy({ ordersBroken: true });
    const cards = new InMemoryProductionAlertCardSink();
    const adapter = new RecordingAdapter(() => {
      throw new Error("keep-live must not roll back");
    });
    const gate = gateWith(new RecordingLedger(), adapter, {
      kind: "vercel-metrics",
      poll: async () => healthySample(),
    }, cards);
    const outcome = await gate.run({
      shipRunId: "ship-keep",
      env: "production",
      commitSha: NEW_SHA,
      liveUrl: app.origin,
      deploymentId: "dep-new",
      previousSha: PREVIOUS_SHA,
      previousDeploymentId: "dep-prev",
      publicRoutes: ["/orders"],
    });
    const kept = await gate.keepLive(outcome.cardId ?? "");
    expect(kept.state).toBe("KEPT_LIVE");
    expect(kept.rolledBack).toBe(false);
    expect(adapter.calls).toHaveLength(0);
    expect(kept.notification).toContain("Investigate / Keep Live");
  });

  it("ships when the watch is clean, dismissed early, or paused because the laptop is offline", async () => {
    app = await startMockDeploy();
    const store = new InMemoryPostDeployStore();
    store.insertRegistration({
      shipRunId: "ship-clean",
      registrationType: "stripe-webhook",
      targetUrlOrDomain: "https://app.example.com/api/webhooks/stripe",
      probeStatus: "verified",
      verifiedAt: "2026-11-23T12:00:00.000Z",
      evidence: "HTTPS reachable",
    });
    const secret = syntheticLiveKey();
    const cas = new InMemoryCasBlobStore();
    const clock = createAutoAdvanceClock();
    const clean = new PostDeployReleaseGate({
      adapter: new RecordingAdapter(() => {
        throw new Error("clean ship must not roll back");
      }),
      ledger: new RecordingLedger(),
      policy: defaultEnvApprovalPolicy(),
      cards: new InMemoryProductionAlertCardSink(),
      source: { kind: "vercel-metrics", poll: async () => healthySample(`leak ${secret}`) },
      connectivity: { isOnline: () => true },
      store,
      redactor,
      cas,
      clock,
    });
    const shipped = await clean.run({
      shipRunId: "ship-clean",
      env: "staging",
      commitSha: NEW_SHA,
      liveUrl: app.origin,
      deploymentId: "dep-new",
      previousSha: PREVIOUS_SHA,
      previousDeploymentId: "dep-prev",
    });
    expect(shipped.state).toBe("SHIPPED");
    expect(shipped.receipt).toMatchObject({
      shipRunId: "ship-clean",
      env: "staging",
      commitSha: NEW_SHA,
      liveUrl: app.origin,
      deploymentId: "dep-new",
      tenMinWatchVerdict: "clean",
      rollbackTargetId: null,
    });
    expect(shipped.receipt.healthPassedAt).toEqual(expect.any(String));
    expect(shipped.receipt.smokeReceiptSha).toMatch(/^[a-f0-9]{64}$/);
    expect(shipped.receipt.registrations).toHaveLength(1);
    expect(store.getShipRun("ship-clean")?.schemaStatus).toBe("passed");
    expect(store.getShipRun("ship-clean")?.state).toBe("SHIPPED");
    expect(cas.blobs.map((blob) => blob.text).join("\n")).not.toContain(secret);

    const dismissGate = new PostDeployReleaseGate({
      adapter: new RecordingAdapter(() => {
        throw new Error("dismiss must not roll back");
      }),
      ledger: new RecordingLedger(),
      policy: defaultEnvApprovalPolicy(),
      cards: new InMemoryProductionAlertCardSink(),
      source: {
        kind: "vercel-metrics",
        poll: async () => {
          dismissGate.dismissWatchEarly();
          return healthySample();
        },
      },
      connectivity: { isOnline: () => true },
      store: new InMemoryPostDeployStore(),
      redactor,
      cas: new InMemoryCasBlobStore(),
      clock: createAutoAdvanceClock(),
    });
    const dismissed = await dismissGate.run({
      shipRunId: "ship-dismiss",
      env: "production",
      commitSha: NEW_SHA,
      liveUrl: app.origin,
      deploymentId: "dep-new",
      previousSha: PREVIOUS_SHA,
      previousDeploymentId: "dep-prev",
    });
    expect(dismissed.state).toBe("SHIPPED");
    expect(dismissed.receipt.tenMinWatchVerdict).toBe("dismissed-early");

    const offlineClock = createAutoAdvanceClock();
    const offlineGate = new PostDeployReleaseGate({
      adapter: new RecordingAdapter(() => {
        throw new Error("offline pause must not roll back");
      }),
      ledger: new RecordingLedger(),
      policy: defaultEnvApprovalPolicy(),
      cards: new InMemoryProductionAlertCardSink(),
      source: { kind: "vercel-metrics", poll: async () => healthySample() },
      connectivity: { isOnline: () => offlineClock.now() < 6 * 60 * 1000 },
      store: new InMemoryPostDeployStore(),
      redactor,
      cas: new InMemoryCasBlobStore(),
      clock: offlineClock,
    });
    const paused = await offlineGate.run({
      shipRunId: "ship-offline",
      env: "staging",
      commitSha: NEW_SHA,
      liveUrl: app.origin,
      deploymentId: "dep-new",
      previousSha: PREVIOUS_SHA,
      previousDeploymentId: "dep-prev",
    });
    expect(paused.rolledBack).toBe(false);
    expect(paused.state).toBe("WATCH_PAUSED");
    expect(paused.notification).toBe("Local internet offline — watch paused, live app unaffected");
    expect(paused.watchLogs.filter((line) => line === paused.notification)).toHaveLength(1);
  });

  it("auto-rolls production only when the developer enabled that policy", async () => {
    const cards = new InMemoryProductionAlertCardSink();
    const adapter = new RecordingAdapter(() => ({
      deploymentId: "dep-prev",
      liveUrl: "http://127.0.0.1:9",
      buildId: PREVIOUS_SHA,
    }));
    const controller = new EnvironmentRollbackPolicyController({
      adapter,
      ledger: new RecordingLedger(),
      policy: developerEnabledProductionAutoRollbackPolicy(),
      cards,
      redactor,
    });
    const decision = await controller.handle({
      shipRunId: "ship-auto-prod",
      env: "production",
      commitSha: NEW_SHA,
      liveUrl: "http://127.0.0.1:9",
      deploymentId: "dep-new",
      previousSha: PREVIOUS_SHA,
      previousDeploymentId: "dep-prev",
      failingCheck: "health",
      consoleErrors: [],
      redactedLogs: "",
      screenshotSha256: null,
    });
    expect(decision.rolledBack).toBe(true);
    expect(cards.cards).toHaveLength(0);
    expect(adapter.calls).toHaveLength(1);
  });
});

function gateWith(
  ledger: RecordingLedger,
  adapter: RecordingAdapter,
  host: HostObservabilitySource,
  cards = new InMemoryProductionAlertCardSink(),
): PostDeployReleaseGate {
  return new PostDeployReleaseGate({
    adapter,
    ledger,
    policy: defaultEnvApprovalPolicy(),
    cards,
    source: host,
    connectivity: { isOnline: () => true },
    store: new InMemoryPostDeployStore(),
    redactor,
    cas: new InMemoryCasBlobStore(),
    clock: createAutoAdvanceClock(),
  });
}
