import { appUrl, joinUrl, requestJson } from "./http.js";
import { GenericWebhookDeliverer } from "./ports/webhook-deliverer.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { InboundWebhookCheckSchema } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceCheckVerifier, SurfaceVerifierContext } from "./types.js";

export interface WebhookDependencies {
  readonly deliverer?: GenericWebhookDeliverer;
}

export class InboundWebhookVerifier implements SurfaceCheckVerifier {
  readonly id = "inbound-webhook";
  readonly surface = "webhook";

  constructor(private readonly dependencies: WebhookDependencies = {}) {}

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(InboundWebhookCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    const deliverer = this.dependencies.deliverer ?? new GenericWebhookDeliverer();
    try {
      const base = appUrl(context.env.vars());
      const url = joinUrl(base, check.targetPath);
      const body = JSON.stringify({ ...check.payload, id: check.eventId });
      const before = await countEvents(joinUrl(base, check.observationPath));
      const valid = await deliverer.deliver({
        url,
        body,
        secret: check.secret,
        style: check.style,
        eventId: check.eventId,
      });
      const forged = await deliverer.deliver({
        url,
        body,
        secret: check.secret,
        style: check.style,
        eventId: `${check.eventId}-forged`,
        forged: true,
      });
      const afterValid = await countEvents(joinUrl(base, check.observationPath));
      await deliverer.deliver({
        url,
        body,
        secret: check.secret,
        style: check.style,
        eventId: check.eventId,
      });
      const afterReplay = await countEvents(joinUrl(base, check.observationPath));
      const results: SurfaceCheckResult[] = [];
      const forgedId = `${check.checkId}:X-09:forged`;
      if (forged.status !== 400 && forged.status !== 401) {
        results.push(
          implementationFailure(forgedId, context, `forged signature returned ${forged.status}`, { rule: "X-09" }),
        );
      } else if (valid.status < 200 || valid.status >= 300) {
        results.push(
          implementationFailure(forgedId, context, `valid signature returned ${valid.status}`, { rule: "X-09" }),
        );
      } else {
        results.push(passing(forgedId, context, "forged webhook signature was rejected and a valid signature was accepted", {
          rule: "X-09",
          forgedStatus: forged.status,
          validStatus: valid.status,
        }));
      }
      const replayId = `${check.checkId}:X-09:replay`;
      if (afterValid !== before + 1 || afterReplay !== afterValid) {
        results.push(
          implementationFailure(
            replayId,
            context,
            `duplicate event ${check.eventId} changed side effects from ${afterValid} to ${afterReplay}`,
            { rule: "X-09", before, afterValid, afterReplay },
          ),
        );
      } else {
        results.push(passing(replayId, context, "duplicate event id was idempotent", {
          rule: "X-09",
          eventId: check.eventId,
        }));
      }
      return results;
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    }
  }
}

async function countEvents(url: string): Promise<number> {
  const response = await requestJson(url);
  if (typeof response.body === "object" && response.body !== null && typeof (response.body as { count?: unknown }).count === "number") {
    return (response.body as { count: number }).count;
  }
  if (Array.isArray(response.body)) return response.body.length;
  return 0;
}
