import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InboundWebhookVerifier } from "../../src/surfaces/inbound-webhook-verifier.js";
import { RateLimitBurstVerifier } from "../../src/surfaces/rate-limit-burst-verifier.js";
import { listen, readBody, sendJson, verifierContext } from "./support.js";

const secret = "test_webhook_secret";

function signed(style: "github" | "stripe", header: string | undefined, body: string): boolean {
  if (!header) return false;
  if (style === "github") {
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    return header === `sha256=${digest}`;
  }
  const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header);
  if (!match) return false;
  const digest = createHmac("sha256", secret).update(`${match[1]}.${body}`).digest("hex");
  return match[2] === digest;
}

async function startWebhook(style: "github" | "stripe", idempotent: boolean) {
  const seen = new Set<string>();
  let accepted = 0;
  return listen(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/observations") {
      sendJson(response, 200, { count: accepted });
      return;
    }
    const body = await readBody(request);
    const headerName = style === "github" ? "x-hub-signature-256" : "stripe-signature";
    const header = request.headers[headerName];
    const value = Array.isArray(header) ? header[0] : header;
    if (!signed(style, value, body)) {
      sendJson(response, 401, { error: "forged" });
      return;
    }
    const eventId = String(request.headers["x-event-id"] ?? "");
    if (!idempotent || !seen.has(eventId)) {
      seen.add(eventId);
      accepted += 1;
    }
    sendJson(response, 200, { ok: true });
  });
}

async function startLimiter(enforced: boolean) {
  let count = 0;
  return listen(async (request, response) => {
    void request;
    if (enforced && count >= 3) {
      sendJson(response, 429, { code: "rate_limited", message: "Too many requests", banner: "Slow down" });
      return;
    }
    count += 1;
    sendJson(response, 200, { ok: true });
  });
}

describe("inbound webhook and rate-limit verifiers", () => {
  it("rejects a forged signature and treats a duplicate event id as idempotent", async () => {
    for (const style of ["github", "stripe"] as const) {
      const server = await startWebhook(style, true);
      try {
        const results = await new InboundWebhookVerifier().verify(
          {
            checkId: `webhook.${style}`,
            targetPath: "/hooks/inbound",
            secret,
            style,
            eventId: "evt_123",
            payload: { type: "order.paid" },
            observationPath: "/observations",
          },
          verifierContext(server.url),
        );
        expect(results.every((result) => result.status === "pass")).toBe(true);
      } finally {
        await server.close();
      }
    }
  });

  it("fails when a duplicate event id is applied twice", async () => {
    const server = await startWebhook("github", false);
    try {
      const results = await new InboundWebhookVerifier().verify(
        {
          checkId: "webhook.replay",
          targetPath: "/hooks/inbound",
          secret,
          style: "github",
          eventId: "evt_123",
          payload: { type: "order.paid" },
          observationPath: "/observations",
        },
        verifierContext(server.url),
      );
      expect(results.find((result) => result.check_id.endsWith(":replay"))?.status).toBe("fail");
    } finally {
      await server.close();
    }
  });

  it("requires 429 to start on the request after the limit and catches a limiter that never trips", async () => {
    const limited = await startLimiter(true);
    const open = await startLimiter(false);
    try {
      const pass = await new RateLimitBurstVerifier().verify(
        { checkId: "auth.login", path: "/auth/login", limit: 3, burst: 6 },
        verifierContext(limited.url),
      );
      const fail = await new RateLimitBurstVerifier().verify(
        { checkId: "auth.login", path: "/auth/login", limit: 3, burst: 6 },
        verifierContext(open.url),
      );
      expect(pass[0]?.status).toBe("pass");
      expect(fail[0]?.status).toBe("fail");
      expect(fail[0]?.message).toContain("429");
    } finally {
      await limited.close();
      await open.close();
    }
  });
});
