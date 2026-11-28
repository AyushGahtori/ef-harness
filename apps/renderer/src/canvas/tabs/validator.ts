import type { EarsOracleInput, EarsOracleResult, EarsOracleValidatorPort } from "./ports.js";

const EARS_TEXT_PATTERN =
  /^(?:when\s+.+,\s+|while\s+.+,\s+|if\s+.+,\s+then\s+|where\s+.+,\s+)?the\s+\S.+\bshall\b\s+\S.+$/i;

const VAGUE_WORDS = ["fast", "intuitive", "appropriate", "seamless", "robust", "nicely"] as const;

const VAGUE_PHRASES = ["handle gracefully", "handle nicely", "good ux", "user-friendly", "user friendly"] as const;

const OBSERVABLE =
  /(\b[1-5]\d{2}\b)|("[^"]{2,}")|('[^']{2,}')|\b\d{1,2}:\d{2}\b|\b(banner|dialog|button|spinner|skeleton|retry|confirmation|control|page|field|disabled|enabled|hidden|visible|not-found|error|message|status|audit|version|log|row|clock)\b|\b\d+\s*(ms|milliseconds|seconds|minutes|px|items|rows|mb|kb|bytes|minor units)\b/i;

const INPUT_CUE = /\b(input|enter|submit|click|request|when|given|post|get|send|open|call|boot|force|render|save|choose)\b/i;

const OUTCOME_CUE = /\b(returns?|shows?|emits?|displays?|observe[sd]?|status|hidden|visible|disabled|banner|dialog|equals?|contains?|remains?)\b/i;

export class ReviewValidationError extends Error {
  readonly cellId: string;
  readonly problems: readonly string[];

  constructor(cellId: string, problems: readonly string[]) {
    super(problems.join("; "));
    this.name = "ReviewValidationError";
    this.cellId = cellId;
    this.problems = problems;
  }
}

export function containsVagueWording(text: string): boolean {
  const lower = text.toLowerCase();
  if (VAGUE_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  return VAGUE_WORDS.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
}

export function isVague(text: string): boolean {
  if (!containsVagueWording(text)) return false;
  return !OBSERVABLE.test(text);
}

export function isConcreteOracle(text: string): boolean {
  return INPUT_CUE.test(text) && OUTCOME_CUE.test(text) && OBSERVABLE.test(text);
}

/**
 * Local stand-in for Task 080 `EarsOracleValidator`.
 * The vague list also includes "handle nicely" / "nicely" because this tab's spec names that phrase.
 */
export class LocalEarsOracleValidator implements EarsOracleValidatorPort {
  validate(input: EarsOracleInput): EarsOracleResult {
    const problems: string[] = [];
    const ears = input.earsText.trim();
    const oracle = input.oracleSketch.trim();
    if (!EARS_TEXT_PATTERN.test(ears)) {
      problems.push("ears_text must be one EARS sentence");
    }
    if (isVague(ears)) {
      problems.push("ears_text uses a vague word without an observable status, message, or bound");
    }
    if (oracle.length === 0 || isVague(oracle)) {
      problems.push("oracle_sketch uses a vague word without an observable status, message, or bound");
    }
    if (!isConcreteOracle(oracle)) {
      problems.push("oracle_sketch must name an exact input and an observable outcome, status, or UI state");
    }
    return { ok: problems.length === 0, problems };
  }
}

export function validationProblems(error: unknown): { cellId: string; problems: readonly string[] } | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { cellId?: unknown; problems?: unknown };
  if (typeof record.cellId !== "string" || !Array.isArray(record.problems)) return null;
  const problems: string[] = [];
  for (const problem of record.problems) {
    if (typeof problem !== "string") return null;
    problems.push(problem);
  }
  return { cellId: record.cellId, problems };
}
