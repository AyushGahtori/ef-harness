import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  GenericWebhookDeliverer,
  NonLoopbackTargetError,
  StripeMockAndWebhookProvider,
  parseStripeSignature,
  resolveStripeMockBinary,
  verifyStripeSignature,
} from "../../src/auth-payment-mocks/index.js";
import { closeServer, listenLoopback, readBody } from "../../src/auth-payment-mocks/http-util.js";

const providers: StripeMockAndWebhookProvider[] = [];
const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

describe("StripeMockAndWebhookProvider", () => {
  it("emulates the Stripe API on loopback and keeps test secrets off production hosts", async () => {
    const provider = track(new StripeMockAndWebhookProvider({ resolveBinary: () => undefined }));
    const first = await provider.provision({ projectId: "alpha", envId: "env1" });
    const second = await provider.provision({ projectId: "alpha", envId: "env2" });
    const other = await provider.provision({ projectId: "beta", envId: "env9" });
    expect(first.url).toBe(second.url);
    expect(other.url).not.toBe(first.url);
    const snapshot = provider.projectSnapshot("alpha");
    if (!snapshot) throw new Error("missing stripe runtime");
    expect(snapshot.mode).toBe("emulator");
    expect(snapshot.boundAddress).toBe("127.0.0.1");
    expect(snapshot.baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
    expect(snapshot.signingSecret).toMatch(/^whsec_test_mock_[0-9a-f]+$/);
    expect(snapshot.secretKey.startsWith("sk_test_")).toBe(true);

    const created = await fetch(`${snapshot.baseUrl}/v1/payment_intents`, {
      method: "POST",
      headers: { authorization: `Bearer ${snapshot.secretKey}`, "content-type": "application/json" },
      body: JSON.stringify({ amount: 1250, currency: "usd" }),
    });
    expect(created.status).toBe(200);
    const paymentIntent = (await created.json()) as { id: string; object: string; livemode: boolean; amount: string | number };
    expect(paymentIntent.object).toBe("payment_intent");
    expect(paymentIntent.id.startsWith("pi_")).toBe(true);
    expect(paymentIntent.livemode).toBe(false);

    const liveMarker = ["sk", "_live_", "refused"].join("");
    const refused = await fetch(`${snapshot.baseUrl}/v1/charges`, {
      method: "POST",
      headers: { authorization: `Bearer ${liveMarker}`, "content-type": "application/json" },
      body: JSON.stringify({ amount: 1 }),
    });
    expect(refused.status).toBe(401);
    const liveMode = await fetch(`${snapshot.baseUrl}/v1/customers`, {
      method: "POST",
      headers: { authorization: `Bearer ${snapshot.secretKey}`, "content-type": "application/json" },
      body: JSON.stringify({ livemode: true }),
    });
    expect(liveMode.status).toBe(400);
    const remoteHook = await fetch(`${snapshot.baseUrl}/v1/webhook_endpoints`, {
      method: "POST",
      headers: { authorization: `Bearer ${snapshot.secretKey}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://api.stripe.com/webhook" }),
    });
    expect(remoteHook.status).toBe(400);

    await expect(
      provider.deliverSignedWebhook("https://api.stripe.com/v1/webhook_endpoints", { id: "evt_live" }, snapshot.signingSecret),
    ).rejects.toBeInstanceOf(NonLoopbackTargetError);
    await expect(
      provider.deliverSignedWebhook("https://accounts.google.com/oauth", { id: "evt_oauth" }, snapshot.signingSecret),
    ).rejects.toBeInstanceOf(NonLoopbackTargetError);

    await provider.destroy("env1");
    expect(provider.projectSnapshot("alpha")?.baseUrl).toBe(first.url);
    await provider.destroy("env2");
    expect(provider.projectSnapshot("alpha")).toBeUndefined();
    await expect(fetch(first.url)).rejects.toThrow();
  });

  it("falls back to the emulator when stripe-mock cannot start", async () => {
    expect(resolveStripeMockBinary("C:\\missing\\stripe-mock.exe")).toBeUndefined();
    const provider = track(new StripeMockAndWebhookProvider({ resolveBinary: () => process.execPath }));
    const provisioned = await provider.provision({ projectId: "fallback", envId: "env1" });
    expect(provider.projectSnapshot("fallback")?.mode).toBe("emulator");
    expect(provisioned.url.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("delivers valid, forged, expired, and simultaneous duplicate Stripe webhooks", async () => {
    const provider = track(new StripeMockAndWebhookProvider({ resolveBinary: () => undefined }));
    const secret = "whsec_test_mock_fixture";
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: Array<{ body: string; header: string }> = [];
    const receiver = await startReceiver(async (body, headers) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const header = headers["stripe-signature"] ?? "";
      seen.push({ body, header });
      await delay(80);
      inFlight -= 1;
      const now = Math.floor(Date.now() / 1000);
      const verdict = verifyStripeSignature(body, header, secret, 300, now);
      if (!verdict.matches) return { status: 400, body: "forged" };
      if (verdict.expired) return { status: 400, body: "expired" };
      return { status: 200, body: "ok" };
    });

    const valid = await provider.deliverSignedWebhook(receiver.url, { type: "payment_intent.succeeded" }, secret, {
      mode: "valid",
      eventId: "evt_valid",
    });
    expect(valid).toHaveLength(1);
    expect(valid[0]?.status).toBe(200);
    expect(valid[0]?.signatureMatches).toBe(true);
    const validHeader = valid[0]?.headersSent["Stripe-Signature"] ?? "";
    expect(validHeader).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
    const independent = createHmac("sha256", secret)
      .update(`${valid[0]?.timestampSeconds}.${valid[0]?.requestBody}`)
      .digest("hex");
    expect(parseStripeSignature(validHeader).signatures).toContain(independent);

    seen.length = 0;
    maxInFlight = 0;
    const forged = await provider.deliverSignedWebhook(receiver.url, { id: "evt_forged", type: "charge.failed" }, secret, {
      mode: "forged",
    });
    expect(forged[0]?.status).toBe(400);
    expect(forged[0]?.signatureMatches).toBe(false);
    expect(forged[0]?.responseBody).toBe("forged");

    const expired = await provider.deliverSignedWebhook(receiver.url, { id: "evt_old" }, secret, {
      mode: "expired_timestamp",
    });
    expect(expired[0]?.timestampExpired).toBe(true);
    expect(expired[0]?.signatureMatches).toBe(true);
    expect(expired[0]?.status).toBe(400);
    expect(Math.floor(Date.now() / 1000) - (expired[0]?.timestampSeconds ?? 0)).toBeGreaterThan(300);

    seen.length = 0;
    maxInFlight = 0;
    const replay = await provider.deliverSignedWebhook(
      receiver.url,
      { id: "evt_123", type: "payment_intent.succeeded" },
      secret,
      { mode: "replay", concurrent: true },
    );
    expect(replay).toHaveLength(2);
    expect(replay[0]?.requestBody).toBe(replay[1]?.requestBody);
    expect(replay[0]?.eventId).toBe("evt_123");
    expect(replay[1]?.eventId).toBe("evt_123");
    expect(maxInFlight).toBe(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.body).toContain("evt_123");
    expect(seen[0]?.body).toBe(seen[1]?.body);

    seen.length = 0;
    maxInFlight = 0;
    const sequential = await provider.deliverSignedWebhook(receiver.url, { id: "evt_seq" }, secret, { mode: "replay" });
    expect(sequential).toHaveLength(2);
    expect(maxInFlight).toBe(1);
    expect(sequential[0]?.requestBody).toBe(sequential[1]?.requestBody);
  });
});

describe("GenericWebhookDeliverer", () => {
  it("signs GitHub and Svix webhooks, including forged and replayed deliveries", async () => {
    const deliverer = new GenericWebhookDeliverer();
    const githubSecret = "github-test-secret";
    const svixKey = randomBytes(24);
    const svixSecret = `whsec_${svixKey.toString("base64")}`;
    const githubSeen: string[] = [];
    const svixSeen: string[] = [];
    const receiver = await startReceiver(async (body, headers) => {
      if (headers["x-hub-signature-256"]) githubSeen.push(`${headers["x-hub-signature-256"]}|${body}`);
      if (headers["webhook-signature"]) svixSeen.push(`${headers["webhook-id"]}|${headers["webhook-signature"]}|${body}`);
      const github = headers["x-hub-signature-256"];
      if (github) {
        const expected = `sha256=${createHmac("sha256", githubSecret).update(body).digest("hex")}`;
        return { status: github === expected ? 200 : 400, body: github === expected ? "ok" : "forged" };
      }
      const signature = headers["webhook-signature"] ?? "";
      const id = headers["webhook-id"] ?? "";
      const timestamp = headers["webhook-timestamp"] ?? "";
      const expected = `v1,${createHmac("sha256", svixKey).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
      const duplicate = headers["svix-signature"];
      if (duplicate !== signature) return { status: 400, body: "svix header mismatch" };
      return { status: signature === expected ? 200 : 400, body: signature === expected ? "ok" : "forged" };
    });

    const good = await deliverer.deliver(receiver.url, { id: "msg_1", type: "push" }, githubSecret, {
      format: "github",
      mode: "valid",
      eventId: "msg_1",
    });
    expect(good[0]?.status).toBe(200);
    expect(good[0]?.headersSent["X-Hub-Signature-256"]?.startsWith("sha256=")).toBe(true);
    const forged = await deliverer.deliver(receiver.url, { id: "msg_2" }, githubSecret, {
      format: "github",
      mode: "forged",
      eventId: "msg_2",
    });
    expect(forged[0]?.status).toBe(400);

    const svix = await deliverer.deliver(receiver.url, { id: "msg_svix", type: "invoice" }, svixSecret, {
      format: "standard-webhooks",
      mode: "valid",
      eventId: "msg_svix",
    });
    expect(svix[0]?.status).toBe(200);
    expect(svix[0]?.headersSent["webhook-signature"]?.startsWith("v1,")).toBe(true);
    expect(svix[0]?.headersSent["svix-id"]).toBe("msg_svix");
    const svixForged = await deliverer.deliver(receiver.url, { id: "msg_bad" }, svixSecret, {
      format: "svix",
      mode: "forged",
      eventId: "msg_bad",
    });
    expect(svixForged[0]?.status).toBe(400);
    const replay = await deliverer.deliver(receiver.url, { id: "msg_replay" }, svixSecret, {
      format: "svix",
      mode: "replay",
      concurrent: true,
      eventId: "msg_replay",
    });
    expect(replay).toHaveLength(2);
    expect(replay[0]?.requestBody).toBe(replay[1]?.requestBody);
    expect(replay.every((receipt) => receipt.status === 200)).toBe(true);
    expect(githubSeen.length).toBeGreaterThan(0);
    expect(svixSeen.length).toBeGreaterThan(0);
  });
});

function track(provider: StripeMockAndWebhookProvider): StripeMockAndWebhookProvider {
  providers.push(provider);
  return provider;
}

async function startReceiver(
  handler: (body: string, headers: Record<string, string | undefined>) => Promise<{ status: number; body: string }>,
): Promise<{ url: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void readBody(req).then(async (body) => {
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
      );
      const result = await handler(body, headers);
      res.writeHead(result.status, { "content-type": "text/plain" });
      res.end(result.body);
    });
  });
  const port = await listenLoopback(server, 0);
  servers.push(() => closeServer(server));
  return { url: `http://127.0.0.1:${port}/webhook` };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
