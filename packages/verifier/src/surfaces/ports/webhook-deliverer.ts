import { createHmac } from "node:crypto";
import { requestJson } from "../http.js";

/**
 * Local port of Task 051 `GenericWebhookDeliverer` / Stripe webhook signer.
 * Computes real HMAC-SHA256 signatures. Forged deliveries flip the digest.
 */

export type WebhookStyle = "github" | "stripe";

export interface SignedWebhook {
  readonly headerName: string;
  readonly headerValue: string;
  readonly body: string;
}

export function signWebhook(input: {
  readonly body: string;
  readonly secret: string;
  readonly style: WebhookStyle;
  readonly timestamp?: number;
  readonly forged?: boolean;
}): SignedWebhook {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  if (input.style === "github") {
    const digest = createHmac("sha256", input.secret).update(input.body).digest("hex");
    const headerValue = input.forged ? `sha256=${"0".repeat(64)}` : `sha256=${digest}`;
    return { headerName: "x-hub-signature-256", headerValue, body: input.body };
  }
  const payload = `${timestamp}.${input.body}`;
  const digest = createHmac("sha256", input.secret).update(payload).digest("hex");
  const signature = input.forged ? "0".repeat(64) : digest;
  return {
    headerName: "stripe-signature",
    headerValue: `t=${timestamp},v1=${signature}`,
    body: input.body,
  };
}

export class GenericWebhookDeliverer {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  sign(input: {
    readonly body: string;
    readonly secret: string;
    readonly style: WebhookStyle;
    readonly timestamp?: number;
    readonly forged?: boolean;
  }): SignedWebhook {
    return signWebhook(input);
  }

  async deliver(input: {
    readonly url: string;
    readonly body: string;
    readonly secret: string;
    readonly style: WebhookStyle;
    readonly eventId: string;
    readonly forged?: boolean;
    readonly timestamp?: number;
  }): Promise<{ readonly status: number; readonly body: unknown }> {
    const signed = this.sign(input);
    const response = await requestJson(
      input.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [signed.headerName]: signed.headerValue,
          "x-event-id": input.eventId,
        },
        body: signed.body,
      },
      this.fetchImpl,
    );
    return { status: response.status, body: response.body };
  }
}
