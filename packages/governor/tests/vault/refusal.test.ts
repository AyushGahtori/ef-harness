import { describe, expect, it } from "vitest";
import {
  awsAccessKeyPrefix,
  stripeLivePrefix,
  stripeLiveRefusalMessage,
  stripeTestPrefix,
} from "../../src/vault/patterns.js";
import { LiveKeyTestRefusalGuard } from "../../src/vault/refusal.js";

const guard = new LiveKeyTestRefusalGuard({ prodHostnames: ["db.prod.internal"] });

describe("LiveKeyTestRefusalGuard", () => {
  it("refuses a Stripe live secret in test and dev with the exact card", () => {
    const value = `${stripeLivePrefix()}CANARY_888`;
    for (const envScope of ["test", "dev"] as const) {
      const decision = guard.inspect({ value, envScope, name: "STRIPE_SECRET_KEY" });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.message).toBe(stripeLiveRefusalMessage());
        expect(decision.code).toBe("stripe_live");
      }
    }
  });

  it("accepts a Stripe test secret", () => {
    const decision = guard.inspect({
      value: `${stripeTestPrefix()}fixture_ok`,
      envScope: "test",
      name: "STRIPE_TEST_KEY",
    });
    expect(decision.allowed).toBe(true);
  });

  it("refuses restricted live keys and publishable live keys only when paired", () => {
    const restricted = guard.inspect({ value: "rk_live_fixture_key", envScope: "test" });
    expect(restricted.allowed).toBe(false);
    const alone = guard.inspect({ value: "pk_live_fixture_key", envScope: "dev" });
    expect(alone.allowed).toBe(true);
    const paired = guard.inspectMany([
      { value: `${stripeLivePrefix()}CANARY_888`, envScope: "test", name: "STRIPE_SECRET_KEY" },
      { value: "pk_live_fixture_key", envScope: "test", name: "STRIPE_PUBLISHABLE_KEY" },
    ]);
    expect(paired[1]?.allowed).toBe(false);
  });

  it("refuses SendGrid production keys, live Twilio, and prod-tagged AWS keys", () => {
    expect(guard.inspect({ value: "SG.fixture_sendgrid_key", envScope: "test" }).allowed).toBe(false);
    expect(
      guard.inspect({
        value: "twilio_live_fixture_token_999",
        envScope: "dev",
        providerHint: "twilio",
        taggedProd: true,
      }).allowed,
    ).toBe(false);
    expect(
      guard.inspect({
        value: "twilio_test_fixture_token_999",
        envScope: "dev",
        providerHint: "twilio",
        taggedProd: false,
      }).allowed,
    ).toBe(true);
    const aws = `${awsAccessKeyPrefix()}TESTKEY000000`;
    expect(guard.inspect({ value: aws, envScope: "test", name: "AWS_ACCESS_KEY_ID" }).allowed).toBe(true);
    expect(
      guard.inspect({
        value: aws,
        envScope: "test",
        name: "AWS_ACCESS_KEY_ID",
        taggedProd: true,
      }).allowed,
    ).toBe(false);
  });

  it("refuses production database URLs and keeps an explicit test override narrow", () => {
    const local = guard.inspect({
      value: "postgres://app:local_fixture@127.0.0.1:5432/app",
      envScope: "test",
      name: "DATABASE_URL",
    });
    expect(local.allowed).toBe(true);
    const marked = guard.inspect({
      value: "postgres://app:local_fixture@db.prod.example:5432/app",
      envScope: "dev",
      name: "DATABASE_URL",
    });
    expect(marked.allowed).toBe(false);
    const overridden = guard.inspect({
      value: "postgres://app:local_fixture@db.prod.example:5432/app",
      envScope: "dev",
      name: "DATABASE_URL",
      explicitTestOverride: true,
    });
    expect(overridden.allowed).toBe(true);
    const configured = guard.inspect({
      value: "postgres://app:local_fixture@db.prod.internal:5432/app",
      envScope: "test",
      name: "DATABASE_URL",
      explicitTestOverride: true,
    });
    expect(configured.allowed).toBe(false);
  });

  it("refuses stripe livemode and production-scoped secrets in preview", () => {
    const livemode = guard.inspect({
      value: `${stripeTestPrefix()}fixture_ok`,
      envScope: "test",
      stripeLivemode: true,
    });
    expect(livemode.allowed).toBe(false);
    if (!livemode.allowed) expect(livemode.message).toBe(stripeLiveRefusalMessage());
    const preview = guard.inspect({
      value: "prod_scope_fixture_secret",
      envScope: "prod",
      injectionTarget: "preview",
      storedEnvScope: "prod",
    });
    expect(preview.allowed).toBe(false);
    const stored = guard.inspect({
      value: `${stripeLivePrefix()}CANARY_888`,
      envScope: "prod",
    });
    expect(stored.allowed).toBe(true);
  });
});
