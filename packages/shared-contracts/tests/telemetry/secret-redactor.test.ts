import { describe, expect, it } from "vitest";
import { SecretRedactor } from "../../src/telemetry/redactor.js";
import { SECRET_LABEL } from "../../src/telemetry/patterns.js";
import {
  entropySample,
  fakeJwt,
  pemBlock,
  pemHeader,
  prefixes,
  repeatAlphabet,
  secretForms,
  upperAlphabet,
} from "./helpers.js";

const vaultSecret = "S3cret/Value+Plus==";

function redactorWithVault(): SecretRedactor {
  const redactor = new SecretRedactor();
  redactor.register("STRIPE_SECRET_KEY", vaultSecret);
  return redactor;
}

describe("SecretRedactor", () => {
  it("masks raw, base64, base64url, url-encoded, and json-escaped vault values", () => {
    const redactor = redactorWithVault();
    const forms = secretForms(vaultSecret);
    const redacted = redactor.redact(forms.join(" | "));
    for (const form of forms) expect(redacted).not.toContain(form);
    expect(redacted).toContain("[REDACTED:STRIPE_SECRET_KEY]");
    expect(redacted).toBe(redactor.redact(redacted));
  });

  it("catches a base64 secret nested inside a url-encoded HAR query string", () => {
    const redactor = redactorWithVault();
    const base64 = Buffer.from(vaultSecret).toString("base64");
    expect(base64).toMatch(/[+/=]/);
    const query = `https://example.test/search?q=${encodeURIComponent(base64)}&raw=${encodeURIComponent(vaultSecret)}`;
    const redacted = redactor.redact(query);
    expect(redacted).not.toContain(vaultSecret);
    expect(redacted).not.toContain(base64);
    expect(redacted).not.toContain(encodeURIComponent(vaultSecret));
    expect(redacted).not.toContain(encodeURIComponent(base64));
    expect(redacted).toContain("example.test");
  });

  it("redacts a json-escaped vault secret that contains quotes and backslashes", () => {
    const redactor = new SecretRedactor();
    const secret = 'ab"cd\\efgh';
    expect(secret.length).toBeGreaterThanOrEqual(8);
    redactor.register("QUOTED", secret);
    const encoded = JSON.stringify({ secret });
    const escaped = JSON.stringify(secret).slice(1, -1);
    expect(escaped).not.toBe(secret);
    const redacted = redactor.redact(encoded);
    expect(redacted).not.toContain(escaped);
    expect(redacted).toContain("[REDACTED:QUOTED]");
  });

  it("ignores registered values shorter than 8 characters", () => {
    const redactor = new SecretRedactor();
    redactor.register("FLAG", "true");
    redactor.register("ENV", "dev");
    const text = "true dev development mode";
    expect(redactor.redact(text)).toBe(text);
  });

  it("matches an 8 character vault value and replaces every copy", () => {
    const redactor = new SecretRedactor();
    const secret = "abcd1234";
    redactor.register("EIGHT", secret);
    expect(redactor.redact(`xx${secret}yy ${secret}`)).toBe(
      "xx[REDACTED:EIGHT]yy [REDACTED:EIGHT]",
    );
    expect(redactor.forget("EIGHT")).toBe(true);
    expect(redactor.redact(secret)).toBe(secret);
  });

  it("redacts builtin provider tokens and private key blocks", () => {
    const redactor = new SecretRedactor();
    const stripe = `${prefixes.stripeLive}${repeatAlphabet(24)}`;
    const stripeTest = `${prefixes.stripeTest}${repeatAlphabet(18)}`;
    const anthropic = `${prefixes.anthropic}${repeatAlphabet(24)}`;
    const project = `${prefixes.openaiProject}${repeatAlphabet(24)}`;
    const router = `${prefixes.openRouter}${repeatAlphabet(24)}`;
    const google = `${prefixes.google}${repeatAlphabet(35, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")}`;
    const github = `${prefixes.github}${repeatAlphabet(36)}`;
    const oauth = `${prefixes.githubOauth}${repeatAlphabet(36)}`;
    const fine = `${prefixes.githubFine}${repeatAlphabet(30, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")}`;
    const aws = `${prefixes.aws}${upperAlphabet(16)}`;
    const body = "MIIEowIBAAKCAQEA1234567890abcd";
    const pem = pemBlock(body);
    const text = [stripe, stripeTest, anthropic, project, router, google, github, oauth, fine, aws, pem].join(
      "\n",
    );
    const redacted = redactor.redact(text);
    for (const secret of [stripe, stripeTest, anthropic, project, router, google, github, oauth, fine, aws, body]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.stripeLive}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.stripeTest}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.githubOauth}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.githubFine}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.anthropic}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.openaiProject}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.openRouter}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.google}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.github}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.aws}]`);
    expect(redacted).toContain(`[REDACTED:${SECRET_LABEL.pem}]`);
  });

  it("redacts bearer jwts and url basic-auth credentials without dropping the host", () => {
    const redactor = new SecretRedactor();
    const jwt = fakeJwt();
    const text = `call Bearer ${jwt} via https://admin:Sup3rS3cret!!@db.internal:5432/app`;
    const redacted = redactor.redact(text);
    expect(redacted).not.toContain(jwt);
    expect(redacted).not.toContain("Sup3rS3cret!!");
    expect(redacted).toContain("[REDACTED:BEARER_JWT]");
    expect(redacted).toContain("https://[REDACTED:URL_BASIC_AUTH]@db.internal:5432/app");
  });

  it("redacts high-entropy assignments and leaves ordinary code alone", () => {
    const redactor = new SecretRedactor();
    const assigned = `api_key="${entropySample}"`;
    expect(redactor.redact(assigned)).toBe('api_key="[REDACTED:HIGH_ENTROPY]"');
    const ordinary = [
      "export function add(left: number, right: number) {",
      '  const name = "development";',
      "  const enabled = true;",
      "  return left + right;",
      "}",
      'const token = "short";',
      'const password = "hunter2";',
    ].join("\n");
    expect(redactor.redact(ordinary)).toBe(ordinary);
  });

  it("redacts sensitive headers, nested errors, and circular values", () => {
    const redactor = redactorWithVault();
    const cause = new Error(`cause ${vaultSecret}`);
    const error = new Error(`failed ${vaultSecret}`);
    error.stack = `Error: failed ${vaultSecret}\n    at run (file.js:1:1)`;
    error.cause = cause;
    cause.cause = error;
    const value = {
      request: {
        headers: {
          Authorization: `Bearer ${vaultSecret}`,
          Cookie: `session=${vaultSecret}`,
          "Set-Cookie": `a=${vaultSecret}`,
          "X-Api-Key": vaultSecret,
          Accept: "application/json",
        },
      },
      listed: {
        headers: [
          ["Authorization", vaultSecret],
          ["Accept", "application/json"],
        ],
      },
      error,
      big: 42n,
      buf: Buffer.from(vaultSecret),
      self: {} as { self?: unknown },
    };
    value.self.self = value.self;
    const redacted = redactor.redactValue(value) as {
      request: { headers: Record<string, string> };
      listed: { headers: unknown[] };
      error: { message: string; stack: string; cause: { message: string; cause: string } };
      big: string;
      buf: { type: string; byteLength: number };
      self: { self: string };
    };
    expect(redacted.request.headers.Authorization).toBe("[REDACTED:AUTHORIZATION]");
    expect(redacted.request.headers.Cookie).toBe("[REDACTED:COOKIE]");
    expect(redacted.request.headers["Set-Cookie"]).toBe("[REDACTED:SET_COOKIE]");
    expect(redacted.request.headers["X-Api-Key"]).toBe("[REDACTED:X_API_KEY]");
    expect(redacted.request.headers.Accept).toBe("application/json");
    expect(redacted.listed.headers[0]).toEqual(["Authorization", "[REDACTED:AUTHORIZATION]"]);
    expect(redacted.listed.headers[1]).toEqual(["Accept", "application/json"]);
    expect(JSON.stringify(redacted)).not.toContain(vaultSecret);
    expect(redacted.error.message).toContain("[REDACTED:STRIPE_SECRET_KEY]");
    expect(redacted.error.stack).not.toContain(vaultSecret);
    expect(redacted.error.stack).toContain("at run");
    expect(redacted.error.cause.message).toContain("[REDACTED:STRIPE_SECRET_KEY]");
    expect(redacted.error.cause.cause).toBe("[Circular]");
    expect(redacted.big).toBe("42");
    expect(redacted.buf).toEqual({ type: "Buffer", byteLength: Buffer.byteLength(vaultSecret) });
    expect(redacted.self.self).toBe("[Circular]");
  });

  it("redacts a header map through redactHeaders", () => {
    const redacted = redactorWithVault().redactHeaders({
      authorization: vaultSecret,
      accept: "application/json",
    });
    expect(redacted.authorization).toBe("[REDACTED:AUTHORIZATION]");
    expect(redacted.accept).toBe("application/json");
  });

  it("catches a 40 character secret split across two chunks, including buffer chunks", () => {
    const redactor = new SecretRedactor();
    const secret = `canary${repeatAlphabet(34)}`;
    expect(secret).toHaveLength(40);
    redactor.register("CANARY", secret);
    const text = readStream(redactor, [secret.slice(0, 20), secret.slice(20)]);
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED:CANARY]");

    const buffered = readStream(redactor, [
      Buffer.from(secret.slice(0, 20)),
      Buffer.from(secret.slice(20)),
    ]);
    expect(buffered).not.toContain(secret);
    expect(buffered).toContain("[REDACTED:CANARY]");
  });

  it("forgets an existing label when re-registered with a short value", () => {
    const redactor = new SecretRedactor();
    const longValue = "longRegisteredSecret123";
    redactor.register("ROTATED", longValue);
    expect(redactor.redact(`val=${longValue}`)).toBe("val=[REDACTED:ROTATED]");
    redactor.register("ROTATED", "short");
    expect(redactor.redact(`val=${longValue} short`)).toBe(`val=${longValue} short`);
    expect(redactor.forget("ROTATED")).toBe(false);
  });

  it("does not leak the tail of a variable-length builtin key split across chunks", () => {
    const redactor = new SecretRedactor();
    const stripe = `${prefixes.stripeLive}${repeatAlphabet(32)}`;
    const chunk1 = `${"a".repeat(100)} ${stripe.slice(0, 24)}`;
    const chunk2 = `${stripe.slice(24)} tail`;
    const stream = redactor.openStream({ overlap: 16 });
    const output = stream.push(chunk1) + stream.push(chunk2) + stream.flush();
    expect(output).not.toContain(stripe);
    expect(output).not.toContain(stripe.slice(24));
    expect(output).toContain(`[REDACTED:${SECRET_LABEL.stripeLive}]`);
    expect(output).toContain(" tail");
  });

  it("redacts stripe live tokens split at every byte offset with zero leaked tail bytes", () => {
    const redactor = new SecretRedactor();
    const token = `${prefixes.stripeLive}1234567890abcdef`;
    const payload = `head ${token} tail`;
    const bytes = Buffer.from(payload, "utf8");
    for (let split = 1; split < bytes.length; split += 1) {
      const stream = redactor.openStream({ overlap: 16 });
      const output =
        stream.push(bytes.subarray(0, split)) +
        stream.push(bytes.subarray(split)) +
        stream.flush();
      expect(output).toBe(`head [REDACTED:${SECRET_LABEL.stripeLive}] tail`);
    }
  });

  it("decodes multi-byte UTF-8 split across Uint8Array chunks without corruption", () => {
    const redactor = new SecretRedactor();
    const secret = "caféSecretValue123";
    redactor.register("UTF8_KEY", secret);
    const bytes = Buffer.from(`prefix ${secret} suffix`, "utf8");
    const splitAt = bytes.indexOf(0xc3) + 1;
    const stream = redactor.openStream({ overlap: 8 });
    const output =
      stream.push(bytes.subarray(0, splitAt)) +
      stream.push(bytes.subarray(splitAt)) +
      stream.flush();
    expect(output).toBe("prefix [REDACTED:UTF8_KEY] suffix");
  });

  it("keeps a secret fragment that straddles a large chunk inside the overlap window", () => {
    const redactor = new SecretRedactor();
    const secret = `canary${repeatAlphabet(34)}`;
    redactor.register("CANARY", secret);
    const stream = redactor.openStream({ overlap: 64 });
    const output = [
      stream.push(`${"p".repeat(200)}${secret.slice(0, 20)}`),
      stream.push(`${secret.slice(20)} tail`),
      stream.flush(),
    ].join("");
    expect(output).not.toContain(secret);
    expect(output.startsWith("p")).toBe(true);
    expect(output).toContain(" tail");
    expect(output).toContain("[REDACTED:CANARY]");
  });

  it("uses only the [REDACTED:LABEL] placeholder shape", () => {
    const redactor = redactorWithVault();
    const stripe = `${prefixes.stripeTest}${repeatAlphabet(18)}`;
    const redacted = redactor.redact(`${vaultSecret} ${stripe} ${pemHeader()}`);
    const labels = redacted.match(/\[REDACTED:[^\]]+\]/g) ?? [];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(/^\[REDACTED:[A-Z0-9_]+\]$/);
  });
});

function readStream(redactor: SecretRedactor, chunks: readonly (string | Buffer)[]): string {
  const stream = redactor.openStream();
  return chunks.map((chunk) => stream.push(chunk)).join("") + stream.flush();
}
