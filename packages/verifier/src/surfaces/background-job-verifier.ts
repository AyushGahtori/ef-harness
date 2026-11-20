import { appUrl, joinUrl, requestJson } from "./http.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { BackgroundJobCheckSchema, type BackgroundJobCheck } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceVerifierAdapter, SurfaceVerifierContext } from "./types.js";

interface ObservationSnapshot {
  readonly count: number;
  readonly clockValues: readonly string[];
  readonly eventTypes: readonly string[];
}

export class BackgroundJobVerifier implements SurfaceVerifierAdapter {
  readonly id = "background-job";
  readonly surface = "job";

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(BackgroundJobCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    try {
      const base = appUrl(context.env.vars());
      const before = await this.observe(base, check);
      await this.enqueue(base, check);
      const after = await this.observe(base, check);
      await this.enqueue(base, check);
      const replay = await this.observe(base, check);
      return [this.outcome(check, context, before, after), this.idempotency(check, context, after, replay)];
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    }
  }

  private async enqueue(base: string, check: BackgroundJobCheck): Promise<void> {
    const response = await requestJson(joinUrl(base, check.enqueuePath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [check.clockHeader ?? "X-Test-Clock"]: check.clock,
      },
      body: JSON.stringify(check.payload),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`enqueue returned ${response.status}`);
    }
  }

  private async observe(base: string, check: BackgroundJobCheck): Promise<{
    database: ObservationSnapshot;
    mail: ObservationSnapshot;
    event: ObservationSnapshot;
  }> {
    const [database, mail, event] = await Promise.all([
      this.snapshot(joinUrl(base, check.observations.databasePath), check),
      this.snapshot(joinUrl(base, check.observations.mailpitPath), check),
      this.snapshot(joinUrl(base, check.observations.eventPath), check),
    ]);
    return { database, mail, event };
  }

  private async snapshot(url: string, check: BackgroundJobCheck): Promise<ObservationSnapshot> {
    const response = await requestJson(url);
    const body = response.body;
    const items = Array.isArray(body)
      ? body
      : typeof body === "object" && body !== null && Array.isArray((body as { messages?: unknown }).messages)
        ? (body as { messages: unknown[] }).messages
        : typeof body === "object" && body !== null && Array.isArray((body as { items?: unknown }).items)
          ? (body as { items: unknown[] }).items
          : [];
    const clockValues: string[] = [];
    const eventTypes: string[] = [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const clock = record[check.observations.clockField];
      if (typeof clock === "string") clockValues.push(clock);
      const type = record.type ?? record.Type;
      if (typeof type === "string") eventTypes.push(type);
    }
    return { count: items.length, clockValues, eventTypes };
  }

  private outcome(
    check: BackgroundJobCheck,
    context: SurfaceVerifierContext,
    before: { database: ObservationSnapshot; mail: ObservationSnapshot; event: ObservationSnapshot },
    after: { database: ObservationSnapshot; mail: ObservationSnapshot; event: ObservationSnapshot },
  ): SurfaceCheckResult {
    const checkId = `${check.checkId}:outcome`;
    const problems: string[] = [];
    if (after.database.count !== before.database.count + 1) problems.push("database row was not created");
    if (after.mail.count !== before.mail.count + 1) problems.push("Mailpit message was not captured");
    if (after.event.count !== before.event.count + 1) problems.push("event was not recorded");
    if (!after.event.eventTypes.includes(check.observations.eventType)) {
      problems.push(`missing event ${check.observations.eventType}`);
    }
    const clocks = [...after.database.clockValues, ...after.mail.clockValues, ...after.event.clockValues];
    if (!clocks.includes(check.clock)) problems.push("outcome does not record the injected fake clock");
    if (problems.length > 0) {
      return implementationFailure(checkId, context, problems.join("; "), { rule: "job", clock: check.clock });
    }
    return passing(checkId, context, "job produced one database row, one Mailpit message, and one event at the fake clock", {
      clock: check.clock,
    });
  }

  private idempotency(
    check: BackgroundJobCheck,
    context: SurfaceVerifierContext,
    after: { database: ObservationSnapshot; mail: ObservationSnapshot; event: ObservationSnapshot },
    replay: { database: ObservationSnapshot; mail: ObservationSnapshot; event: ObservationSnapshot },
  ): SurfaceCheckResult {
    const checkId = `${check.checkId}:X-12`;
    const problems: string[] = [];
    if (replay.database.count !== after.database.count) problems.push("database row duplicated");
    if (replay.mail.count !== after.mail.count) problems.push("Mailpit message duplicated");
    if (replay.event.count !== after.event.count) problems.push("event duplicated");
    if (problems.length > 0) {
      return implementationFailure(checkId, context, `double-run was not idempotent: ${problems.join("; ")}`, {
        rule: "X-12",
      });
    }
    return passing(checkId, context, "running the same job payload twice produced zero duplicate side effects", {
      rule: "X-12",
    });
  }
}
