import { describe, expect, it, vi } from "vitest";
import {
  BlindUnknownOutcomeRetryForbiddenError,
  EnvApprovalPolicyEngine,
  ExternalEffectLedger,
  LeaseEpochFenceError,
  PayloadHashMismatchError,
  ProductionAlwaysRequiresExplicitApprovalError,
  SqliteEffectStore,
  UnknownOutcomeReconciler,
  assertNoRawSecretsInPayload,
  canonicalPayloadHash,
} from "../../src/effects/index.js";

function createLedger(now = 1_700_000_000_000): ExternalEffectLedger {
  const store = new SqliteEffectStore({ now: () => now });
  return new ExternalEffectLedger({ store, now: () => now });
}

describe("ExternalEffectLedger", () => {
  it("persists write-ahead planned → dispatched before the network executor runs", async () => {
    const ledger = createLedger();
    const payload = { commitSha: "abc123", branch: "harness/f/F12" };
    const record = ledger.recordPlanned({
      effectType: "git_push",
      targetEnv: "git_remote",
      payload,
      idempotencyKey: "push-abc",
      writerEpoch: 5,
    });
    ledger.approveEffect(record.effectId, record.canonicalPayloadHash);
    let sawSent = false;
    await ledger.dispatchEffect(record.effectId, 5, async () => {
      const row = ledger.store.get(record.effectId)!;
      expect(row.execStatus).toBe("dispatched");
      sawSent = true;
      return { remoteSha: "abc123" };
    });
    expect(sawSent).toBe(true);
    const finalRow = ledger.store.get(record.effectId)!;
    expect(finalRow.execStatus).toBe("succeeded");
    expect(finalRow.remoteReceiptJson).toEqual({ remoteSha: "abc123" });
  });

  it("replays cached receipt for identical idempotency key and hash without duplicate network calls", async () => {
    const ledger = createLedger();
    const payload = { commitSha: "abc123" };
    const intent = {
      effectType: "deploy_preview",
      targetEnv: "preview" as const,
      payload,
      idempotencyKey: "dep-abc123",
      writerEpoch: 3,
    };
    const first = ledger.recordPlanned(intent, true);
    ledger.approveEffect(first.effectId, first.canonicalPayloadHash);
    await ledger.dispatchEffect(first.effectId, 3, async () => ({ deploymentId: "dpl_1" }));
    expect(ledger.getNetworkCallCount()).toBe(1);
    const cached = ledger.replaySucceededReceipt(
      intent.effectType,
      intent.idempotencyKey,
      payload,
    );
    expect(cached).toEqual({ deploymentId: "dpl_1" });
    const second = ledger.recordPlanned(intent, true);
    expect(second.effectId).toBe(first.effectId);
    expect(ledger.getNetworkCallCount()).toBe(1);
  });

  it("throws PayloadHashMismatchError when reusing an idempotency key with different payload", () => {
    const ledger = createLedger();
    ledger.recordPlanned({
      effectType: "create_pr",
      targetEnv: "git_remote",
      payload: { head: "abc123" },
      idempotencyKey: "pr-1",
      writerEpoch: 1,
    });
    expect(() =>
      ledger.recordPlanned({
        effectType: "create_pr",
        targetEnv: "git_remote",
        payload: { head: "def456" },
        idempotencyKey: "pr-1",
        writerEpoch: 1,
      }),
    ).toThrow(PayloadHashMismatchError);
  });

  it("planEffect returns hash and redacted payload without touching the network", () => {
    const ledger = createLedger();
    const plan = ledger.planEffect({
      effectType: "sync_env",
      targetEnv: "staging",
      payload: {
        kind: "env_sync",
        variables: [{ name: "DATABASE_URL", value: "postgres://secret" }],
      },
      idempotencyKey: "env-1",
      writerEpoch: 1,
    });
    expect(plan.approvalRequired).toBe(true);
    expect(plan.canonicalPayloadHash).toHaveLength(64);
    expect(plan.redactedPayload).toEqual({
      kind: "env_sync",
      variables: [{ name: "DATABASE_URL", digest: "hmac:redacted" }],
    });
    expect(ledger.getNetworkCallCount()).toBe(0);
  });
});

describe("EnvApprovalPolicyEngine", () => {
  it("rejects production autoApprove unconditionally", () => {
    const policy = new EnvApprovalPolicyEngine();
    expect(() => policy.evaluate("deploy", "production", true)).toThrow(
      ProductionAlwaysRequiresExplicitApprovalError,
    );
  });

  it("invalidates bound approval when payload hash changes by one byte", () => {
    const ledger = createLedger();
    const record = ledger.recordPlanned({
      effectType: "deploy",
      targetEnv: "production",
      payload: { commitSha: "abc123" },
      idempotencyKey: "prod-1",
      writerEpoch: 2,
    });
    ledger.approveEffect(record.effectId, record.canonicalPayloadHash);
    const tamperedHash = canonicalPayloadHash({ commitSha: "abc124" });
    ledger.store.updateApproval(record.effectId, "approved", tamperedHash);
    const stale = ledger.store.get(record.effectId)!;
    const policy = new EnvApprovalPolicyEngine();
    expect(() => policy.assertDispatchAllowed(stale)).toThrow();
  });
});

describe("LeaseEpochFencingGuard", () => {
  it("blocks stale writer_epoch and STOPPED runtime dispatches", async () => {
    const ledger = createLedger();
    ledger.setRuntimeFence(5, "RUNNING");
    const record = ledger.recordPlanned({
      effectType: "git_push",
      targetEnv: "git_remote",
      payload: { commitSha: "abc" },
      idempotencyKey: "push-stale",
      writerEpoch: 4,
    });
    ledger.approveEffect(record.effectId, record.canonicalPayloadHash);
    await expect(
      ledger.dispatchEffect(record.effectId, 4, async () => ({ ok: true })),
    ).rejects.toThrow(LeaseEpochFenceError);

    ledger.setRuntimeFence(6, "STOPPED");
    const record2 = ledger.recordPlanned({
      effectType: "git_push",
      targetEnv: "git_remote",
      payload: { commitSha: "def" },
      idempotencyKey: "push-stop",
      writerEpoch: 6,
    });
    ledger.approveEffect(record2.effectId, record2.canonicalPayloadHash);
    await expect(
      ledger.dispatchEffect(record2.effectId, 6, async () => ({ ok: true })),
    ).rejects.toThrow(/STOPPED/);
    expect(ledger.getNetworkCallCount()).toBe(0);
  });
});

describe("UnknownOutcomeReconciler", () => {
  it("reconciles ETIMEDOUT dispatched effects via read-only probe before retry", async () => {
    const store = new SqliteEffectStore({ now: () => 100 });
    const ledger = new ExternalEffectLedger({ store, now: () => 100 });
    const record = ledger.recordPlanned({
      effectType: "create_pr",
      targetEnv: "git_remote",
      payload: { head: "feature/x", base: "main" },
      idempotencyKey: "pr-timeout",
      writerEpoch: 2,
    });
    ledger.approveEffect(record.effectId, record.canonicalPayloadHash);
    const executor = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    await expect(ledger.dispatchEffect(record.effectId, 2, executor)).rejects.toThrow(/ETIMEDOUT/);
    expect(executor).toHaveBeenCalledTimes(1);
    const unknown = ledger.store.get(record.effectId)!;
    expect(unknown.execStatus).toBe("unknown_outcome");

    const reconciler = new UnknownOutcomeReconciler(store);
    reconciler.register("create_pr", () => ({
      kind: "succeeded",
      receipt: { prNumber: 42, url: "https://example/pr/42" },
    }));
    expect(() => reconciler.assertRetryAllowed(record.effectId)).toThrow(
      BlindUnknownOutcomeRetryForbiddenError,
    );
    const resolution = await reconciler.reconcileUnknown(record.effectId);
    expect(resolution.action).toBe("succeeded");
    expect(ledger.store.get(record.effectId)!.execStatus).toBe("succeeded");
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

describe("PacketSecurityRedactor", () => {
  it("rejects raw secret literals before SQLite insert", () => {
    const marker = ["ghp", "_", "abcdefghijklmnopqrstuvwxyz1234567890"].join("");
    expect(() => assertNoRawSecretsInPayload({ token: marker })).toThrow(/raw secret/);
  });
});