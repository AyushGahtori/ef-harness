/**
 * Local port of Task 009 `IssueTriageV1Schema`.
 * The real Zod schema is not on this base. Integration should swap this parser
 * for the shared-contracts export without changing the triager's tool-less call.
 */

const SYMPTOM_FIELDS = [
  "title",
  "observed",
  "expected",
  "steps",
  "environment",
  "frequency",
  "first_seen",
  "last_seen",
  "affected_users",
  "stack_frames",
] as const;

export type SymptomField = (typeof SYMPTOM_FIELDS)[number];

export interface TextLocator {
  readonly kind: "text";
  readonly line_start: number;
  readonly line_end: number;
  readonly char_start: number;
  readonly char_end: number;
}

export interface LocatedText {
  readonly text: string;
  readonly locator: TextLocator;
}

export interface IssueTriageFrame {
  readonly text: string;
  readonly locator: TextLocator;
  readonly file: string | null;
  readonly line: number | null;
}

export interface IssueTriageSuccess {
  readonly title: LocatedText | null;
  readonly observed: LocatedText | null;
  readonly expected: LocatedText | null;
  readonly steps: LocatedText | null;
  readonly environment: LocatedText | null;
  readonly frequency: LocatedText | null;
  readonly first_seen: LocatedText | null;
  readonly last_seen: LocatedText | null;
  readonly affected_users: LocatedText | null;
  readonly stack_frames: readonly IssueTriageFrame[];
  readonly missing: readonly SymptomField[];
}

export type IssueTriageParse =
  | { readonly kind: "card"; readonly value: IssueTriageSuccess }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "invalid" };

const FORBIDDEN_KEYS = new Set([
  "command",
  "commands",
  "tool",
  "tools",
  "shell",
  "exec",
  "function_call",
  "tool_calls",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasForbiddenKey(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key));
}

function isTextLocator(value: unknown): value is TextLocator {
  if (!isRecord(value)) return false;
  if (value.kind !== "text") return false;
  const lineStart = value.line_start;
  const lineEnd = value.line_end;
  const charStart = value.char_start;
  const charEnd = value.char_end;
  return (
    typeof lineStart === "number" &&
    Number.isInteger(lineStart) &&
    lineStart >= 1 &&
    typeof lineEnd === "number" &&
    Number.isInteger(lineEnd) &&
    lineEnd >= lineStart &&
    typeof charStart === "number" &&
    Number.isInteger(charStart) &&
    charStart >= 0 &&
    typeof charEnd === "number" &&
    Number.isInteger(charEnd) &&
    charEnd > charStart
  );
}

function isLocated(value: unknown): value is LocatedText {
  if (!isRecord(value)) return false;
  if (typeof value.text !== "string" || value.text.trim().length === 0) return false;
  return isTextLocator(value.locator);
}

function isFrame(value: unknown): value is IssueTriageFrame {
  if (!isRecord(value)) return false;
  if (typeof value.text !== "string" || value.text.trim().length === 0) return false;
  if (!isTextLocator(value.locator)) return false;
  const fileOk = value.file === null || typeof value.file === "string";
  const lineOk = value.line === null || (typeof value.line === "number" && Number.isInteger(value.line) && value.line >= 1);
  return fileOk && lineOk;
}

function isSymptomField(value: string): value is SymptomField {
  return (SYMPTOM_FIELDS as readonly string[]).includes(value);
}

export const IssueTriageV1Schema = {
  contractId: "issue-triage@1",
  toolAccess: "none",
  parse(value: unknown): IssueTriageParse {
    if (!isRecord(value) || hasForbiddenKey(value)) return { kind: "invalid" };
    if (value.blocked === true) {
      if (typeof value.reason !== "string" || value.reason.trim().length === 0) return { kind: "invalid" };
      const keys = Object.keys(value).filter((key) => key !== "missing_ids");
      if (keys.some((key) => key !== "blocked" && key !== "reason")) return { kind: "invalid" };
      return { kind: "blocked", reason: value.reason };
    }
    const required = [
      "title",
      "observed",
      "expected",
      "steps",
      "environment",
      "frequency",
      "first_seen",
      "last_seen",
      "affected_users",
      "stack_frames",
      "missing",
    ];
    if (required.some((key) => !(key in value))) return { kind: "invalid" };
    const locatedFields = [
      "title",
      "observed",
      "expected",
      "steps",
      "environment",
      "frequency",
      "first_seen",
      "last_seen",
      "affected_users",
    ] as const;
    for (const field of locatedFields) {
      const current = value[field];
      if (current !== null && !isLocated(current)) return { kind: "invalid" };
    }
    if (!Array.isArray(value.stack_frames)) return { kind: "invalid" };
    const frames: IssueTriageFrame[] = [];
    for (const item of value.stack_frames) {
      if (!isFrame(item)) return { kind: "invalid" };
      frames.push(item);
    }
    if (!Array.isArray(value.missing)) return { kind: "invalid" };
    const missing: SymptomField[] = [];
    for (const item of value.missing) {
      if (typeof item !== "string" || !isSymptomField(item)) return { kind: "invalid" };
      missing.push(item);
    }
    for (const field of SYMPTOM_FIELDS) {
      const present = field === "stack_frames" ? frames.length > 0 : value[field] !== null;
      const listed = missing.includes(field);
      if (present === listed) return { kind: "invalid" };
    }
    return {
      kind: "card",
      value: {
        title: locatedOrNull(value.title),
        observed: locatedOrNull(value.observed),
        expected: locatedOrNull(value.expected),
        steps: locatedOrNull(value.steps),
        environment: locatedOrNull(value.environment),
        frequency: locatedOrNull(value.frequency),
        first_seen: locatedOrNull(value.first_seen),
        last_seen: locatedOrNull(value.last_seen),
        affected_users: locatedOrNull(value.affected_users),
        stack_frames: frames,
        missing,
      },
    };
  },
};

function locatedOrNull(value: unknown): LocatedText | null {
  if (value === null) return null;
  if (!isLocated(value)) return null;
  return value;
}
