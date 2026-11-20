import { describe, expect, it } from "vitest";
import { BackgroundJobVerifier } from "../../src/surfaces/background-job-verifier.js";
import { listen, readBody, sendJson, verifierContext } from "./support.js";

const clock = "2026-01-15T09:45:00.000Z";
const spec = {
  checkId: "job.email",
  enqueuePath: "/jobs/order-email",
  payload: { orderId: "o-1", to: "cook@env.test" },
  clock,
  observations: {
    databasePath: "/observations/rows",
    mailpitPath: "/mailpit/api/v1/search",
    eventPath: "/observations/events",
    eventType: "order.email.sent",
    clockField: "sentAt",
  },
};

async function startJobs(idempotent: boolean) {
  const rows: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  return listen(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/jobs/order-email") {
      const header = request.headers["x-test-clock"];
      const sentAt = Array.isArray(header) ? header[0] : header;
      const payload = await readBody(request);
      if (!idempotent || !seen.has(payload)) {
        seen.add(payload);
        rows.push({ orderId: "o-1", sentAt });
        messages.push({ ID: `m-${messages.length + 1}`, sentAt, To: "cook@env.test" });
        events.push({ type: "order.email.sent", sentAt });
      }
      sendJson(response, 202, { accepted: true });
      return;
    }
    if (url.pathname === "/observations/rows") {
      sendJson(response, 200, rows);
      return;
    }
    if (url.pathname === "/mailpit/api/v1/search") {
      sendJson(response, 200, { messages });
      return;
    }
    if (url.pathname === "/observations/events") {
      sendJson(response, 200, events);
      return;
    }
    sendJson(response, 404, {});
  });
}

describe("BackgroundJobVerifier", () => {
  it("observes a database row, a Mailpit message, and an event at the fake clock, once", async () => {
    const server = await startJobs(true);
    try {
      const results = await new BackgroundJobVerifier().verify(spec, verifierContext(server.url));
      expect(results.every((result) => result.status === "pass")).toBe(true);
      expect(results.map((result) => result.check_id)).toEqual(["job.email:outcome", "job.email:X-12"]);
    } finally {
      await server.close();
    }
  });

  it("fails X-12 when the same payload produces a second side effect", async () => {
    const server = await startJobs(false);
    try {
      const results = await new BackgroundJobVerifier().verify(spec, verifierContext(server.url));
      expect(results.find((result) => result.check_id === "job.email:X-12")?.status).toBe("fail");
    } finally {
      await server.close();
    }
  });
});
