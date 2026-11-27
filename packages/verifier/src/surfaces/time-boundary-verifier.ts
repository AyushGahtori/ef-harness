import { appUrl, joinUrl, requestJson } from "./http.js";
import { environmentFailure, implementationFailure, parseCheck, passing } from "./result.js";
import { TimeBoundaryCheckSchema, type TimeBoundaryCheck } from "./schemas.js";
import type { SurfaceCheckResult, SurfaceCheckVerifier, SurfaceVerifierContext } from "./types.js";
import {
  civilFromDateAndTime,
  cutoffDecision,
  formatZoneParts,
  parseClockTime,
  resolveCivilInstants,
  sameCivilTime,
  type CivilTime,
} from "./zone-clock.js";

interface TimeObservation {
  readonly storedUtc?: string;
  readonly accepted?: boolean;
  readonly exists?: boolean;
  readonly instants?: readonly string[];
  readonly display?: Partial<CivilTime> & { readonly timeZone?: string };
}

export class TimeBoundaryVerifier implements SurfaceCheckVerifier {
  readonly id = "time-boundary";
  readonly surface = "time";

  async verify(spec: unknown, context: SurfaceVerifierContext): Promise<readonly SurfaceCheckResult[]> {
    const parsed = parseCheck(TimeBoundaryCheckSchema, spec, context);
    if (!parsed.ok) return parsed.results;
    const check = parsed.value;
    try {
      const base = appUrl(context.env.vars());
      const cutoff = parseClockTime(check.cutoffLocalTime);
      const at = resolveCivilInstants(civilFromDateAndTime(check.calendarDate, check.cutoffLocalTime), check.timeZone);
      const instant = at[0];
      if (!instant || at.length !== 1) {
        return [
          implementationFailure(
            check.checkId,
            context,
            `cutoff ${check.cutoffLocalTime} is not a single instant in ${check.timeZone}`,
          ),
        ];
      }
      const probes = [
        { id: "before", instant: new Date(instant.getTime() - 1000), accepted: true },
        {
          id: "at",
          instant,
          accepted: cutoffDecision(
            formatZoneParts(instant, check.timeZone),
            cutoff,
            check.inclusive,
          ),
        },
        { id: "after", instant: new Date(instant.getTime() + 1000), accepted: false },
      ];
      const results: SurfaceCheckResult[] = [];
      for (const probe of probes) {
        results.push(await this.instantProbe(base, check, context, probe.id, probe.instant, probe.accepted));
      }
      const summer = resolveCivilInstants(
        civilFromDateAndTime(check.summerDate, check.cutoffLocalTime),
        check.timeZone,
      )[0];
      if (!summer) {
        results.push(
          implementationFailure(`${check.checkId}:summer`, context, "summer cutoff did not resolve in the project zone"),
        );
      } else {
        results.push(
          await this.instantProbe(
            base,
            check,
            context,
            "summer",
            summer,
            cutoffDecision(formatZoneParts(summer, check.timeZone), cutoff, check.inclusive),
          ),
        );
      }
      results.push(await this.gapProbe(base, check, context));
      results.push(await this.overlapProbe(base, check, context));
      return results;
    } catch (error) {
      return [environmentFailure(check.checkId, context, error instanceof Error ? error.message : String(error))];
    }
  }

  private async instantProbe(
    base: string,
    check: TimeBoundaryCheck,
    context: SurfaceVerifierContext,
    id: string,
    instant: Date,
    accepted: boolean,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:${id}`;
    const response = await requestJson(joinUrl(base, check.evaluatePath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [check.clockHeader ?? "X-Test-Clock"]: instant.toISOString(),
      },
      body: JSON.stringify({ timeZone: check.timeZone }),
    });
    const body = (response.body ?? {}) as TimeObservation;
    const expectedDisplay = formatZoneParts(instant, check.timeZone);
    const problems: string[] = [];
    if (response.status !== 200) problems.push(`status ${response.status}`);
    if (Date.parse(body.storedUtc ?? "") !== instant.getTime()) {
      problems.push(`stored ${body.storedUtc ?? "missing"} is not UTC instant ${instant.toISOString()}`);
    }
    if (!body.display || !sameCivilTime(asCivil(body.display), expectedDisplay) || body.display.timeZone !== check.timeZone) {
      problems.push("display is not the project timezone wall clock");
    }
    if (body.accepted !== accepted) {
      problems.push(`accepted ${String(body.accepted)} !== ${String(accepted)} at ${expectedDisplay.hour}:${expectedDisplay.minute}:${expectedDisplay.second}`);
    }
    if (problems.length > 0) {
      return implementationFailure(checkId, context, problems.join("; "), {
        injectedUtc: instant.toISOString(),
        expectedDisplay,
        expectedAccepted: accepted,
      });
    }
    return passing(checkId, context, `${id} matched UTC storage, ${check.timeZone} display, and the cutoff`, {
      injectedUtc: instant.toISOString(),
      timeZone: check.timeZone,
    });
  }

  private async gapProbe(
    base: string,
    check: TimeBoundaryCheck,
    context: SurfaceVerifierContext,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:dst-spring`;
    const expected = resolveCivilInstants(check.springGap, check.timeZone);
    const response = await requestJson(joinUrl(base, check.civilPath), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeZone: check.timeZone, civil: check.springGap }),
    });
    const body = (response.body ?? {}) as TimeObservation;
    if (expected.length !== 0 || body.exists !== false) {
      return implementationFailure(
        checkId,
        context,
        `spring-forward gap was treated as a real local time (exists=${String(body.exists)}, resolved=${expected.length})`,
        { civil: check.springGap, timeZone: check.timeZone },
      );
    }
    return passing(checkId, context, "spring-forward gap is rejected using IANA rules", {
      timeZone: check.timeZone,
      civil: check.springGap,
    });
  }

  private async overlapProbe(
    base: string,
    check: TimeBoundaryCheck,
    context: SurfaceVerifierContext,
  ): Promise<SurfaceCheckResult> {
    const checkId = `${check.checkId}:dst-fall`;
    const expected = resolveCivilInstants(check.fallOverlap, check.timeZone).map((instant) => instant.toISOString());
    const response = await requestJson(joinUrl(base, check.civilPath), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeZone: check.timeZone, civil: check.fallOverlap }),
    });
    const body = (response.body ?? {}) as TimeObservation;
    const actual = [...(body.instants ?? [])].sort();
    const wanted = [...expected].sort();
    if (body.exists !== true || actual.length !== 2 || actual.some((value, index) => value !== wanted[index])) {
      return implementationFailure(
        checkId,
        context,
        `fall-back overlap did not return both UTC instants (${actual.join(", ") || "none"})`,
        { expected: wanted, timeZone: check.timeZone },
      );
    }
    return passing(checkId, context, "fall-back overlap keeps both UTC instants and the project-zone display", {
      instants: wanted,
      timeZone: check.timeZone,
    });
  }
}

function asCivil(value: Partial<CivilTime>): CivilTime {
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
    second: Number(value.second),
  };
}
