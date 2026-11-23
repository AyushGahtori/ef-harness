import { normalizeSpokenWord, parseSpokenAgentNumber, parseSpokenNumber } from "./number-words.js";
import type { ProjectStateIdCatalog, SpokenIdNormalization, SpokenIdReplacement } from "./types.js";

const PLURAL_VERB_SUBJECTS = new Set(["there", "they", "we", "you"]);

interface WordSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

type IdKind = SpokenIdReplacement["kind"];

interface IdMatch {
  readonly consumed: number;
  readonly canonicalId: string;
  readonly kind: IdKind;
}

const WORD_PATTERN = /[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g;

function wordsOf(text: string): WordSpan[] {
  const words: WordSpan[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const token = match[0];
    const start = match.index;
    if (!token || start === undefined) continue;
    words.push({ text: token, start, end: start + token.length });
  }
  return words;
}

function nextIsScaleWord(words: readonly WordSpan[], index: number): boolean {
  const word = words[index];
  if (!word) return false;
  const token = normalizeSpokenWord(word.text);
  return token === "hundred" || token === "thousand";
}

/**
 * Converts spoken references to canonical project IDs only when that exact ID
 * exists in the active project's state and the phrase is not ordinary English
 * (`there` / `they` / `we` / `you are two`).
 */
export class ProjectVerifiedSpokenIdNormalizer {
  constructor(private readonly catalog: ProjectStateIdCatalog) {}

  normalize(projectId: string, text: string): SpokenIdNormalization {
    const words = wordsOf(text);
    let built = "";
    let cursor = 0;
    const replacements: SpokenIdReplacement[] = [];
    let index = 0;
    while (index < words.length) {
      const match = this.matchAt(projectId, words, index);
      const word = words[index];
      if (!match || !word) {
        index += 1;
        continue;
      }
      const last = words[index + match.consumed - 1];
      if (!last) {
        index += 1;
        continue;
      }
      built += text.slice(cursor, word.start);
      const start = built.length;
      built += match.canonicalId;
      replacements.push({
        start,
        end: built.length,
        spoken: text.slice(word.start, last.end),
        canonicalId: match.canonicalId,
        kind: match.kind,
      });
      cursor = last.end;
      index += match.consumed;
    }
    built += text.slice(cursor);
    return { text: built, replacements };
  }

  private matchAt(projectId: string, words: readonly WordSpan[], index: number): IdMatch | null {
    const word = words[index];
    if (!word) return null;
    const token = normalizeSpokenWord(word.text);
    const previous = index > 0 ? normalizeSpokenWord(words[index - 1]?.text ?? "") : "";
    if (token === "requirement" || token === "req") {
      return this.finish(projectId, words, index, 1, "requirement");
    }
    if (token === "agent") {
      return this.finish(projectId, words, index, 1, "worker");
    }
    if (token === "task" || token === "tasks") {
      return this.finish(projectId, words, index, 1, "task");
    }
    if (token === "rule" || token === "rules") {
      return this.finish(projectId, words, index, 1, "rule");
    }
    if (token === "are") {
      if (PLURAL_VERB_SUBJECTS.has(previous)) return null;
      return this.finish(projectId, words, index, 1, "rule");
    }
    if (token === "a") return this.finish(projectId, words, index, 1, "worker");
    if (token === "r") return this.finish(projectId, words, index, 1, "rule");
    if (token === "t") return this.finish(projectId, words, index, 1, "task");
    return null;
  }

  private finish(
    projectId: string,
    words: readonly WordSpan[],
    keywordIndex: number,
    keywordWords: number,
    kind: IdKind,
  ): IdMatch | null {
    const numberIndex = keywordIndex + keywordWords;
    if (kind === "worker") {
      const agent = parseSpokenAgentNumber(
        words.map((word) => word.text),
        numberIndex,
      );
      if (!agent) return null;
      if (nextIsScaleWord(words, numberIndex + agent.consumed)) return null;
      const canonicalId = `A${agent.digits}`;
      if (!this.catalog.hasActiveWorker(projectId, canonicalId)) return null;
      return { consumed: keywordWords + agent.consumed, canonicalId, kind };
    }
    const spoken = parseSpokenNumber(
      words.map((word) => word.text),
      numberIndex,
    );
    if (!spoken) return null;
    if (nextIsScaleWord(words, numberIndex + spoken.consumed)) return null;
    const canonicalId = formatId(kind, spoken.value);
    if (!this.exists(projectId, kind, canonicalId)) return null;
    return { consumed: keywordWords + spoken.consumed, canonicalId, kind };
  }

  private exists(projectId: string, kind: IdKind, id: string): boolean {
    switch (kind) {
      case "rule":
        return this.catalog.hasActiveRule(projectId, id);
      case "task":
        return this.catalog.hasTask(projectId, id);
      case "requirement":
        return this.catalog.hasRequirement(projectId, id);
      case "worker":
        return this.catalog.hasActiveWorker(projectId, id);
    }
  }
}

function formatId(kind: IdKind, value: number): string {
  switch (kind) {
    case "rule":
      return `R${value}`;
    case "task":
      return `T-${value}`;
    case "requirement":
      return `REQ-${value}`;
    case "worker":
      return `A${String(value).padStart(4, "0")}`;
  }
}
