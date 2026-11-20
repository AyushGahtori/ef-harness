import type { ZodType } from "zod";

export interface OutputPropertySpec {
  readonly schema: ZodType;
  readonly requiredFacts: readonly string[];
  readonly requiredCitations: readonly string[];
  readonly maxChars: number;
  readonly forbidden: readonly string[];
}

export interface OutputPropertyReport {
  readonly passed: boolean;
  readonly schemaOk: boolean;
  readonly missingFacts: readonly string[];
  readonly missingCitations: readonly string[];
  readonly lengthOk: boolean;
  readonly forbiddenHits: readonly string[];
  readonly serializationError: string | null;
}

export function checkOutputProperties(value: unknown, spec: OutputPropertySpec): OutputPropertyReport {
  const schemaOk = spec.schema.safeParse(value).success;
  let serialized = "";
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      schemaOk,
      missingFacts: missing(spec.requiredFacts, ""),
      missingCitations: missing(spec.requiredCitations, ""),
      lengthOk: false,
      forbiddenHits: [],
      serializationError: message,
    };
  }
  const haystack = `${serialized}\n${collectStrings(value).join("\n")}`;
  const missingFacts = missing(spec.requiredFacts, haystack);
  const missingCitations = missing(spec.requiredCitations, haystack);
  const forbiddenHits = spec.forbidden.filter((phrase) => phrase.length > 0 && haystack.includes(phrase));
  const lengthOk = serialized.length <= spec.maxChars;
  const passed =
    schemaOk && missingFacts.length === 0 && missingCitations.length === 0 && lengthOk && forbiddenHits.length === 0;
  return {
    passed,
    schemaOk,
    missingFacts,
    missingCitations,
    lengthOk,
    forbiddenHits,
    serializationError: null,
  };
}

function missing(required: readonly string[], haystack: string): string[] {
  return required.filter((fact) => !haystack.includes(fact));
}

function collectStrings(value: unknown): string[] {
  const out: string[] = [];
  walk(value, out);
  return out;
}

function walk(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, out);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) walk(entry, out);
  }
}
