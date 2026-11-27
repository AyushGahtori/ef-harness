import { appUrl, joinUrl, requestJson } from "./http.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { RateLimitBurstCheckSchema } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceCheckVerifier, SurfaceVerifierContext } from "./types.js";

export class RateLimitBurstVerifier implements SurfaceCheckVerifier {
  readonly id = "rate-limit-burst";
  readonly surface = "rate-limit";

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(RateLimitBurstCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    if (check.burst <= check.limit) {
      return [
        implementationFailure(
          `${check.checkId}:X-14`,
          context,
          "burst must be larger than the limit so the 429 boundary is observable",
          { rule: "X-14" },
        ),
      ];
    }
    try {
      const base = appUrl(context.env.vars());
      const statuses: number[] = [];
      for (let index = 0; index < check.burst; index += 1) {
        const response = await requestJson(joinUrl(base, check.path), {
          method: check.method ?? "POST",
          headers: { "content-type": "application/json" },
          ...(check.body !== undefined ? { body: JSON.stringify(check.body) } : {}),
        });
        statuses.push(response.status);
      }
      const problems: string[] = [];
      statuses.forEach((status, index) => {
        const shouldLimit = index >= check.limit;
        if (shouldLimit && status !== 429) problems.push(`request ${index + 1} returned ${status} instead of 429`);
        if (!shouldLimit && status === 429) problems.push(`request ${index + 1} was limited before the burst threshold`);
      });
      const checkId = `${check.checkId}:X-14`;
      if (problems.length > 0) {
        return [
          implementationFailure(checkId, context, problems.join("; "), {
            rule: "X-14",
            statuses,
            limit: check.limit,
            burst: check.burst,
          }),
        ];
      }
      return [
        passing(checkId, context, `429 Too Many Requests starts on request ${check.limit + 1} of ${check.burst}`, {
          rule: "X-14",
          statuses,
          limit: check.limit,
          burst: check.burst,
        }),
      ];
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    }
  }
}
