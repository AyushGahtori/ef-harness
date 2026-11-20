export interface RedactionCounts {
  readonly authCookies: number;
  readonly authHeaders: number;
  readonly jwtTokens: number;
  readonly apiKeys: number;
  readonly postgresUrls: number;
  readonly pemBlocks: number;
  readonly sensitiveFields: number;
  readonly hiddenUnicode: number;
  readonly emails: number;
  readonly phones: number;
  readonly ips: number;
}

export function emptyCounts(): RedactionCounts {
  return {
    authCookies: 0,
    authHeaders: 0,
    jwtTokens: 0,
    apiKeys: 0,
    postgresUrls: 0,
    pemBlocks: 0,
    sensitiveFields: 0,
    hiddenUnicode: 0,
    emails: 0,
    phones: 0,
    ips: 0,
  };
}

export function mutableCounts(): {
  authCookies: number;
  authHeaders: number;
  jwtTokens: number;
  apiKeys: number;
  postgresUrls: number;
  pemBlocks: number;
  sensitiveFields: number;
  hiddenUnicode: number;
  emails: number;
  phones: number;
  ips: number;
} {
  return emptyCounts();
}

export type MutableCounts = ReturnType<typeof mutableCounts>;

export interface SecretFinding {
  readonly label: string;
  readonly ruleId: string;
}

export type ScrubFailureCode = "malformed_har" | "residual_secret";

export interface ScrubFailure {
  readonly ok: false;
  readonly code: ScrubFailureCode;
  readonly message: string;
}

export interface ScrubSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly badge: string;
  readonly counts: RedactionCounts;
}

export type ScrubResult<T> = ScrubSuccess<T> | ScrubFailure;

export interface HeaderPair {
  readonly name: string;
  readonly value: string;
}

export interface QueryPair {
  readonly name: string;
  readonly value: string;
}

export interface TruncatedBody {
  readonly contentType: string;
  readonly byteLength: number;
  readonly truncated: true;
}

export interface TextBody {
  readonly mimeType: string;
  readonly text: string;
}

export type ScrubbedBody = TruncatedBody | TextBody;

export interface ScrubbedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly HeaderPair[];
  readonly queryString: readonly QueryPair[];
  readonly postData: ScrubbedBody | null;
}

export interface ScrubbedResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderPair[];
  readonly content: ScrubbedBody | null;
}

export interface ScrubbedEntry {
  readonly startedDateTime: string | null;
  readonly request: ScrubbedRequest;
  readonly response: ScrubbedResponse;
}

export interface ScrubbedHar {
  readonly log: {
    readonly version: string;
    readonly entries: readonly ScrubbedEntry[];
    readonly truncatedEntries: number;
  };
}

export interface FailingHttpRequest {
  readonly method: string;
  readonly url: string;
  readonly status: number;
}

export interface MappedStackFrame {
  readonly raw: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly functionName: string | null;
  readonly source: string | null;
  readonly originalLine: number | null;
  readonly originalColumn: number | null;
  readonly resolved: boolean;
  readonly ignoredRemote: boolean;
}

export type Severity = "low" | "medium" | "high" | "critical";

export interface SymptomCard {
  readonly title: string;
  readonly observedBehavior: string;
  readonly expectedBehavior: string;
  readonly reproductionSteps: readonly string[];
  readonly affectedUrlsOrRoutes: readonly string[];
  readonly mappedStackFrames: readonly MappedStackFrame[];
  readonly failingHttpRequests: readonly FailingHttpRequest[];
  readonly suspectedDomainTags: readonly string[];
  readonly missingReproInfo: readonly string[];
  readonly severity: Severity;
}

export type IntakeRouteKind = "brownfield_fix_discovery" | "mystery_investigation";

export interface RouteDecision {
  readonly route: IntakeRouteKind;
  readonly task: "169" | "182";
  readonly reason: string;
}

export class ResidualSecretError extends Error {
  readonly code = "residual_secret" as const;

  constructor() {
    super("Scrubbed output still matched a secret pattern. Storage was aborted.");
    this.name = "ResidualSecretError";
  }
}

export const HAR_SUMMARY_MAX_BYTES = 96 * 1024;
export const MALFORMED_HAR_MESSAGE =
  "This HAR capture is truncated or is not valid JSON. Nothing was saved.";
export const RESIDUAL_SECRET_MESSAGE =
  "Scrubbed output still matched a secret pattern. Storage was aborted.";
