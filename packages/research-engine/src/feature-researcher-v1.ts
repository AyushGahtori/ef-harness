/**
 * Local stand-in for Task 009 `FeatureResearcherV1Schema`.
 * Swap for the Zod schema when `@ef-harness/shared-contracts` exports it.
 * Shape matches the success record plus the honest blocked exit.
 */

export interface ResearchNote {
  readonly id: string;
  readonly text: string;
}

export interface ResearchClaim {
  readonly id: string;
  readonly text: string;
  readonly source: {
    readonly url: string;
    readonly fetched: string;
    readonly quote: string;
  };
  readonly confidence: "low" | "medium" | "high";
}

export interface FeatureResearcherSuccess {
  readonly blocked?: undefined;
  readonly id: string;
  readonly topic: string;
  readonly claims: readonly ResearchClaim[];
  readonly constraints: readonly ResearchNote[];
  readonly edge_cases: readonly ResearchNote[];
  readonly failure_modes: readonly ResearchNote[];
  readonly open_contradictions: readonly ResearchNote[];
}

export interface FeatureResearcherBlocked {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type FeatureResearcherOutput = FeatureResearcherSuccess | FeatureResearcherBlocked;

export type ParseResult =
  | { readonly ok: true; readonly value: FeatureResearcherOutput }
  | { readonly ok: false; readonly errors: readonly string[] };

const SUCCESS_KEYS = [
  "id",
  "topic",
  "claims",
  "constraints",
  "edge_cases",
  "failure_modes",
  "open_contradictions",
] as const;

export function parseFeatureResearcherV1(value: unknown): ParseResult {
  if (!isRecord(value)) return fail("output must be an object");
  if (value.blocked === true) return parseBlocked(value);
  return parseSuccess(value);
}

function parseBlocked(value: Record<string, unknown>): ParseResult {
  const errors: string[] = [];
  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== "blocked" && key !== "reason" && key !== "missing_ids") {
      errors.push(`unknown key ${key}`);
    }
  }
  const reason = readText(value.reason, "reason", errors);
  const missingIds = "missing_ids" in value ? readIdArray(value.missing_ids, "missing_ids", errors) : undefined;
  if (errors.length > 0 || !reason || missingIds === null) return { ok: false, errors };
  if (missingIds) return { ok: true, value: { blocked: true, reason, missing_ids: missingIds } };
  return { ok: true, value: { blocked: true, reason } };
}

function parseSuccess(value: Record<string, unknown>): ParseResult {
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!SUCCESS_KEYS.includes(key as (typeof SUCCESS_KEYS)[number])) errors.push(`unknown key ${key}`);
  }
  const id = readId(value.id, "id", errors);
  const topic = readText(value.topic, "topic", errors);
  const claims = readClaims(value.claims, errors);
  const constraints = readNotes(value.constraints, "constraints", errors);
  const edgeCases = readNotes(value.edge_cases, "edge_cases", errors);
  const failureModes = readNotes(value.failure_modes, "failure_modes", errors);
  const contradictions = readNotes(value.open_contradictions, "open_contradictions", errors);
  if (errors.length > 0 || !id || !topic || !claims || !constraints || !edgeCases || !failureModes || !contradictions) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      id,
      topic,
      claims,
      constraints,
      edge_cases: edgeCases,
      failure_modes: failureModes,
      open_contradictions: contradictions,
    },
  };
}

function readClaims(value: unknown, errors: string[]): ResearchClaim[] | null {
  if (!Array.isArray(value)) {
    errors.push("claims must be an array");
    return null;
  }
  const claims: ResearchClaim[] = [];
  value.forEach((item, index) => {
    const path = `claims.${index}`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (key !== "id" && key !== "text" && key !== "source" && key !== "confidence") {
        errors.push(`${path} unknown key ${key}`);
      }
    }
    const id = readId(item.id, `${path}.id`, errors);
    const text = readText(item.text, `${path}.text`, errors);
    const source = readSource(item.source, `${path}.source`, errors);
    const confidence = item.confidence;
    if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
      errors.push(`${path}.confidence must be low, medium, or high`);
    }
    if (!id || !text || !source || (confidence !== "low" && confidence !== "medium" && confidence !== "high")) return;
    claims.push({ id, text, source, confidence });
  });
  return claims;
}

function readSource(
  value: unknown,
  path: string,
  errors: string[],
): ResearchClaim["source"] | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (key !== "url" && key !== "fetched" && key !== "quote") errors.push(`${path} unknown key ${key}`);
  }
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!isHttpUrl(url)) errors.push(`${path}.url must be http or https`);
  const fetched = typeof value.fetched === "string" ? value.fetched : "";
  if (!isIsoDate(fetched)) errors.push(`${path}.fetched must be a real YYYY-MM-DD date`);
  const quote = typeof value.quote === "string" ? value.quote.trim() : "";
  if (quote.length < 10) errors.push(`${path}.quote must be at least 10 characters`);
  if (!isHttpUrl(url) || !isIsoDate(fetched) || quote.length < 10) return null;
  return { url, fetched, quote };
}

function readNotes(value: unknown, path: string, errors: string[]): ResearchNote[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return null;
  }
  const notes: ResearchNote[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`${path}.${index} must be an object`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (key !== "id" && key !== "text") errors.push(`${path}.${index} unknown key ${key}`);
    }
    const id = readId(item.id, `${path}.${index}.id`, errors);
    const text = readText(item.text, `${path}.${index}.text`, errors);
    if (id && text) notes.push({ id, text });
  });
  return notes;
}

function readIdArray(value: unknown, path: string, errors: string[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return null;
  }
  const ids: string[] = [];
  value.forEach((item, index) => {
    const id = readId(item, `${path}.${index}`, errors);
    if (id) ids.push(id);
  });
  return ids;
}

function readId(value: unknown, path: string, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0 || /\s/.test(value.trim())) {
    errors.push(`${path} must be a non-empty id without whitespace`);
    return null;
  }
  return value.trim();
}

function readText(value: unknown, path: string, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be non-empty text`);
    return null;
  }
  return value.trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    void error;
    return false;
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): ParseResult {
  return { ok: false, errors: [message] };
}
