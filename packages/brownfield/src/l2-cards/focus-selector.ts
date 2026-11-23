import { DEFAULT_MAX_FOCUS_FILES } from "./types.js";
import type { CodeMapQueryPort } from "./ports.js";
import type { FocusFileCandidate, FocusSelectionResult } from "./types.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "fix",
  "add",
  "update",
  "refactor",
  "whole",
  "repo",
]);

function tokenizeRequest(request: string): string[] {
  return request
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function lexicalScore(path: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const hay = path.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (hay.includes(term)) hits += 1;
  }
  return hits / terms.length;
}

export interface RequestDrivenFocusSelectorOptions {
  readonly maxFiles?: number;
  readonly commitSha: string;
  readonly codeMap: CodeMapQueryPort;
  readonly churnByPath?: ReadonlyMap<string, number>;
}

export class RequestDrivenFocusSelector {
  select(request: string, options: RequestDrivenFocusSelectorOptions): FocusSelectionResult {
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FOCUS_FILES;
    const terms = tokenizeRequest(request);
    const files = options.codeMap.listFiles(options.commitSha);
    const symbolHits = new Map<string, number>();
    for (const hit of options.codeMap.searchSymbols(request)) {
      symbolHits.set(hit.path, (symbolHits.get(hit.path) ?? 0) + 1);
    }

    const ranked: FocusFileCandidate[] = [];
    for (const path of files) {
      const pageRankScore = options.codeMap.fileRank(options.commitSha, path) ?? 0;
      const churnScore = options.churnByPath?.get(path) ?? 0;
      const sym = symbolHits.get(path) ?? 0;
      const lex = lexicalScore(path, terms);
      ranked.push({
        path,
        pageRankScore,
        churnScore,
        symbolHits: sym,
        lexicalScore: lex,
      });
    }

    ranked.sort((a, b) => {
      const score = (c: FocusFileCandidate) =>
        c.pageRankScore * 2 +
        Math.log2(c.churnScore + 1) +
        c.symbolHits * 3 +
        c.lexicalScore * 5;
      return score(b) - score(a);
    });

    const selected = ranked.slice(0, maxFiles).map((r) => r.path);
    return {
      request,
      selected,
      ranked,
      capped: files.length > maxFiles,
      maxFiles,
    };
  }
}