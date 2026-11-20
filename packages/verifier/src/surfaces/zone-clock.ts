/**
 * IANA civil-time conversion via `Intl.DateTimeFormat`.
 * Offsets come from the zone database, never from a fixed UTC+1 assumption
 * and never from the host machine's local `Date#getHours()`.
 */

export interface CivilTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  FORMATTER_CACHE.set(timeZone, created);
  return created;
}

export function formatZoneParts(instant: Date, timeZone: string): CivilTime {
  const map: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = formatZoneParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant.getTime();
}

export function sameCivilTime(left: CivilTime, right: CivilTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

/**
 * Every UTC instant whose wall clock in `timeZone` is `civil`.
 * Spring-forward gaps return `[]`. Fall-back overlaps return both instants.
 */
export function resolveCivilInstants(civil: CivilTime, timeZone: string): Date[] {
  const utcGuess = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );
  let utc = utcGuess - zoneOffsetMs(new Date(utcGuess), timeZone);
  utc = utcGuess - zoneOffsetMs(new Date(utc), timeZone);
  const candidates = [utc - 3_600_000, utc, utc + 3_600_000];
  const seen = new Set<number>();
  const matches: Date[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const instant = new Date(candidate);
    if (sameCivilTime(formatZoneParts(instant, timeZone), civil)) {
      matches.push(instant);
    }
  }
  matches.sort((left, right) => left.getTime() - right.getTime());
  return matches;
}

export function parseClockTime(value: string): { hour: number; minute: number; second: number } {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`cutoff time must be HH:MM:SS, received ${value}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`cutoff time is out of range: ${value}`);
  }
  return { hour, minute, second };
}

export function parseCalendarDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`calendar date must be YYYY-MM-DD, received ${value}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function civilFromDateAndTime(date: string, time: string): CivilTime {
  return { ...parseCalendarDate(date), ...parseClockTime(time) };
}

export function shiftCivilSeconds(civil: CivilTime, deltaSeconds: number): CivilTime {
  const utc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second + deltaSeconds,
  );
  const shifted = new Date(utc);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

export function secondsSinceMidnight(time: { hour: number; minute: number; second: number }): number {
  return time.hour * 3600 + time.minute * 60 + time.second;
}

export function cutoffDecision(
  local: CivilTime,
  cutoff: { hour: number; minute: number; second: number },
  inclusive: boolean,
): boolean {
  const localSeconds = secondsSinceMidnight(local);
  const cutoffSeconds = secondsSinceMidnight(cutoff);
  return inclusive ? localSeconds <= cutoffSeconds : localSeconds < cutoffSeconds;
}
