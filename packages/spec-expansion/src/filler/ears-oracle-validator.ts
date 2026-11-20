const EARS_TEXT_PATTERN =
  /^(?:when\s+.+,\s+|while\s+.+,\s+|if\s+.+,\s+then\s+|where\s+.+,\s+)?the\s+\S.+\bshall\b\s+\S.+$/i;

const VAGUE_WORDS = ["fast", "intuitive", "appropriate", "seamless", "robust"] as const;
const VAGUE_PHRASES = ["handle gracefully", "good ux", "user-friendly", "user friendly"] as const;

const OBSERVABLE =
  /(\b[1-5]\d{2}\b)|("[^"]{2,}")|('[^']{2,}')|\b\d{1,2}:\d{2}\b|\b(banner|dialog|button|spinner|skeleton|retry|confirmation|control|page|field|disabled|enabled|hidden|visible|not-found|error|message|status|audit|version|log|row|clock)\b|\b\d+\s*(ms|milliseconds|seconds|minutes|px|items|rows|mb|kb|bytes|minor units)\b/i;

const INPUT_CUE = /\b(input|enter|submit|click|request|when|given|post|get|send|open|call|boot|force|render|save|choose)\b/i;
const OUTCOME_CUE = /\b(returns?|shows?|emits?|displays?|observe[sd]?|status|hidden|visible|disabled|banner|dialog|equals?|contains?|remains?)\b/i;

export interface EarsOracleInput {
  readonly earsText: string;
  readonly oracleSketch: string;
  readonly premises?: readonly string[];
  readonly allowedPremiseIds?: readonly string[];
  readonly forbiddenScopePhrases?: readonly string[];
  readonly cellId?: string;
  readonly knownCellIds?: readonly string[];
}

export interface EarsOracleResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

export class EarsOracleValidator {
  validate(input: EarsOracleInput): EarsOracleResult {
    const problems: string[] = [];
    const ears = input.earsText.trim();
    const oracle = input.oracleSketch.trim();
    if (!EARS_TEXT_PATTERN.test(ears)) {
      problems.push("ears_text must be one EARS sentence");
    }
    if (isVague(ears)) {
      problems.push(
        "ears_text uses a vague word without an observable status, message, or bound",
      );
    }
    if (oracle.length === 0 || isVague(oracle)) {
      problems.push(
        "oracle_sketch uses a vague word without an observable status, message, or bound",
      );
    }
    if (!isConcreteOracle(oracle)) {
      problems.push(
        "oracle_sketch must name an exact input and an observable outcome, status, or UI state",
      );
    }
    if (input.cellId && input.knownCellIds && !input.knownCellIds.includes(input.cellId)) {
      problems.push(`cell ${input.cellId} is outside the requested batch`);
    }
    const allowed = input.allowedPremiseIds;
    if (allowed) {
      const allow = new Set(allowed);
      for (const premise of input.premises ?? []) {
        if (!allow.has(premise)) {
          problems.push(`premise ${premise} is not an authorized source for this batch`);
        }
      }
    }
    const haystack = `${ears}\n${oracle}`.toLowerCase();
    for (const phrase of input.forbiddenScopePhrases ?? []) {
      if (phrase.trim().length > 0 && haystack.includes(phrase.toLowerCase())) {
        problems.push(`unauthorized scope invention: ${phrase}`);
      }
    }
    return { ok: problems.length === 0, problems };
  }
}

export function isVague(text: string): boolean {
  if (!containsVagueWording(text)) return false;
  return !OBSERVABLE.test(text);
}

export function containsVagueWording(text: string): boolean {
  const lower = text.toLowerCase();
  if (VAGUE_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  return VAGUE_WORDS.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
}

export function isConcreteOracle(text: string): boolean {
  return INPUT_CUE.test(text) && OUTCOME_CUE.test(text) && OBSERVABLE.test(text);
}

export function earsPatternName(earsText: string): "event" | "state" | "unwanted" | "optional" | "ubiquitous" {
  const text = earsText.trim().toLowerCase();
  if (text.startsWith("when ")) return "event";
  if (text.startsWith("while ")) return "state";
  if (text.startsWith("if ")) return "unwanted";
  if (text.startsWith("where ")) return "optional";
  return "ubiquitous";
}
