import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookFormat = "stripe" | "github" | "svix" | "standard-webhooks";
export type WebhookDeliveryMode = "valid" | "forged" | "replay" | "expired_timestamp";

export interface SignedWebhookParts {
  readonly headers: Readonly<Record<string, string>>;
  readonly timestampSeconds: number;
  readonly eventId: string;
  readonly signatureMatches: boolean;
  readonly timestampExpired: boolean;
}

export function webhookHmacKey(secret: string, format: WebhookFormat): Buffer {
  if (format === "svix" || format === "standard-webhooks") return decodeSvixSecret(secret);
  return Buffer.from(secret, "utf8");
}

export function signWebhook(input: {
  readonly format: WebhookFormat;
  readonly secret: string;
  readonly body: string;
  readonly timestampSeconds: number;
  readonly eventId: string;
  readonly forged: boolean;
  readonly toleranceSeconds: number;
  readonly nowSeconds: number;
}): SignedWebhookParts {
  const key = webhookHmacKey(input.secret, input.format);
  const signingKey = input.forged ? Buffer.concat([key, Buffer.from(".forged")]) : key;
  const timestampExpired = input.nowSeconds - input.timestampSeconds > input.toleranceSeconds;
  if (input.format === "github") {
    const digest = createHmac("sha256", signingKey).update(input.body).digest("hex");
    const signature = `sha256=${digest}`;
    const expected = createHmac("sha256", key).update(input.body).digest("hex");
    return {
      headers: {
        "X-Hub-Signature-256": signature,
        "X-GitHub-Delivery": input.eventId,
      },
      timestampSeconds: input.timestampSeconds,
      eventId: input.eventId,
      signatureMatches: digest === expected && !input.forged,
      timestampExpired,
    };
  }
  if (input.format === "svix" || input.format === "standard-webhooks") {
    const signed = `${input.eventId}.${input.timestampSeconds}.${input.body}`;
    const digest = createHmac("sha256", signingKey).update(signed).digest("base64");
    const expected = createHmac("sha256", key).update(signed).digest("base64");
    const signature = `v1,${digest}`;
    return {
      headers: {
        "webhook-id": input.eventId,
        "webhook-timestamp": String(input.timestampSeconds),
        "webhook-signature": signature,
        "svix-id": input.eventId,
        "svix-timestamp": String(input.timestampSeconds),
        "svix-signature": signature,
      },
      timestampSeconds: input.timestampSeconds,
      eventId: input.eventId,
      signatureMatches: digest === expected && !input.forged,
      timestampExpired,
    };
  }
  const signed = `${input.timestampSeconds}.${input.body}`;
  const digest = createHmac("sha256", signingKey).update(signed).digest("hex");
  const expected = createHmac("sha256", key).update(signed).digest("hex");
  return {
    headers: {
      "Stripe-Signature": `t=${input.timestampSeconds},v1=${digest}`,
    },
    timestampSeconds: input.timestampSeconds,
    eventId: input.eventId,
    signatureMatches: timingSafeEqualHex(digest, expected) && !input.forged,
    timestampExpired,
  };
}

export function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds: number,
  nowSeconds: number,
): { readonly matches: boolean; readonly expired: boolean; readonly timestampSeconds: number } {
  const parsed = parseStripeSignature(header);
  const expected = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${parsed.timestampSeconds}.${payload}`)
    .digest("hex");
  const matches = parsed.signatures.some((candidate) => timingSafeEqualHex(candidate, expected));
  return {
    matches,
    expired: nowSeconds - parsed.timestampSeconds > toleranceSeconds,
    timestampSeconds: parsed.timestampSeconds,
  };
}

export function parseStripeSignature(header: string): { readonly timestampSeconds: number; readonly signatures: readonly string[] } {
  let timestampSeconds: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === "t") timestampSeconds = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestampSeconds === undefined || !Number.isFinite(timestampSeconds)) {
    throw new Error("Stripe-Signature is missing t");
  }
  return { timestampSeconds, signatures };
}

function decodeSvixSecret(secret: string): Buffer {
  const prefix = "whsec_";
  if (secret.startsWith(prefix)) {
    const rest = secret.slice(prefix.length);
    const decoded = Buffer.from(rest, "base64");
    if (decoded.length > 0 && normalizeBase64(decoded.toString("base64")) === normalizeBase64(rest)) {
      return decoded;
    }
  }
  return Buffer.from(secret, "utf8");
}

function normalizeBase64(value: string): string {
  return value.replace(/=+$/u, "");
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
