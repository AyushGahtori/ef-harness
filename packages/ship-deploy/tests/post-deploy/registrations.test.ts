import { describe, expect, it } from "vitest";
import {
  ExternalRegistrationReceiptManager,
  InMemoryPostDeployStore,
  createFallbackPacketSecurityRedactor,
  createReadOnlyProbeRegistry,
} from "../../src/post-deploy/index.js";
import type { DnsProbePort } from "../../src/post-deploy/index.js";
import { startMockDeploy } from "./helpers.js";

const redactor = createFallbackPacketSecurityRedactor();

function dns(records: {
  cname?: Record<string, readonly string[]>;
  txt?: Record<string, readonly (readonly string[])[]>;
  a?: Record<string, readonly string[]>;
}): DnsProbePort {
  return {
    async resolveCname(host) {
      return records.cname?.[host] ?? [];
    },
    async resolveTxt(host) {
      return records.txt?.[host] ?? [];
    },
    async resolve4(host) {
      return records.a?.[host] ?? [];
    },
  };
}

describe("post-deploy external registration receipts", () => {
  it("prints copyable webhook values and records verified versus attested honestly", async () => {
    const store = new InMemoryPostDeployStore();
    const manager = new ExternalRegistrationReceiptManager({
      store,
      probes: createReadOnlyProbeRegistry({
        dns: dns({}),
        tlsProbe: async () => ({ valid: false, mode: "https", reason: "TLS certificate is expired" }),
        fetchImpl: async () => new Response("missing", { status: 404 }),
      }),
      redactor,
    });
    const spec = {
      shipRunId: "ship-reg",
      registrationType: "stripe-webhook" as const,
      targetUrlOrDomain: "app.example.com",
      webhookUrl: "https://app.example.com/api/webhooks/stripe",
      signingEvents: ["checkout.session.completed", "customer.subscription.updated"],
    };
    expect(manager.copyable(spec)).toBe(
      "Webhook URL: https://app.example.com/api/webhooks/stripe\nSigning events: checkout.session.completed, customer.subscription.updated",
    );
    const failed = await manager.verify(spec);
    expect(failed.ok).toBe(false);
    expect(store.registrationsFor("ship-reg")).toHaveLength(0);
    const attested = manager.attest({
      shipRunId: "ship-reg",
      registrationType: "oauth-redirect",
      targetUrlOrDomain: "https://app.example.com/api/auth/callback",
      oauthRedirectUri: "https://app.example.com/api/auth/callback",
      attestationNote: "I added the redirect URI in the provider console",
    });
    expect(attested.probeStatus).toBe("attested");
    expect(attested.verifiedAt).toBeNull();
    expect(attested.evidence).toContain("Self-attested by you (unprobed)");
    expect(store.registrationsFor("ship-reg")).toEqual([attested]);
  });

  it("verifies a matching CNAME plus TLS, and explains a stale CNAME", async () => {
    const store = new InMemoryPostDeployStore();
    const stale = new ExternalRegistrationReceiptManager({
      store,
      probes: createReadOnlyProbeRegistry({
        dns: dns({ cname: { "kitchen.example.com": ["old.host"] } }),
        tlsProbe: async () => ({
          valid: true,
          mode: "https",
          expiresAt: "2027-01-01T00:00:00.000Z",
        }),
      }),
      redactor,
    });
    const mismatch = await stale.verify({
      shipRunId: "ship-dns",
      registrationType: "dns-cname",
      targetUrlOrDomain: "kitchen.example.com",
      expectedCname: "cname.vercel-dns.com",
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.evidence).toBe(
        "CNAME still points to old.host — DNS propagation may take a few minutes",
      );
    }
    expect(store.registrationsFor("ship-dns")).toHaveLength(0);

    const ready = new ExternalRegistrationReceiptManager({
      store,
      probes: createReadOnlyProbeRegistry({
        dns: dns({ cname: { "kitchen.example.com": ["cname.vercel-dns.com."] } }),
        tlsProbe: async () => ({
          valid: true,
          mode: "https",
          expiresAt: "2027-01-01T00:00:00.000Z",
        }),
      }),
      redactor,
    });
    const verified = await ready.verify({
      shipRunId: "ship-dns",
      registrationType: "dns-cname",
      targetUrlOrDomain: "kitchen.example.com",
      expectedCname: "cname.vercel-dns.com",
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.receipt.probeStatus).toBe("verified");
      expect(verified.receipt.verifiedAt).toEqual(expect.any(String));
      expect(verified.receipt.evidence).toContain("expires 2027-01-01T00:00:00.000Z");
    }
  });

  it("verifies SPF, DKIM, and a safe webhook test ping without calling Stripe", async () => {
    const store = new InMemoryPostDeployStore();
    const manager = new ExternalRegistrationReceiptManager({
      store,
      probes: createReadOnlyProbeRegistry({
        dns: dns({
          txt: {
            "example.com": [["v=spf1 include:_spf.resend.com -all"]],
            "resend._domainkey.example.com": [["v=DKIM1; p=public"]],
          },
        }),
      }),
      redactor,
    });
    const spf = await manager.verify({
      shipRunId: "ship-mail",
      registrationType: "spf",
      targetUrlOrDomain: "example.com",
      expectedTxtIncludes: "include:_spf.resend.com",
    });
    const dkim = await manager.verify({
      shipRunId: "ship-mail",
      registrationType: "dkim",
      targetUrlOrDomain: "example.com",
      dkimSelector: "resend",
    });
    expect(spf.ok).toBe(true);
    expect(dkim.ok).toBe(true);

    const app = await startMockDeploy();
    try {
      const webhook = new ExternalRegistrationReceiptManager({
        store,
        probes: createReadOnlyProbeRegistry(),
        redactor,
      });
      const url = `${app.origin}/api/webhooks/stripe`;
      const withoutPing = await webhook.verify({
        shipRunId: "ship-hook",
        registrationType: "stripe-webhook",
        targetUrlOrDomain: url,
        webhookUrl: url,
        signingEvents: ["checkout.session.completed"],
      });
      expect(withoutPing.ok).toBe(true);
      expect(app.requests.some((request) => request.method === "POST")).toBe(false);
      const withPing = await webhook.verify({
        shipRunId: "ship-hook",
        registrationType: "stripe-webhook",
        targetUrlOrDomain: url,
        webhookUrl: url,
        signingEvents: ["checkout.session.completed"],
        allowSignedTestPing: true,
      });
      expect(withPing.ok).toBe(true);
      if (withPing.ok) expect(withPing.receipt.evidence).toContain("signed test ping HTTP 204");
      expect(app.requests.some((request) => request.method === "POST" && request.path === "/api/webhooks/stripe")).toBe(
        true,
      );
      expect(app.requests.some((request) => request.path.includes("stripe.com"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("redacts secrets in probe evidence and runtime text", () => {
    const secret = `${["sk", "_live_"].join("")}${"CD".repeat(8)}`;
    const scrubbed = redactor.redact(`log ${secret} Bearer abcdefghijklmnop https://user:supersecret@example.com/db`);
    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain("[REDACTED:STRIPE_LIVE_KEY]");
    expect(scrubbed).toContain("[REDACTED:BEARER]");
    expect(scrubbed).toContain("[REDACTED:URL_USERINFO]");
    expect(scrubbed).not.toContain("supersecret");
    const sha = "dddddddddddddddddddddddddddddddddddddddd";
    expect(redactor.redact(sha)).toBe(sha);
  });
});
