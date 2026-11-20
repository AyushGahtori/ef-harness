import {
  buildResolutionOptions,
  makeConflictId,
  type ConflictDraft,
  type IntervalBound,
  type IntervalClaimInput,
  type IntervalQualifier,
  type IntervalSource,
  type UnitFamily,
} from "./types.js";

interface NormalizedClaim {
  readonly nodeId: string;
  readonly key: string;
  readonly family: UnitFamily;
  readonly bound: IntervalBound;
  readonly value: number;
  readonly qualifier: IntervalQualifier;
  readonly qualifierSource: "structured" | "inferred";
  readonly label: string;
}

const BYTE_UNITS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  kb: 1024,
  kib: 1024,
  mb: 1_000_000,
  mib: 1_048_576,
  gb: 1_000_000_000,
  gib: 1_073_741_824,
};

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

/**
 * Layer 4. Normalizes sizes, durations, clocks, minor currency, and counts to integers
 * before intersection and ordering checks.
 * KB/KiB are 1024-based so 5120 KB equals 5 MiB. MB/GB stay decimal so 5 MB is not 5 MiB.
 * Idle and absolute session bounds conflict on prose alone. They stay compatible when
 * both sides carry structured qualifiers that differ.
 */
export class IntervalConflictDetector {
  detect(sources: readonly IntervalSource[]): ConflictDraft[] {
    const { claims, noEditsAfterPrep } = collect(sources);
    const conflicts: ConflictDraft[] = [];
    conflicts.push(...intersect(claims));
    conflicts.push(...orderClocks(claims, noEditsAfterPrep));
    return dedupe(conflicts);
  }

  /** Sources that share a normalized key, or a clock-ordering key, with the edited node. */
  relatedSources(sources: readonly IntervalSource[], editedId: string): IntervalSource[] {
    const edited = sources.find((source) => source.nodeId === editedId);
    if (edited === undefined) return [];
    const keys = new Set(collect([edited]).claims.map((claim) => claim.key));
    const clock =
      keys.has("order_cutoff") ||
      keys.has("prep_starts") ||
      keys.has("kitchen_print") ||
      /no edits after prep/i.test(edited.text);
    if (keys.size === 0 && !clock) return [];
    return sources.filter((source) => {
      if (source.nodeId === editedId) return true;
      const sourceKeys = collect([source]).claims.map((claim) => claim.key);
      if (sourceKeys.some((key) => keys.has(key))) return true;
      if (clock && sourceKeys.some((key) => key === "order_cutoff" || key === "prep_starts" || key === "kitchen_print")) {
        return true;
      }
      return clock && /no edits after prep/i.test(source.text);
    });
  }
}

function collect(sources: readonly IntervalSource[]): { claims: NormalizedClaim[]; noEditsAfterPrep: boolean } {
  const claims: NormalizedClaim[] = [];
  let noEditsAfterPrep = false;
  for (const source of sources) {
    if (/no edits after prep/i.test(source.text)) noEditsAfterPrep = true;
    if (source.claims !== undefined && source.claims.length > 0) {
      for (const claim of source.claims) {
        const normalized = normalizeStructured(source.nodeId, claim);
        if (normalized !== null) claims.push(normalized);
      }
      continue;
    }
    claims.push(...parseText(source.nodeId, source.text));
  }
  return { claims, noEditsAfterPrep };
}

function normalizeStructured(nodeId: string, claim: IntervalClaimInput): NormalizedClaim | null {
  const value = canonical(claim.family, claim.amount, claim.unit);
  if (value === null) return null;
  return {
    nodeId,
    key: canonicalKey(claim.key, claim.family),
    family: claim.family,
    bound: claim.bound,
    value,
    qualifier: claim.qualifier ?? "unspecified",
    qualifierSource: "structured",
    label: `${claim.amount} ${claim.unit}`,
  };
}

function parseText(nodeId: string, text: string): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const sizePattern =
    /\b([A-Za-z][\w]*)\s*=\s*(\d+(?:\.\d+)?)\s*(bytes|byte|kb|kib|mb|mib|gb|gib)\b/gi;
  for (const match of text.matchAll(sizePattern)) {
    const key = match[1];
    const amount = match[2];
    const unit = match[3];
    if (key === undefined || amount === undefined || unit === undefined) continue;
    const value = scaleDecimal(amount, BYTE_UNITS[unit.toLowerCase()] ?? 0);
    if (value === null) continue;
    claims.push(claimOf(nodeId, canonicalKey(key, "bytes"), "bytes", boundForKey(key), value, "unspecified", "inferred", `${amount} ${unit}`));
  }
  const attachPattern = /\battach\s+(\d+(?:\.\d+)?)\s*(bytes|byte|kb|kib|mb|mib|gb|gib)\b/gi;
  for (const match of text.matchAll(attachPattern)) {
    const amount = match[1];
    const unit = match[2];
    if (amount === undefined || unit === undefined) continue;
    const value = scaleDecimal(amount, BYTE_UNITS[unit.toLowerCase()] ?? 0);
    if (value === null) continue;
    claims.push(claimOf(nodeId, "upload_bytes", "bytes", "min", value, "unspecified", "inferred", `attach ${amount} ${unit}`));
  }
  const durationPattern =
    /\b([A-Za-z][\w]*)\s*=\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds|s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b/gi;
  for (const match of text.matchAll(durationPattern)) {
    const key = match[1];
    const amount = match[2];
    const unit = match[3];
    if (key === undefined || amount === undefined || unit === undefined) continue;
    const multiplier = DURATION_UNITS[unit.toLowerCase()];
    if (multiplier === undefined) continue;
    const value = scaleDecimal(amount, multiplier);
    if (value === null) continue;
    const session = /session|ttl|logout/i.test(key);
    claims.push(
      claimOf(
        nodeId,
        session ? "session" : key.toLowerCase(),
        "duration_ms",
        boundForKey(key),
        value,
        session ? "absolute" : "unspecified",
        "inferred",
        `${key} = ${amount} ${unit}`,
      ),
    );
  }
  const logoutPattern =
    /\bauto-logout after\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\b(?:\s+(inactivity|idle))?/gi;
  for (const match of text.matchAll(logoutPattern)) {
    const amount = match[1];
    const unit = match[2];
    const idleWord = match[3];
    if (amount === undefined || unit === undefined) continue;
    const multiplier = DURATION_UNITS[unit.toLowerCase()];
    if (multiplier === undefined) continue;
    const value = scaleDecimal(amount, multiplier);
    if (value === null) continue;
    claims.push(
      claimOf(
        nodeId,
        "session",
        "duration_ms",
        "exact",
        value,
        idleWord === undefined ? "unspecified" : "idle",
        "inferred",
        match[0] ?? `${amount} ${unit}`,
      ),
    );
  }
  claims.push(...parseClocks(nodeId, text));
  claims.push(...parseMoneyAndCounts(nodeId, text));
  return claims;
}

function parseClocks(nodeId: string, text: string): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const patterns: readonly { readonly key: string; readonly pattern: RegExp }[] = [
    { key: "order_cutoff", pattern: /\border[_ ]cutoff\s*=\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi },
    { key: "prep_starts", pattern: /\bprep[_ ]starts\s*=\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi },
    { key: "order_cutoff", pattern: /\bcutoff(?:\s+time)?[^0-9]{0,24}(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi },
    { key: "kitchen_print", pattern: /\bprints at\s+(\d{1,2}:\d{2}\s*(?:am|pm)?)/gi },
  ];
  const seen = new Set<string>();
  for (const entry of patterns) {
    for (const match of text.matchAll(entry.pattern)) {
      const token = match[1];
      if (token === undefined) continue;
      const minutes = parseClock(token);
      if (minutes === null) continue;
      const stamp = `${entry.key}:${minutes}`;
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      claims.push(claimOf(nodeId, entry.key, "minutes_of_day", "exact", minutes, "unspecified", "inferred", token.trim()));
    }
  }
  return claims;
}

function parseMoneyAndCounts(nodeId: string, text: string): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  for (const match of text.matchAll(/\b([A-Za-z][\w]*)\s*=\s*\$(\d+)\.(\d{2})\b/gi)) {
    const key = match[1];
    const dollars = match[2];
    const cents = match[3];
    if (key === undefined || dollars === undefined || cents === undefined) continue;
    const value = Number(dollars) * 100 + Number(cents);
    if (!Number.isSafeInteger(value)) continue;
    claims.push(claimOf(nodeId, key.toLowerCase(), "minor_currency", boundForKey(key), value, "unspecified", "inferred", `$${dollars}.${cents}`));
  }
  for (const match of text.matchAll(/\b([A-Za-z][\w]*)\s*=\s*(\d+)\s+cents\b/gi)) {
    const key = match[1];
    const cents = match[2];
    if (key === undefined || cents === undefined) continue;
    claims.push(claimOf(nodeId, key.toLowerCase(), "minor_currency", boundForKey(key), Number(cents), "unspecified", "inferred", `${cents} cents`));
  }
  for (const match of text.matchAll(/\b([A-Za-z][\w]*)\s*=\s*(\d+)\s+rows\b/gi)) {
    const key = match[1];
    const rows = match[2];
    if (key === undefined || rows === undefined) continue;
    claims.push(claimOf(nodeId, canonicalKey(key, "count"), "count", boundForKey(key), Number(rows), "unspecified", "inferred", `${rows} rows`));
  }
  return claims;
}

function claimOf(
  nodeId: string,
  key: string,
  family: UnitFamily,
  bound: IntervalBound,
  value: number,
  qualifier: IntervalQualifier,
  qualifierSource: "structured" | "inferred",
  label: string,
): NormalizedClaim {
  return { nodeId, key, family, bound, value, qualifier, qualifierSource, label };
}

function intersect(claims: readonly NormalizedClaim[]): ConflictDraft[] {
  const groups = new Map<string, NormalizedClaim[]>();
  for (const claim of claims) {
    if (claim.family === "minutes_of_day" && (claim.key === "order_cutoff" || claim.key === "prep_starts" || claim.key === "kitchen_print")) {
      continue;
    }
    const bucket = groupKey(claim);
    const list = groups.get(bucket);
    if (list === undefined) groups.set(bucket, [claim]);
    else list.push(claim);
  }
  const conflicts: ConflictDraft[] = [];
  for (const group of groups.values()) {
    let lower: number | null = null;
    let lowerClaim: NormalizedClaim | null = null;
    let upper: number | null = null;
    let upperClaim: NormalizedClaim | null = null;
    for (const claim of group) {
      if ((claim.bound === "min" || claim.bound === "exact") && (lower === null || claim.value > lower)) {
        lower = claim.value;
        lowerClaim = claim;
      }
      if ((claim.bound === "max" || claim.bound === "exact") && (upper === null || claim.value < upper)) {
        upper = claim.value;
        upperClaim = claim;
      }
    }
    if (lower === null || upper === null || lowerClaim === null || upperClaim === null) continue;
    if (lower <= upper) continue;
    if (lowerClaim.nodeId === upperClaim.nodeId) continue;
    conflicts.push(intervalConflict(lowerClaim, upperClaim, lower, upper));
  }
  return conflicts;
}

function groupKey(claim: NormalizedClaim): string {
  if (claim.qualifierSource === "structured") {
    return `${claim.key}|${claim.family}|structured|${claim.qualifier}`;
  }
  return `${claim.key}|${claim.family}|inferred`;
}

function orderClocks(claims: readonly NormalizedClaim[], noEditsAfterPrep: boolean): ConflictDraft[] {
  const conflicts: ConflictDraft[] = [];
  const prints = claims.filter((claim) => claim.key === "kitchen_print");
  const cutoffs = claims.filter((claim) => claim.key === "order_cutoff");
  const preps = claims.filter((claim) => claim.key === "prep_starts");
  for (const print of prints) {
    for (const cutoff of cutoffs) {
      if (print.value >= cutoff.value) continue;
      conflicts.push({
        id: makeConflictId(4, "clock_order", [print.nodeId, cutoff.nodeId]),
        layer: 4,
        nodeIds: [print.nodeId, cutoff.nodeId].sort(),
        ruleId: "clock_order",
        plainEnglishConflict: `Kitchen print at ${print.label} is before cutoff ${cutoff.label}.`,
        concreteCounterexample: `${print.value} minutes-of-day is before ${cutoff.value} minutes-of-day, so a final kitchen print cannot wait for orders that stay open until cutoff.`,
        resolutionOptions: buildResolutionOptions([print.label, cutoff.label], []),
      });
    }
  }
  if (!noEditsAfterPrep) return conflicts;
  for (const prep of preps) {
    for (const cutoff of cutoffs) {
      if (prep.value >= cutoff.value) continue;
      conflicts.push({
        id: makeConflictId(4, "prep_before_cutoff", [prep.nodeId, cutoff.nodeId]),
        layer: 4,
        nodeIds: [prep.nodeId, cutoff.nodeId].sort(),
        ruleId: "prep_before_cutoff",
        plainEnglishConflict: `Prep starts at ${prep.label} but order cutoff is ${cutoff.label} while edits are forbidden after prep starts.`,
        concreteCounterexample: `No edits after ${prep.value} minutes-of-day, yet orders remain open until ${cutoff.value} minutes-of-day.`,
        resolutionOptions: buildResolutionOptions([prep.label, cutoff.label], []),
      });
    }
  }
  return conflicts;
}

function intervalConflict(lower: NormalizedClaim, upper: NormalizedClaim, lowerValue: number, upperValue: number): ConflictDraft {
  const unit = unitName(lower.family);
  return {
    id: makeConflictId(4, `interval:${lower.key}`, [lower.nodeId, upper.nodeId]),
    layer: 4,
    nodeIds: [lower.nodeId, upper.nodeId].sort(),
    ruleId: `interval:${lower.key}`,
    plainEnglishConflict: `${lower.key} needs at least ${lower.label} but allows at most ${upper.label}.`,
    concreteCounterexample: `${lower.key} lower bound ${lowerValue} ${unit} is above upper bound ${upperValue} ${unit}, so the intersection is empty.`,
    resolutionOptions: buildResolutionOptions([lower.label, upper.label], []),
  };
}

function dedupe(conflicts: readonly ConflictDraft[]): ConflictDraft[] {
  const seen = new Set<string>();
  const out: ConflictDraft[] = [];
  for (const conflict of conflicts) {
    if (seen.has(conflict.id)) continue;
    seen.add(conflict.id);
    out.push(conflict);
  }
  return out;
}

function boundForKey(key: string): IntervalBound {
  const lower = key.toLowerCase();
  if (lower.includes("max")) return "max";
  if (lower.includes("min")) return "min";
  return "exact";
}

function canonicalKey(raw: string, family: UnitFamily): string {
  const key = raw.toLowerCase();
  if (family === "bytes" && (key.includes("upload") || key.includes("attach"))) return "upload_bytes";
  if (family === "duration_ms" && /session|ttl|logout/.test(key)) return "session";
  const stripped = key.replace(/_(max|min)$/g, "").replace(/(max|min)$/g, "");
  return stripped.length > 0 ? stripped : key;
}

function canonical(family: UnitFamily, amount: number, unit: string): number | null {
  if (!Number.isFinite(amount)) return null;
  if (family === "minutes_of_day") {
    if (unit === "minute" || unit === "minutes") return integer(amount);
    const clock = parseClock(unit);
    if (clock !== null) return clock;
    return integer(amount);
  }
  if (family === "bytes") return scaleDecimal(String(amount), BYTE_UNITS[unit.toLowerCase()] ?? 0);
  if (family === "duration_ms") {
    const multiplier = DURATION_UNITS[unit.toLowerCase()];
    if (multiplier === undefined) return null;
    return scaleDecimal(String(amount), multiplier);
  }
  if (family === "minor_currency") {
    if (unit === "cents" || unit === "minor") return integer(amount);
    return null;
  }
  if (family === "count") return integer(amount);
  return null;
}

function scaleDecimal(amount: string, multiplier: number): number | null {
  if (!Number.isInteger(multiplier) || multiplier <= 0) return null;
  const trimmed = amount.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fracRaw = ""] = body.split(".");
  if (wholeRaw === undefined || !/^\d+$/.test(wholeRaw) || (fracRaw.length > 0 && !/^\d+$/.test(fracRaw))) return null;
  const base = 10 ** fracRaw.length;
  const numer = Number(wholeRaw) * base + Number(fracRaw === "" ? "0" : fracRaw);
  if (!Number.isSafeInteger(numer) || !Number.isSafeInteger(base)) return null;
  const product = numer * multiplier;
  if (!Number.isSafeInteger(product)) return null;
  if (product % base !== 0) return null;
  const value = product / base;
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

function integer(amount: number): number | null {
  if (!Number.isInteger(amount)) return null;
  return amount;
}

function parseClock(token: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(token.trim());
  if (match === null) return null;
  const hourText = match[1];
  const minuteText = match[2];
  if (hourText === undefined || minuteText === undefined) return null;
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59 || hour > 23) return null;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "am") {
    if (hour > 12) return null;
    if (hour === 12) hour = 0;
  } else if (meridiem === "pm") {
    if (hour > 12) return null;
    if (hour < 12) hour += 12;
  }
  return hour * 60 + minute;
}

function unitName(family: UnitFamily): string {
  switch (family) {
    case "bytes":
      return "bytes";
    case "duration_ms":
      return "ms";
    case "minutes_of_day":
      return "minutes-of-day";
    case "minor_currency":
      return "minor currency";
    case "count":
      return "rows";
    default: {
      const neverFamily: never = family;
      return neverFamily;
    }
  }
}
