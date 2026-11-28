import { LOW_CONFIDENCE_P, VERIFY_OR_EDIT } from "./constants.js";
import { asProbability, classifyToken, isUnit, tokenKey } from "./text.js";
import type { HighlightSpan, HypothesisToken, VocabularyLookup } from "./types.js";

const emptyVocabulary: VocabularyLookup = {
  contains() {
    return false;
  },
};

export class LowConfidenceCriticalSpanHighlighter {
  constructor(private readonly vocabulary: VocabularyLookup = emptyVocabulary) {}

  mark(tokens: readonly HypothesisToken[]): readonly HighlightSpan[] {
    const spans: HighlightSpan[] = [];
    let cursor = 0;
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (!token) break;
      const word = tokenKey(token.text);
      if (word.length === 0) {
        index += 1;
        continue;
      }
      const next = tokens[index + 1];
      const nextWord = next ? tokenKey(next.text) : "";
      const numberLike = classifyToken(word, this.vocabulary, token.semanticClass) === "number";
      const pairUnit = numberLike && next !== undefined && nextWord.length > 0 && isUnit(nextWord);
      const consumed = pairUnit ? 2 : 1;
      const wordProbability = asProbability(token.probability);
      const nextProbability = next ? asProbability(next.probability) : 1;
      const end = pairUnit ? cursor + word.length + 1 + nextWord.length : cursor + word.length;
      const semantic = pairUnit
        ? "quantity"
        : classifyToken(word, this.vocabulary, token.semanticClass);
      const probability = pairUnit ? Math.min(wordProbability, nextProbability) : wordProbability;
      if (semantic !== null && probability < LOW_CONFIDENCE_P) {
        spans.push({
          start: cursor,
          end,
          text: pairUnit ? `${word} ${nextWord}` : word,
          probability,
          semanticClass: semantic,
          decoration: "amber-underline",
          tooltip: VERIFY_OR_EDIT,
        });
      }
      cursor = end;
      const more = index + consumed < tokens.length;
      if (more) cursor += 1;
      index += consumed;
    }
    return spans;
  }
}
