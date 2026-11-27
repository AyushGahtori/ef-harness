import type { IssueTriageSuccess } from "./issue-triage-schema.js";
import type {
  FailingHttpRequest,
  MappedStackFrame,
  Severity,
  SymptomCard,
} from "./types.js";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const CARD_KEYS = [
  "title",
  "observedBehavior",
  "expectedBehavior",
  "reproductionSteps",
  "affectedUrlsOrRoutes",
  "mappedStackFrames",
  "failingHttpRequests",
  "suspectedDomainTags",
  "missingReproInfo",
  "severity",
] as const;

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

const HOSTILE_LINE =
  /ignore\s+(all|every|previous|everything)|system\s+override|\bdelete\s+[A-Za-z0-9_./\\-]+|\bcurl\b|\|\s*sh\b|\b\/bin\/sh\b|run\s+this\s+command/i;

const DOMAIN_RULES: readonly (readonly [RegExp, string])[] = [
  [/auth|login|session|cookie/i, "auth"],
  [/pay|billing|stripe|checkout/i, "payments"],
  [/order|cutoff|cart/i, "orders"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value;
}

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}

export function isHostileInstruction(line: string): boolean {
  return HOSTILE_LINE.test(line);
}

export function inferDomainTags(text: string): string[] {
  const tags: string[] = [];
  for (const [pattern, tag] of DOMAIN_RULES) {
    if (pattern.test(text) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function inferSeverity(input: {
  readonly tags: readonly string[];
  readonly failing: readonly FailingHttpRequest[];
}): Severity {
  const security = input.tags.some((tag) => tag === "auth" || tag === "payments");
  const serverError = input.failing.some((request) => request.status >= 500);
  if (security && serverError) return "critical";
  if (serverError) return "high";
  return "medium";
}

export function parseSymptomCard(value: unknown): SymptomCard | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => FORBIDDEN_KEYS.has(key))) return null;
  if (keys.length !== CARD_KEYS.length || CARD_KEYS.some((key) => !keys.includes(key))) return null;
  if (typeof value.title !== "string" || typeof value.observedBehavior !== "string") return null;
  if (typeof value.expectedBehavior !== "string") return null;
  const steps = stringList(value.reproductionSteps);
  const urls = stringList(value.affectedUrlsOrRoutes);
  const tags = stringList(value.suspectedDomainTags);
  const missing = stringList(value.missingReproInfo);
  if (!steps || !urls || !tags || !missing || !isSeverity(value.severity)) return null;
  if (!Array.isArray(value.mappedStackFrames) || !Array.isArray(value.failingHttpRequests)) return null;
  const frames: MappedStackFrame[] = [];
  for (const item of value.mappedStackFrames) {
    const frame = readFrame(item);
    if (!frame) return null;
    frames.push(frame);
  }
  const failing: FailingHttpRequest[] = [];
  for (const item of value.failingHttpRequests) {
    const request = readRequest(item);
    if (!request) return null;
    failing.push(request);
  }
  return {
    title: value.title,
    observedBehavior: value.observedBehavior,
    expectedBehavior: value.expectedBehavior,
    reproductionSteps: steps.filter((step) => !isHostileInstruction(step)),
    affectedUrlsOrRoutes: urls,
    mappedStackFrames: frames,
    failingHttpRequests: failing,
    suspectedDomainTags: tags,
    missingReproInfo: missing,
    severity: value.severity,
  };
}

function readFrame(value: unknown): MappedStackFrame | null {
  if (!isRecord(value)) return null;
  if (typeof value.raw !== "string" || typeof value.file !== "string") return null;
  if (typeof value.line !== "number" || typeof value.column !== "number") return null;
  if (typeof value.resolved !== "boolean" || typeof value.ignoredRemote !== "boolean") return null;
  const functionName = value.functionName === null || typeof value.functionName === "string" ? value.functionName : undefined;
  const source = value.source === null || typeof value.source === "string" ? value.source : undefined;
  const originalLine = value.originalLine === null || typeof value.originalLine === "number" ? value.originalLine : undefined;
  const originalColumn =
    value.originalColumn === null || typeof value.originalColumn === "number" ? value.originalColumn : undefined;
  if (
    functionName === undefined ||
    source === undefined ||
    originalLine === undefined ||
    originalColumn === undefined
  ) {
    return null;
  }
  return {
    raw: value.raw,
    file: value.file,
    line: value.line,
    column: value.column,
    functionName,
    source,
    originalLine,
    originalColumn,
    resolved: value.resolved,
    ignoredRemote: value.ignoredRemote,
  };
}

function readRequest(value: unknown): FailingHttpRequest | null {
  if (!isRecord(value)) return null;
  if (typeof value.method !== "string" || typeof value.url !== "string" || typeof value.status !== "number") {
    return null;
  }
  return { method: value.method, url: value.url, status: value.status };
}

export function cardFromIssueTriage(
  issue: IssueTriageSuccess,
  context: {
    readonly frames: readonly MappedStackFrame[];
    readonly failing: readonly FailingHttpRequest[];
    readonly urls: readonly string[];
  },
): SymptomCard {
  const steps = (issue.steps?.text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isHostileInstruction(line));
  const modelFrames = issue.stack_frames.map((frame) => ({
    raw: frame.text,
    file: frame.file ?? frame.text,
    line: frame.line ?? 0,
    column: 0,
    functionName: null,
    source: frame.file,
    originalLine: frame.line,
    originalColumn: null,
    resolved: frame.file !== null && !/^https?:\/\//i.test(frame.file),
    ignoredRemote: frame.file !== null && /^https?:\/\//i.test(frame.file),
  }));
  const frames = modelFrames.length > 0 ? modelFrames : context.frames;
  const observed = issue.observed?.text ?? "";
  const expected = issue.expected?.text ?? "";
  const title = issue.title?.text ?? "Bug report";
  const tags = inferDomainTags(`${title}\n${observed}\n${expected}`);
  const missing = issue.missing.map((field) => {
    if (field === "observed") return "observedBehavior";
    if (field === "expected") return "expectedBehavior";
    if (field === "steps") return "reproductionSteps";
    if (field === "stack_frames") return "mappedStackFrames";
    return field;
  });
  const failing = context.failing;
  const urls = context.urls;
  return {
    title,
    observedBehavior: observed,
    expectedBehavior: expected,
    reproductionSteps: steps,
    affectedUrlsOrRoutes: urls,
    mappedStackFrames: frames,
    failingHttpRequests: failing,
    suspectedDomainTags: tags,
    missingReproInfo: missing,
    severity: inferSeverity({ tags, failing }),
  };
}

export function fallbackSymptomCard(input: {
  readonly report: string;
  readonly frames: readonly MappedStackFrame[];
  readonly failing: readonly FailingHttpRequest[];
  readonly urls: readonly string[];
}): SymptomCard {
  const lines = input.report
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isHostileInstruction(line));
  const title = lines[0]?.slice(0, 140) || "Bug report";
  const observed = lines.join("\n").slice(0, 4000);
  const tags = inferDomainTags(input.report);
  const missing = ["expectedBehavior", "reproductionSteps"];
  if (observed.length === 0) missing.push("observedBehavior");
  return {
    title,
    observedBehavior: observed,
    expectedBehavior: "",
    reproductionSteps: [],
    affectedUrlsOrRoutes: input.urls,
    mappedStackFrames: input.frames,
    failingHttpRequests: input.failing,
    suspectedDomainTags: tags,
    missingReproInfo: missing,
    severity: inferSeverity({ tags, failing: input.failing }),
  };
}

export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}
