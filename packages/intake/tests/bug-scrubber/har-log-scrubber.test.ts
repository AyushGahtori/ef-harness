import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { formatRedactionBadge, HarAndLogScrubber } from "../../src/bug-scrubber/index.js";
import { assertAbsent, canaries } from "./canaries.js";

const scrubber = new HarAndLogScrubber();

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

describe("HarAndLogScrubber", () => {
  it("redacts every auth header, keeps status codes, and leaves unrelated headers", () => {
    const secrets = canaries();
    const result = scrubber.scrubHar({
      log: {
        version: "1.2",
        entries: [
          {
            request: {
              method: "POST",
              url: "https://shop.example/api/orders",
              headers: [
                { name: "Authorization", value: `Bearer ${secrets.stripe}` },
                { name: "Cookie", value: secrets.cookie },
                { name: "X-Api-Key", value: secrets.github },
                { name: "X-Auth-Token", value: secrets.aws },
                { name: "X-CSRF-Token", value: "csrf-value" },
                { name: "Proxy-Authorization", value: "Basic aaa" },
                { name: "Accept", value: "application/json" },
              ],
            },
            response: {
              status: 201,
              statusText: "Created",
              headers: [{ name: "Set-Cookie", value: secrets.cookie }],
              content: { mimeType: "application/json", text: "{\"ok\":true}" },
            },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.log.entries[0];
    expect(entry?.response.status).toBe(201);
    const names = entry?.request.headers.map((header) => header.name);
    expect(names).toEqual([
      "Authorization",
      "Cookie",
      "X-Api-Key",
      "X-Auth-Token",
      "X-CSRF-Token",
      "Proxy-Authorization",
      "Accept",
    ]);
    expect(entry?.request.headers.find((header) => header.name === "Accept")?.value).toBe("application/json");
    for (const header of entry?.request.headers ?? []) {
      if (header.name === "Accept") continue;
      expect(header.value).toBe(`[REDACTED:${header.name}]`);
    }
    expect(entry?.response.headers[0]?.value).toBe("[REDACTED:Set-Cookie]");
    assertAbsent(serialized(result.value), [secrets.stripe, secrets.github, secrets.aws, secrets.cookie, "CANARY"]);
  });

  it("redacts sensitive query keys, JSON bodies, JWTs, API keys, and PEM blocks", () => {
    const secrets = canaries();
    const result = scrubber.scrubLog(
      [
        `notes ${secrets.jwt}`,
        `key ${secrets.stripe}`,
        `hub ${secrets.github}`,
        `cloud ${secrets.aws}`,
        secrets.pem,
        "password=hunter2",
        JSON.stringify({
          password: "hunter2",
          access_token: secrets.jwt,
          note: "kept",
        }),
        "https://app.example/reset?token=raw-token&next=/home",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    assertAbsent(result.value, [secrets.jwt, secrets.stripe, secrets.github, secrets.aws, "hunter2", "raw-token", "CANARY"]);
    expect(result.value).toContain("[REDACTED:JWT]");
    expect(result.value).toContain("[REDACTED:API_KEY]");
    expect(result.value).toContain("[REDACTED:PEM_PRIVATE_KEY]");
    expect(result.value).toContain("[REDACTED:password]");
    expect(result.value).toContain("[REDACTED:token]");
    expect(result.value).toContain("\"note\":\"kept\"");
  });

  it("rewrites a postgres URL without dropping the host or database", () => {
    const secrets = canaries();
    const result = scrubber.scrubLog(`connect ${secrets.postgresLong}\n${secrets.postgres}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain("postgresql://[REDACTED_CREDENTIALS]@db.prod.internal:5432/app");
    expect(result.value).toContain("postgres://[REDACTED_CREDENTIALS]@h/db");
    assertAbsent(result.value, ["Sup3rS3cret!", "CANARY", secrets.postgres, secrets.postgresLong]);
    expect(result.counts.postgresUrls).toBe(2);
  });

  it("strips bidi overrides and tag-block characters before returning text", () => {
    const rtl = String.fromCodePoint(0x202e);
    const tag = String.fromCodePoint(0xe0001);
    const result = scrubber.scrubLog(`see${rtl}this${tag}now`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("seethisnow");
    expect(result.counts.hiddenUnicode).toBe(2);
    expect(result.value.includes(rtl)).toBe(false);
    expect(result.value.includes(tag)).toBe(false);
  });

  it("assigns stable email, phone, and IP tokens when PII scrubbing is on", () => {
    const result = scrubber.scrubHar(
      {
        log: {
          version: "1.2",
          entries: [
            {
              request: { method: "GET", url: "https://shop.example/a", headers: [] },
              response: {
                status: 200,
                statusText: "OK",
                content: {
                  mimeType: "text/plain",
                  text: "alice@corp.com called +1 415 555 0134 from 10.1.2.3",
                },
              },
            },
            {
              request: { method: "GET", url: "https://shop.example/b", headers: [] },
              response: {
                status: 200,
                statusText: "OK",
                content: {
                  mimeType: "text/plain",
                  text: "bob@corp.com versus alice@corp.com via 10.4.5.6",
                },
              },
            },
          ],
        },
      },
      { pii: true },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = serialized(result.value);
    expect(text).toContain("[EMAIL_1]");
    expect(text).toContain("[EMAIL_2]");
    expect(text).toContain("[PHONE_1]");
    expect(text).toContain("[IP_1]");
    expect(text).toContain("[IP_2]");
    expect(text.includes("alice@corp.com")).toBe(false);
    expect(text.includes("bob@corp.com")).toBe(false);
    const first = text.indexOf("[EMAIL_1]");
    const second = text.indexOf("[EMAIL_2]");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
    expect(text.split("[EMAIL_1]").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("formats a non-sensitive redaction badge", () => {
    const result = scrubber.scrubHar(badgeHar(canaries()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.badge).toBe("Scrubbed 4 auth cookies, 2 JWT tokens, and 1 Postgres URL before saving");
    expect(formatRedactionBadge(result.counts)).toBe(result.badge);
  });

  it("shrinks a multi-megabyte capture that declares a 45 MB body to under 80 KB", () => {
    const secrets = canaries();
    const bulky = "x".repeat(1_500_000);
    const result = scrubber.scrubHar({
      log: {
        version: "1.2",
        entries: [
          {
            request: {
              method: "GET",
              url: "https://shop.example/app",
              headers: [
                { name: "Cookie", value: `session=${secrets.jwt}` },
                { name: "Authorization", value: `Bearer ${secrets.stripe}` },
              ],
            },
            response: {
              status: 200,
              statusText: "OK",
              content: {
                mimeType: "application/javascript",
                size: 45 * 1024 * 1024,
                text: bulky,
              },
            },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const encoded = serialized(result.value);
    expect(Buffer.byteLength(encoded)).toBeLessThan(80 * 1024);
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(128 * 1024);
    const content = result.value.log.entries[0]?.response.content;
    expect(content).toEqual({
      contentType: "application/javascript",
      byteLength: 45 * 1024 * 1024,
      truncated: true,
    });
    assertAbsent(encoded, [secrets.jwt, secrets.stripe, "CANARY", bulky.slice(0, 32)]);
  });

  it("replaces image payloads with a content type and byte length", () => {
    const result = scrubber.scrubHar({
      log: {
        version: "1.2",
        entries: [
          {
            request: { method: "GET", url: "https://cdn.example/logo.png", headers: [] },
            response: {
              status: 200,
              statusText: "OK",
              content: { mimeType: "image/png", size: 24000, text: "PNGDATA" },
            },
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.log.entries[0]?.response.content).toEqual({
      contentType: "image/png",
      byteLength: 24000,
      truncated: true,
    });
    expect(serialized(result.value).includes("PNGDATA")).toBe(false);
  });

  it("returns a clean parse error for truncated HAR JSON", () => {
    const result = scrubber.scrubHar("{\"log\":");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("malformed_har");
    expect(result.message).toMatch(/truncated or is not valid JSON/);
    expect(result.message.includes("{")).toBe(false);
  });
});

function badgeHar(secrets: ReturnType<typeof canaries>): unknown {
  const cookie = (name: string): { name: string; value: string } => ({ name, value: secrets.cookie });
  return {
    log: {
      version: "1.2",
      entries: [
        {
          request: {
            method: "POST",
            url: "https://shop.example/api/orders",
            headers: [cookie("Cookie"), cookie("Set-Cookie")],
            postData: { mimeType: "text/plain", text: secrets.postgresLong },
          },
          response: {
            status: 500,
            statusText: "Error",
            headers: [cookie("Cookie"), cookie("Set-Cookie")],
            content: { mimeType: "text/plain", text: `${secrets.jwt}\n${secrets.jwt}` },
          },
        },
      ],
    },
  };
}
