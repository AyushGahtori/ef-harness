import { request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";
import { assertLoopbackHttpUrl } from "./loopback.js";
import {
  signWebhook,
  type WebhookDeliveryMode,
  type WebhookFormat,
} from "./webhook-signatures.js";

export interface WebhookDeliveryOptions {
  readonly format: WebhookFormat;
  readonly mode?: WebhookDeliveryMode;
  readonly concurrent?: boolean;
  readonly timestampSeconds?: number;
  readonly eventId?: string;
}

export interface WebhookDeliveryReceipt {
  readonly url: string;
  readonly status: number;
  readonly responseBody: string;
  readonly requestBody: string;
  readonly eventId: string;
  readonly mode: WebhookDeliveryMode;
  readonly format: WebhookFormat;
  readonly headersSent: Readonly<Record<string, string>>;
  readonly timestampSeconds: number;
  readonly signatureMatches: boolean;
  readonly timestampExpired: boolean;
}

export interface DeliverSignedWebhookOptions {
  readonly mode?: WebhookDeliveryMode;
  readonly concurrent?: boolean;
  readonly timestampSeconds?: number;
  readonly eventId?: string;
}

export class GenericWebhookDeliverer {
  private readonly clock: () => number;
  private readonly timeoutMs: number;
  private readonly toleranceSeconds: number;

  constructor(options?: {
    readonly clock?: () => number;
    readonly timeoutMs?: number;
    readonly toleranceSeconds?: number;
  }) {
    this.clock = options?.clock ?? Date.now;
    this.timeoutMs = options?.timeoutMs ?? 5_000;
    this.toleranceSeconds = options?.toleranceSeconds ?? 300;
  }

  async deliver(
    envUrl: string,
    eventPayload: unknown,
    signingSecret: string,
    options: WebhookDeliveryOptions,
  ): Promise<readonly WebhookDeliveryReceipt[]> {
    const url = assertLoopbackHttpUrl(envUrl);
    const mode = options.mode ?? "valid";
    const normalized = normalizeEvent(eventPayload, options.eventId);
    const nowSeconds = Math.floor(this.clock() / 1000);
    const timestampSeconds = resolveTimestamp(mode, nowSeconds, this.toleranceSeconds, options.timestampSeconds);
    const signed = signWebhook({
      format: options.format,
      secret: signingSecret,
      body: normalized.body,
      timestampSeconds,
      eventId: normalized.eventId,
      forged: mode === "forged",
      toleranceSeconds: this.toleranceSeconds,
      nowSeconds,
    });
    const send = (): Promise<WebhookDeliveryReceipt> =>
      postJson(url, normalized.body, signed.headers, this.timeoutMs).then((response) => ({
        url: url.toString(),
        status: response.status,
        responseBody: response.body,
        requestBody: normalized.body,
        eventId: normalized.eventId,
        mode,
        format: options.format,
        headersSent: signed.headers,
        timestampSeconds: signed.timestampSeconds,
        signatureMatches: signed.signatureMatches,
        timestampExpired: signed.timestampExpired,
      }));
    if (mode === "replay" && options.concurrent === true) {
      return Promise.all([send(), send()]);
    }
    if (mode === "replay") {
      const first = await send();
      const second = await send();
      return [first, second];
    }
    return [await send()];
  }
}

function resolveTimestamp(
  mode: WebhookDeliveryMode,
  nowSeconds: number,
  toleranceSeconds: number,
  explicit: number | undefined,
): number {
  if (explicit !== undefined) return explicit;
  if (mode === "expired_timestamp") return nowSeconds - toleranceSeconds - 60;
  return nowSeconds;
}

function normalizeEvent(payload: unknown, eventId: string | undefined): { readonly body: string; readonly eventId: string } {
  if (typeof payload === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload) as unknown;
    } catch (error) {
      throw new Error(`webhook payload is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("webhook payload must be a JSON object");
    }
    const record = { ...(parsed as Record<string, unknown>) };
    const id = eventId ?? (typeof record.id === "string" ? record.id : newEventId());
    record.id = id;
    if (typeof record.object !== "string") record.object = "event";
    return { body: JSON.stringify(record), eventId: id };
  }
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const record = { ...(payload as Record<string, unknown>) };
    const id = eventId ?? (typeof record.id === "string" ? record.id : newEventId());
    record.id = id;
    if (typeof record.object !== "string") record.object = "event";
    return { body: JSON.stringify(record), eventId: id };
  }
  throw new Error("webhook payload must be a JSON object or string");
}

function newEventId(): string {
  return `evt_${randomBytes(8).toString("hex")}`;
}

function postJson(
  url: URL,
  body: string,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("webhook delivery timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
